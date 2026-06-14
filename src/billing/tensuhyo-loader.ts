/**
 * 電子点数表（歯科）→ データ駆動ルールテーブルへの取込ローダー。
 *
 * 出典: 社会保険診療報酬支払基金「電子点数表（歯科）令和8年度版」tensuhyo_04.zip
 *   data/tensuhyo/04_santei_kaisu.csv（算定回数テーブル）
 *   data/tensuhyo/03-1〜03-5_haihan.csv（背反テーブル）
 *   data/tensuhyo/02_hokatsu.csv（包括テーブル）
 *   いずれも Shift_JIS・クォート付きCSV。
 *
 * 設計: マスタ（公式データ）を正として rule-tables.ts の解釈器に流し込む。点数は持たせない
 * （点数は診療行為マスタから引く）。本ローダーが扱うのは「回数制限・背反・包括」の関係データ。
 *
 * ⚠️ 安全方針: 機械的に取り込むが、本番の算定ブロックに有効化する前に歯科医師レビューを経る
 *    （特に背反の scope＝同日/同月、包括のグループ意味は電子点数表レイアウトで要確認）。
 */
import { decodeSjis, normalizeDate, parseCsvLine } from "./master-loader.js";
import type { CalculationContext, CalculationIssue, Rule, RuleOutput } from "./engine.js";
import type { FrequencyLimit, InclusionRule, MutualExclusion, Scope } from "./rule-tables.js";

/** Shift_JIS バッファ → UTF-8 文字列（ローダーの入口） */
export function decodeTensuhyo(buf: Uint8Array): string {
  return decodeSjis(buf);
}

/** 適用期間内か（asOf 既定は当日）。validTo=99999999 は無期限 */
function isActive(validFromRaw: string, validToRaw: string, asOf: string): boolean {
  const from = normalizeDate(validFromRaw) ?? "1900-01-01";
  const to = normalizeDate(validToRaw); // 無期限は undefined
  return from <= asOf && (to === undefined || asOf <= to);
}

// ---- 算定回数テーブル → 回数制限 ----

export interface SanteiKaisuRow {
  code: string;
  addonCode: string;
  name: string;
  /** 期間区分の生値（月/日/週/歯/個/一連/口腔 等。時間ベース以外も保持） */
  period: string;
  maxCount: number;
  validFrom: string;
  validTo: string;
}

/** 算定回数テーブル（04）をパースする */
export function parseSanteiKaisu(utf8: string): SanteiKaisuRow[] {
  const rows: SanteiKaisuRow[] = [];
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    const code = f[1] ?? "";
    if (!/^\d{9}$/.test(code)) continue;
    rows.push({
      code,
      addonCode: f[2] ?? "",
      name: f[3] ?? "",
      period: f[6] ?? "",
      maxCount: Number(f[7] ?? "0"),
      validFrom: f[10] ?? "",
      validTo: f[11] ?? "",
    });
  }
  return rows;
}

/**
 * 算定回数行 → FrequencyLimit[]。
 * 現在の FrequencyLimit は per="day"|"month" のみ表現できるため、時間ベース（月・日）かつ
 * 基本行為（加算コード 00000）かつ適用期間内の行のみ取り込む。単位ベース（歯/個/口腔/一連
 * 等）は別概念のため対象外（モデル拡張＋レビュー後に追加）。
 */
