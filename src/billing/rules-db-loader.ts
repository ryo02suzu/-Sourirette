/**
 * 算定ルール調査DB（data/rules/santei-rules-R8.json）→ データ駆動ルールへの取込ローダー。
 *
 * 調査DB（審査情報提供事例・告示・通知から構造化）の各カテゴリを器に流し込む:
 *   - diagnosis_procedure の「不適応」→ 病名適応ブラックリスト（diagnosisRequirements・warning）
 *   - disease_master → 病名略号→コード群（不適応の病名を全関連コードに展開）
 *   - procedure_kubun（I005等）→ 9桁コードに展開（マスタの buildKubunToCodes）
 *
 * 安全方針: 全件 severity=warning（審査裁量あり）・requires_dentist_review=true。
 * 「不適応（認めない）」のみルール化し、「適応（認める）」は肯定確認なのでルール化しない（誤警告防止）。
 * 施設基準ゲート・年齢/時間加算は医院プロファイル・加算機構が要るため別途（ここでは未活性）。
 */
import type { DiagnosisRequirement } from "./rule-tables.js";
import { codesForKubun } from "./betsu1-loader.js";

export interface RulesDb {
  meta?: unknown;
  disease_master: { abbr: string; name?: string; code: string; also?: string[] }[];
  diagnosis_procedure: {
    id: string;
    procedure_kubun: string;
    procedure_codes?: string[];
    procedure_name?: string;
    required_diseases?: string[];
    forbidden_diseases?: string[];
    relation: "適応" | "不適応";
    source?: string;
    severity?: "error" | "warning";
    note?: string;
  }[];
  facility_standard?: unknown[];
  age_time_site?: AgeTimeSiteEntry[];
  computer_check?: unknown[];
}

export interface AgeTimeSiteEntry {
  id: string;
  type: string;
  procedure_codes?: string[];
  kubun?: string;
  condition?: string;
  value?: string;
  source?: string;
  confidence?: string;
}

export function parseRulesDb(json: string): RulesDb {
  return JSON.parse(json) as RulesDb;
}

/**
 * 算定もれ提示用: 区分 → 算定可能な加算/通則（年齢・時間・部位）のヒント索引。
 * 「この処置を算定したなら、該当すればこの加算も算定できる」を提示する元データ。
 */
export function buildChargeHintsByKubun(db: RulesDb): Map<string, AgeTimeSiteEntry[]> {
  const map = new Map<string, AgeTimeSiteEntry[]>();
  for (const e of db.age_time_site ?? []) {
    const kubuns = new Set<string>();
    if (e.kubun !== undefined && e.kubun !== "") for (const k of e.kubun.split("/")) kubuns.add(k.trim());
    for (const c of e.procedure_codes ?? []) kubuns.add(c.trim());
    for (const k of kubuns) {
      let arr = map.get(k);
      if (arr === undefined) map.set(k, (arr = []));
      arr.push(e);
    }
  }
  return map;
}

/** disease_master → 病名略号 → 関連7桁コード集合（主コード＋also[]の全コード） */
export function buildDiseaseAbbrToCodes(db: RulesDb): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const d of db.disease_master) {
    const codes = new Set<string>();
    if (/^\d{7}$/.test(d.code)) codes.add(d.code);
    for (const a of d.also ?? []) {
      for (const c of a.match(/\d{7}/g) ?? []) codes.add(c);
    }
    if (codes.size > 0) map.set(d.abbr, [...codes]);
  }
  return map;
}

/** "Per/8832354" や "Pul" を関連コード群に解決する */
function resolveDiseaseCodes(token: string, abbrToCodes: Map<string, string[]>): string[] {
  const [abbr, code] = token.split("/");
  const out = new Set<string>();
  if (abbr !== undefined) for (const c of abbrToCodes.get(abbr) ?? []) out.add(c);
  if (code !== undefined && /^\d{7}$/.test(code)) out.add(code);
  return [...out];
}

/**
 * diagnosis_procedure の「不適応」→ DiagnosisRequirement[]（病名適応ブラックリスト）。
 * procedure_kubun を9桁コードへ展開し、forbidden_diseases を関連コード群へ展開する。
 */
export function buildDiagnosisRequirements(db: RulesDb, kubunToCodes: Map<string, string[]>): DiagnosisRequirement[] {
  const abbrToCodes = buildDiseaseAbbrToCodes(db);
  const out: DiagnosisRequirement[] = [];
  const seen = new Set<string>();
  for (const dp of db.diagnosis_procedure) {
    if (dp.relation !== "不適応") continue; // 「認めない」のみルール化（適応＝肯定確認はスキップ）
    const forbidden = (dp.forbidden_diseases ?? []).flatMap((t) => resolveDiseaseCodes(t, abbrToCodes));
    if (forbidden.length === 0) continue;
    const forbiddenUniq = [...new Set(forbidden)];
    // procedure_codes が空なら区分から展開
    const procCodes =
      dp.procedure_codes && dp.procedure_codes.length > 0
        ? dp.procedure_codes
        : dp.procedure_kubun.split("/").flatMap((k) => codesForKubun(k.trim(), kubunToCodes));
    for (const code of procCodes) {
      const key = `${code}#${forbiddenUniq.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        code,
        forbiddenDiseaseCodes: forbiddenUniq,
        severity: "warning",
        note: `${dp.note ?? dp.procedure_name ?? ""}（${dp.source ?? "審査事例"}・要歯科医師確認）`,
      });
    }
  }
  return out;
}
