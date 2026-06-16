/**
 * 基本診療料ルール（初診料・再診料）— ルール実装の「型」を示すリファレンス実装。
 *
 * ⚠️ ここで参照するコードは公式の診療行為マスタのコードに置き換えること。
 *    点数はマスタから引くためこのファイルには現れない（ハードコード禁止原則）。
 *    歯科の初診料・再診料には施設基準・年齢・時間外等による加算があるが、
 *    それらは別ルールとして追加する（このルールは基本部分のみ）。
 */
import type { CalculationContext, Rule, RuleOutput } from "../engine.js";

/** 公式マスタのコードを設定して使う（コード自体も改定で変わり得るため注入式） */
export interface BasicVisitCodes {
  firstVisit: string; // 初診料
  followupVisit: string; // 再診料
}

export function createBasicVisitRule(codes: BasicVisitCodes, validFrom: string, validTo?: string): Rule {
  const rule: Rule = {
    id: `basic-visit/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      const code = ctx.visit.visitType === "first" ? codes.firstVisit : codes.followupVisit;
      const row = ctx.master.findProcedure(code, ctx.visit.visitDate);
      if (!row) {
        return {
          issues: [
            {
              severity: "error",
              ruleId: rule.id,
              procedureCode: code,
              message: `診療行為マスタに ${code} が見つかりません（診療日: ${ctx.visit.visitDate}）`,
            },
          ],
        };
      }

      const issues: RuleOutput["issues"] = [];
      // 相互排他: 初診料の算定日に再診料相当の入力が混ざっていないか
      const conflicting = ctx.visit.visitType === "first" ? codes.followupVisit : codes.firstVisit;
      if (ctx.procedures.some((p) => p.procedureCode === conflicting)) {
        issues.push({
          severity: "error",
          ruleId: rule.id,
          procedureCode: conflicting,
          message: "初診料と再診料は同一日に併算定できません",
        });
      }

      // 別表20: 初診=11 / 再診=12（入院外）
      const category = ctx.visit.visitType === "first" ? "11" : "12";
      return {
        lines: [{ procedureCode: code, name: row.name, points: row.points, quantity: 1, category }],
        issues,
      };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}