export function santeiKaisuToFrequencyLimits(rows: readonly SanteiKaisuRow[], asOf = todayIso()): FrequencyLimit[] {
  const out: FrequencyLimit[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.addonCode !== "00000") continue;
    if (!isActive(r.validFrom, r.validTo, asOf)) continue;
    const per = r.period === "月" ? "month" : r.period === "日" ? "day" : undefined;
    if (per === undefined) continue;
    if (!Number.isFinite(r.maxCount) || r.maxCount <= 0) continue;
    const key = `${r.code}/${per}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: r.code, maxCount: r.maxCount, per, note: `電子点数表 算定回数（${r.name}）` });
  }
  return out;
}

// ---- 背反テーブル → 併算定不可 ----

export interface HaihanRow {
  codeA: string;
  addonA: string;
  codeB: string;
  addonB: string;
  /** 背反区分（1/2は対称ペア、3は特例。意味の確定は電子点数表レイアウトで要確認） */
  kind: string;
  validFrom: string;
  validTo: string;
}

/** 背反テーブル（03-x）をパースする */
export function parseHaihan(utf8: string): HaihanRow[] {
  const rows: HaihanRow[] = [];
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    const codeA = f[1] ?? "";
    const codeB = f[4] ?? "";
    if (!/^\d{9}$/.test(codeA) || !/^\d{9}$/.test(codeB)) continue;
    rows.push({
      codeA,
      addonA: f[2] ?? "",
      codeB,
      addonB: f[5] ?? "",
      kind: f[7] ?? "",
      validFrom: f[10] ?? "",
      validTo: f[11] ?? "",
    });
  }
  return rows;
}

/**
 * 背反テーブル（03-x）ごとの背反範囲。電子点数表「00ファイル一覧表（歯科）」の規定:
 *   03-1: 1日につき背反 / 03-2: 同一月内で背反 / 03-3: 同時に背反 /
 *   03-4: 同一部位で同時に背反 / 03-5: 1週間につき背反
 * 現行の MutualExclusion は同日/同月のみ表現できるため、03-1/03-3→same-day、03-2→same-month を
 * 取り込む。03-4（部位条件）・03-5（週）はモデル外のため呼び出し側で除外する（過検知防止）。
 */
export const HAIHAN_TABLE_SCOPE: Record<string, "same-day" | "same-month" | "unsupported"> = {
  "03-1": "same-day",
  "03-2": "same-month",
  "03-3": "same-day", // 同時 ≈ 同日（保守的）
  "03-4": "unsupported", // 同一部位で同時（部位条件＝本モデル外）
  "03-5": "unsupported", // 1週間（週＝本モデル外）
};

/**
 * 背反行 → MutualExclusion[]。
 * 背反テーブルは方向違い（区分1/2）で対称収録されるため、無順序ペアで重複排除する。
 * 基本行為どうし（加算コード 00000）のみ取り込む（加算固有の背反は別途）。
 *
 * @param scope 背反範囲。テーブル番号に応じて HAIHAN_TABLE_SCOPE で確定した値を渡す
 *   （03-1=same-day, 03-2=same-month）。
 */
export function haihanToMutualExclusions(
  rows: readonly HaihanRow[],
  scope: "same-day" | "same-month" = "same-month",
  asOf = todayIso(),
): MutualExclusion[] {
  const out: MutualExclusion[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.addonA !== "00000" || r.addonB !== "00000") continue;
    if (r.codeA === r.codeB) continue;
    if (!isActive(r.validFrom, r.validTo, asOf)) continue;
    const [lo, hi] = r.codeA < r.codeB ? [r.codeA, r.codeB] : [r.codeB, r.codeA];
    const key = `${lo}/${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ codeA: lo, codeB: hi, scope, note: "電子点数表 背反" });
  }
  return out;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- 包括・被包括テーブル → 包括 ----
//
// 仕組み（電子点数表 活用手引き ⑵）: 補助マスター(01)に「包括する親」の包括グループ番号
// ①②③（列6〜8）を持ち、包括テーブル(02)に各グループの「被包括の子」を持つ。
// グループ番号が一致する 親×子 が包括関係（親を算定すると子は別途算定不可）。
// 例: 抜髄(309002110, グループI005001) は 生切・根管貼薬 等を包括する。
//
// ⚠️ 包括テーブルには時間範囲（同日/同月）が明記されない。多くは「同時に行った場合」に
//    包括されるため既定 same-day とするが、月単位で包括される関係もあるため scope は
//    歯科医師レビューで精緻化する。

