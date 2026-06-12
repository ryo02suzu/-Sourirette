-- Sourirette PostgreSQL スキーマ（Phase 0 骨格）
-- 設計原則:
--   1. 確定済みカルテ記録は UPDATE/DELETE 不可（トリガで強制）。訂正は新版の追加。
--   2. マスタ・保険情報は適用期間付き（過去日付の診療の再計算・返戻再請求に対応）。
--   3. 全業務テーブルの変更は audit_log に記録する。

create extension if not exists pgcrypto;

-- ========== 医院・職員 ==========

create table clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- 保険医療機関コード（7桁）。レセプト・オン資で必須
  facility_code text,
  created_at  timestamptz not null default now()
);

create table staff (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id),
  name        text not null,
  -- dentist: 歯科医師 / hygienist: 歯科衛生士 / clerk: 受付・事務 / admin: 管理者
  role        text not null check (role in ('dentist', 'hygienist', 'clerk', 'admin')),
  -- 認証基盤（Supabase Auth 等）のユーザID
  auth_user_id uuid unique,
  created_at  timestamptz not null default now()
);

-- 施設基準の届出（算定エンジンの分岐に使用）
create table facility_standards (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id),
  standard_code text not null,           -- 届出コード（公式マスタ準拠）
  valid_from  date not null,
  valid_to    date                        -- null = 現在も有効
);

-- ========== 患者・保険 ==========

create table patients (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id),
  chart_number text not null,             -- 院内カルテ番号
  name        text not null,
  name_kana   text,
  birth_date  date not null,
  sex         text not null check (sex in ('M', 'F')),
  created_at  timestamptz not null default now(),
  unique (clinic_id, chart_number)
);

-- 保険・公費。月途中の変更でレセプトが分かれるため期間付きで履歴を持つ
create table insurance_coverages (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id),
  kind        text not null check (kind in ('medical', 'public_expense')), -- 主保険 / 公費
  insurer_number  text not null,          -- 保険者番号（公費は負担者番号）
  insured_symbol  text,                   -- 記号
  insured_number  text,                   -- 番号
  insured_branch  text,                   -- 枝番（オン資）
  relationship    text,                   -- 本人/家族
  copay_rate      numeric(3,2),           -- 負担割合（0.30 等）
  valid_from  date not null,
  valid_to    date
);

-- ========== 受診・カルテ ==========

create table visits (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id),
  patient_id  uuid not null references patients(id),
  visit_date  date not null,
  -- first: 初診 / followup: 再診（算定エンジンの基本分岐）
  visit_type  text not null check (visit_type in ('first', 'followup')),
  created_at  timestamptz not null default now()
);

-- カルテ記録（追記専用・版管理・ハッシュ連鎖）
create table chart_entries (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null references visits(id),
  -- 旧版への参照。訂正時は新規行を追加し、ここに旧版の id を入れる
  supersedes_id uuid references chart_entries(id),
  -- draft: 下書き（編集可・AI取込はここ） / final: 確定（以後変更不可）
  status        text not null default 'draft' check (status in ('draft', 'final')),
  -- SOAP 本文（dentia からの取込形式と互換）
  soap          jsonb not null,            -- { "S": "...", "O": "...", "A": "...", "P": "..." }
  authored_by   uuid not null references staff(id),   -- 記載者
  finalized_by  uuid references staff(id),            -- 確定者（歯科医師のみ）
  finalized_at  timestamptz,
  -- 真正性: sha256(前行の content_hash || 本文)。チェーン検証で改ざん検知
  content_hash  text,
  created_at    timestamptz not null default now()
);

-- 確定済みカルテの変更・削除をDBレベルで拒否（真正性の担保）
create or replace function reject_final_chart_mutation() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'final' then
      raise exception 'final chart entries are append-only (id: %)', old.id;
    end if;
    return old;
  end if;
  -- UPDATE: 確定済み行は一切変更不可。draft -> final への遷移のみ許可
  if old.status = 'final' then
    raise exception 'final chart entries are append-only (id: %)', old.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger chart_entries_append_only
  before update or delete on chart_entries
  for each row execute function reject_final_chart_mutation();

-- 傷病名（公式傷病名マスタのコード＋部位）
create table diagnoses (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references patients(id),
  disease_code text not null,             -- 傷病名マスタのコード
  modifier_codes text[],                  -- 修飾語コード
  teeth        text[],                    -- 部位（FDI 2桁表記の配列。全顎等は空）
  onset_date   date not null,             -- 開始日
  outcome      text check (outcome in ('cured', 'died', 'stopped', 'transferred')),
  outcome_date date
);

-- 診療行為（実施した処置。算定エンジンの入力）
create table performed_procedures (
  id             uuid primary key default gen_random_uuid(),
  visit_id       uuid not null references visits(id),
  procedure_code text not null,           -- 診療行為マスタのコード
  teeth          text[],                  -- 部位（FDI 2桁表記の配列）
  quantity       int not null default 1,
  performed_by   uuid not null references staff(id),
  created_at     timestamptz not null default now()
);

-- ========== 公式マスタ（支払基金）取込先 ==========
-- 実カラムは公式マスタのレイアウト仕様に合わせて拡張する。適用期間付きで世代共存。

create table m_procedure (        -- 診療行為マスタ
  code        text not null,
  name        text not null,
  points      numeric(10,2) not null,     -- 点数
  unit_code   text,                       -- 算定単位
  valid_from  date not null,
  valid_to    date,
  primary key (code, valid_from)
);

create table m_disease (          -- 傷病名マスタ
  code        text not null,
  name        text not null,
  valid_from  date not null,
  valid_to    date,
  primary key (code, valid_from)
);

create table m_drug (             -- 医薬品マスタ
  code        text not null,
  name        text not null,
  price       numeric(10,2) not null,     -- 薬価
  valid_from  date not null,
  valid_to    date,
  primary key (code, valid_from)
);

-- ========== 監査ログ ==========

create table audit_log (
  id          bigint generated always as identity primary key,
  clinic_id   uuid,
  actor_id    uuid,                       -- staff.id（システム処理は null）
  action      text not null,              -- insert/update/finalize/view/export 等
  table_name  text not null,
  record_id   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- audit_log 自体も追記専用
create or replace function reject_audit_mutation() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function reject_audit_mutation();
