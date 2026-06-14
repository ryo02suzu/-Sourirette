/**
 * 初診料・再診料の年齢/時間外加算を自動算定するルール（算定もれ防止の自動化）。
 *
 * これらの加算は「患者の生年月日（＝年齢）」と「受診の時間区分」という、既に入力済みの
 * 事実から一意に決まる。やっていない診療を勝手に足すのではなく、入力済みの初診/再診に
 * 対する正しい点数を補うだけなので、過剰請求にはならず取りこぼし（過少請求）を防ぐ。
 *
 * 安全方針:
 *   - 加算コードはハードコードせず、診療行為マスタを「正式名称」で引いて解決する（点数も実マスタ）。
 *   - 初診料/再診料が実際に算定されている時だけ加算する（codeToKubun で A000/A001・A002 を確認）。
 *   - 名称がマスタに無ければ何もしない（誤った行を生まない）。
 *
 * 対象（記録条件仕様の別表20 診療識別 11 初・再診）:
 *   乳幼児加算 / 時間外・休日・深夜加算 / それらの乳幼児併用。
 */
import { ageAt, type TimeClass } from "../../domain/types.js";
import type { CalculationContext, ClaimLine, Rule, RuleOutput } from "../engine.js";

/** 初診=A000 / 再診=A001・A002 を判定するための区分集合 */
const SHOSHIN_KUBUN = new Set(["A000"]);
const SAISHIN_KUBUN = new Set(["A001", "A002"]);

const TIME_LABEL: Record<Exclude<TimeClass, "regular">, string> = {
  afterHours: "時間外",
  holiday: "休日",
  midnight: "深夜",
};

/** (初診|再診) × 時間区分 × 乳幼児 から、診療行為マスタの正式名称候補を組み立てる */
function additionName(base: "初診" | "再診", timeClass: TimeClass, infant: boolean): string | undefined {
  const inOut = base === "再診" ? "（入院外）" : "";
  if (timeClass === "regular") {
    // 通常時間内は乳幼児のときだけ加算がある（成人の通常初再診に加算なし）
    return infant ? `乳幼児加算（${base}）` : undefined;
  }
  const prefix = infant ? "乳幼児" : "";
  return `${prefix}${TIME_LABEL[timeClass]}加算（${base}）${inOut}`;
}

/**
 * 加算自動算定ルールを作る。
 * @param additionByName 加算の正式名称 → マスタ行（code/points）。official-engine が構築して渡す
 * @param codeToKubun    9桁コード → 区分。初診料/再診料が算定済みかの判定に使う
 */
export function createAdditionRule(
  additionByName: Map<string, { code: string; points: number }>,
  codeToKubun: Map<string, string>,
  validFrom: string,
  validTo?: string,
): Rule {
  const rule: Rule = {
    id: `auto-addition/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      // 初診料/再診料が実際に算定されているか（やっていない初再診に加算しない）
      let hasShoshin = false;
      let hasSaishin = false;
      for (const p of ctx.procedures) {
        const kubun = codeToKubun.get(p.procedureCode);
        if (kubun === undefined) continue;
        if (SHOSHIN_KUBUN.has(kubun)) hasShoshin = true;
        else if (SAISHIN_KUBUN.has(kubun)) hasSaishin = true;
      }
      // 初診と再診が同日に併存するのは不正。自動加算は付けず、競合を指摘するに留める
      if (hasShoshin && hasSaishin) {
        return { issues: [{ severity: "error", ruleId: rule.id, message: "同日に初診料と再診料が併算定されています（どちらか一方のみ）" }] };
      }
      const base: "初診" | "再診" | undefined = hasShoshin ? "初診" : hasSaishin ? "再診" : undefined;
      if (base === undefined) return {};

      const timeClass: TimeClass = ctx.visit.timeClass ?? "regular";
      const infant = ageAt(ctx.patient.birthDate, ctx.visit.visitDate) < 6;
      const name = additionName(base, timeClass, infant);
      if (name === undefined) return {};

      const row = additionByName.get(name);
      if (row === undefined) return {}; // マスタに無ければ何もしない（安全側）

      // 既に同じ加算が手入力されている場合は二重算定しない
      if (ctx.procedures.some((p) => p.procedureCode === row.code)) return {};

      const line: ClaimLine = { procedureCode: row.code, name, points: row.points, quantity: 1, category: "11" };
      return { lines: [line] };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}

/**
 * 診療行為マスタ行から「初診・再診の年齢/時間外加算」名称→行 の索引を作る。
 * 自動算定で参照する加算名（乳幼児/時間外/休日/深夜の各（初診）（再診）系）だけを拾う。
 */
export function buildAdditionIndex(
  rows: readonly { code: string; name: string; points: number }[],
): Map<string, { code: string; points: number }> {
  const wanted = new Set<string>();
  for (const base of ["初診", "再診"] as const) {
    for (const infant of [false, true]) {
      for (const tc of ["regular", "afterHours", "holiday", "midnight"] as const) {
        const n = additionName(base, tc, infant);
        if (n !== undefined) wanted.add(n);
      }
    }
  }
  const map = new Map<string, { code: string; points: number }>();
  for (const r of rows) {
    if (wanted.has(r.name) && !map.has(r.name)) map.set(r.name, { code: r.code, points: r.points });
  }
  return map;
}