/** 補助マスター(01) → 包括グループ番号 → 親（包括する側）コード集合 */
export function parseHojoMasterGroups(utf8: string, asOf = todayIso()): Map<string, Set<string>> {
  const parentsByGroup = new Map<string, Set<string>>();
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    const code = f[1] ?? "";
    if (!/^\d{9}$/.test(code)) continue;
    if ((f[2] ?? "") !== "00000") continue; // 基本行為のみ
    if (!isActive(f[23] ?? "", f[24] ?? "", asOf)) continue;
    for (const g of [f[5], f[6], f[7]]) {
      if (g !== undefined && g !== "" && g !== "0") {
        let set = parentsByGroup.get(g);
        if (set === undefined) parentsByGroup.set(g, (set = new Set()));
        set.add(code);
      }
    }
  }
  return parentsByGroup;
}

/** 包括テーブル(02) → 包括グループ番号 → 子（被包括）コード集合 */
export function parseHokatsuChildren(utf8: string, asOf = todayIso()): Map<string, Set<string>> {
  const childrenByGroup = new Map<string, Set<string>>();
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    const group = f[1] ?? "";
    const code = f[2] ?? "";
    if (group === "" || !/^\d{9}$/.test(code)) continue;
    if ((f[3] ?? "") !== "00000") continue; // 基本行為のみ
    if (!isActive(f[6] ?? "", f[7] ?? "", asOf)) continue;
    let set = childrenByGroup.get(group);
    if (set === undefined) childrenByGroup.set(group, (set = new Set()));
    set.add(code);
  }
  return childrenByGroup;
}

/**
 * 包括を「グループ判定型ルール」として直接生成する（ペアに展開しない高速版）。
 *
 * 包括関係はペアに展開すると数百万件になる（巨大グループ：入院料系等）。本番ではペア展開を
 * 避け、入力された各コードについて「そのコードを子に含むグループの親が、同じレセプトに存在
 * するか」を索引で判定する（O(入力コード数)）。buildInclusions は検証・小規模デモ用に残す。
 */
export function createInclusionGroupRule(
  parentsByGroup: Map<string, Set<string>>,
  childrenByGroup: Map<string, Set<string>>,
  validFrom: string,
  scope: Scope = "same-day",
  validTo?: string,
): Rule {
  // 索引: 子コード → そのコードを子に含む（かつ親が存在する）グループ一覧
  const groupsByChild = new Map<string, string[]>();
  for (const [group, children] of childrenByGroup) {
    if (!parentsByGroup.has(group)) continue;
    for (const child of children) {
      let arr = groupsByChild.get(child);
      if (arr === undefined) groupsByChild.set(child, (arr = []));
      arr.push(group);
    }
  }
  const rule: Rule = {
    id: `tensuhyo-inclusion-group/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      const issues: CalculationIssue[] = [];
      const isPresent = (code: string): boolean => {
        const today = ctx.procedures.some((p) => p.procedureCode === code && p.quantity > 0);
        if (scope === "same-day") return today;
        return today || ctx.history.countInMonth(code, ctx.visit.visitDate) > 0;
      };
      for (const p of ctx.procedures) {
        const groups = groupsByChild.get(p.procedureCode);
        if (groups === undefined) continue;
        let flagged = false;
        for (const group of groups) {
          for (const parent of parentsByGroup.get(group)!) {
            if (parent !== p.procedureCode && isPresent(parent)) {
              issues.push({ severity: "error", ruleId: rule.id, procedureCode: p.procedureCode, message: `${p.procedureCode} は ${parent} に包括され別途算定できません（電子点数表 包括）` });
              flagged = true;
              break;
            }
          }
          if (flagged) break;
        }
      }
      return { issues };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}

/** 親集合×子集合（グループ番号で結合）→ InclusionRule[]。検証・小規模デモ用（巨大展開に注意） */
export function buildInclusions(
  parentsByGroup: Map<string, Set<string>>,
  childrenByGroup: Map<string, Set<string>>,
  scope: Scope = "same-day",
): InclusionRule[] {
  const out: InclusionRule[] = [];
  const seen = new Set<string>();
  for (const [group, parents] of parentsByGroup) {
    const children = childrenByGroup.get(group);
    if (children === undefined) continue;
    for (const parent of parents) {
      for (const child of children) {
        if (parent === child) continue;
        const key = `${parent}/${child}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ includingCode: parent, includedCode: child, scope, note: "電子点数表 包括" });
      }
    }
  }
  return out;
}
