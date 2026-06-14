/**
 * 部位×病名 歯式突合ルール（返戻・査定 頻出原因 #4）。
 *
 * 歯単位で算定される診療行為（抜歯・抜髄・充填・歯冠形成等）に付された歯（FDI）が、
 * 同レセプト内のいずれかの傷病名部位にも含まれているかを突合する。含まれない歯に対する
 * 処置はレセプト上の構造的不整合（部位特定不能＝返戻、または病名部位に該当処置なし＝査定）。
 *
 * これは henrei-satei-top20 で「完全自動」判定可能と整理された数少ない項目で、臨床判断を
 * 含まない（歯番の集合包含という客観的照合）ため error として扱う。
 * 部位を持たない診療行為（全顎・口腔単位等）は対象外（teeth 未指定はスキップ）。
 */
import type { CalculationContext, Rule, RuleOutput } from "../engine.js";

export function createSiteDiagnosisRule(validFrom: string, validTo?: string): Rule {
  const rule: Rule = {
    id: `site-diagnosis/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      const diagnosisTeeth = new Set<string>();
      for (const dx of ctx.diagnoses) {
        for (const t of dx.teeth ?? []) diagnosisTeeth.add(t);
      }

      const issues: RuleOutput["issues"] = [];
      for (const proc of ctx.procedures) {
        const teeth = proc.teeth ?? [];
        if (teeth.length === 0) continue; // 部位を持たない行為は対象外
        const uncovered = teeth.filter((t) => !diagnosisTeeth.has(t));
        if (uncovered.length > 0) {
          issues.push({
            severity: "error",
            ruleId: rule.id,
            procedureCode: proc.procedureCode,
            message:
              `処置の部位（${uncovered.join("・")}番）に対応する傷病名部位がありません。` +
              `傷病名の歯式と処置の歯番を一致させてください`,
          });
        }
      }
      return { issues };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}
