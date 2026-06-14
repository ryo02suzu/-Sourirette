/**
 * データ駆動の算定ルール（「全部を載せる器」）。
 *
 * 設計思想（絶対原則 #1: 点数・コードをハードコードしない）:
 *   歯科の算定ルールは数百〜千あり、手書きすると必ず間違える。そこで本モジュールは
 *   ルールを「コード」ではなく「データ（テーブル）」として持ち、エンジンはそれを解釈するだけ
 *   にする。公式の機械可読データ（歯科診療行為マスタの関連別紙＝背反/包括/回数、電子点数表、
 *   支払基金コンピュータチェック対象事例 等）を取り込めば、テーブルを差し替えるだけで
 *   ルールが効き、改定追従も差し替えで済む。
 *
 * ⚠️ 本モジュールはルールの「解釈器」であって、ルールデータそのものは含まない。
 *    実データは公式の一次資料を取り込み、歯科医師レビューを経て投入する。
 *    ここでのテストは合成データ（架空コード）で解釈器の挙動のみを検証する。
 */
import type { CalculationContext, CalculationIssue, Rule, RuleOutput } from "./engine.js";

export type Scope = "same-day" | "same-month";

/** 併算定不可（背反）: codeA と codeB を同一範囲で併算定できない */
export interface MutualExclusion {
  codeA: string;
  codeB: string;
  scope: Scope;
  /** 既定 error（算定不可）。査定リスクで判断が割れるものは warning にする */
  severity?: "error" | "warning";
  note?: string;
}

/** 回数制限: code は per あたり maxCount 回まで */
export interface FrequencyLimit {
  code: string;
  maxCount: number;
  per: "day" | "month";
  note?: string;
}

/** 包括: includingCode を算定するとき includedCode は別途算定できない（含まれる） */
export interface InclusionRule {
  includingCode: string;
  includedCode: string;
  scope: Scope;
  note?: string;
}

/** 施設基準ゲート: code（行為・加算）は requiredStandard の届出が前提 */
export interface FacilityGate {
  code: string;
  /** 別表5等の施設基準届出コード */
  requiredStandard: string;
  note?: string;
}

/** 病名適応: code は requiredDiseaseCodes のいずれかが必要／forbiddenDiseaseCodes は禁忌 */
export interface DiagnosisRequirement {
  code: string;
  requiredDiseaseCodes?: string[];
  forbiddenDiseaseCodes?: string[];
  /** 既定 warning（病名整合は審査委員裁量があり警告が安全） */
  severity?: "error" | "warning";
  note?: string;
}

export interface RuleTables {
  mutualExclusions?: MutualExclusion[];
  frequencyLimits?: FrequencyLimit[];
  inclusions?: InclusionRule[];
  facilityGates?: FacilityGate[];
  diagnosisRequirements?: DiagnosisRequirement[];
}

// ---- 共通ヘルパ ----

/** 当日（このレセプト計算の入力）に code が何回算定されたか */
function countToday(ctx: CalculationContext, code: string): number {
  return ctx.procedures.filter((p) => p.procedureCode === code).reduce((n, p) => n + p.quantity, 0);
}

/** 当月に code が算定されたか（当日入力＋当日を除く月内履歴） */
function presentThisMonth(ctx: CalculationContext, code: string): boolean {
  return countToday(ctx, code) > 0 || ctx.history.countInMonth(code, ctx.visit.visitDate) > 0;
}

function issue(severity: "error" | "warning", ruleId: string, message: string, procedureCode?: string): CalculationIssue {
  return procedureCode !== undefined ? { severity, ruleId, message, procedureCode } : { severity, ruleId, message };
}

// ---- 解釈器（ルールファクトリ） ----

/** 併算定不可（背反）ルール */
export function createMutualExclusionRule(table: MutualExclusion[], validFrom: string, validTo?: string): Rule {
  const rule: Rule = {
    id: `rule-table/mutual-exclusion/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      const issues: CalculationIssue[] = [];
      for (const ex of table) {
        const both =
          ex.scope === "same-day"
            ? countToday(ctx, ex.codeA) > 0 && countToday(ctx, ex.codeB) > 0
            : presentThisMonth(ctx, ex.codeA) && presentThisMonth(ctx, ex.codeB);
        if (both) {
          issues.push(
            issue(
              ex.severity ?? "error",
              rule.id,
              `${ex.codeA} と ${ex.codeB} は${ex.scope === "same-day" ? "同日" : "同月"}に併算定できません${ex.note ? `（${ex.note}）` : ""}`,
              ex.codeA,
            ),
          );
        }
      }
      return { issues };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}

/** 回数制限ルール */
export function createFrequencyLimitRule(table: FrequencyLimit[], validFrom: string, validTo?: string): Rule {
  const rule: Rule = {
    id: `rule-table/frequency-limit/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      const issues: CalculationIssue[] = [];
      for (const lim of table) {
        const count =
          lim.per === "day"
            ? countToday(ctx, lim.code)
            : countToday(ctx, lim.code) + ctx.history.countInMonth(lim.code, ctx.visit.visitDate);
        if (count > lim.maxCount) {
          issues.push(
            issue(
              "error",
              rule.id,
              `${lim.code} は${lim.per === "day" ? "1日" : "月"}${lim.maxCount}回までです（算定${count}回）${lim.note ? `（${lim.note}）` : ""}`,
              lim.code,
            ),
          );
        }
      }
      return { issues };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}

/** 包括ルール（含まれる側を別途算定したらエラー） */
export function createInclusionRule(table: InclusionRule[], validFrom: string, validTo?: string): Rule {
  const rule: Rule = {
    id: `rule-table/inclusion/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      const issues: CalculationIssue[] = [];
      for (const inc of table) {
        const both =
          inc.scope === "same-day"
            ? countToday(ctx, inc.includingCode) > 0 && countToday(ctx, inc.includedCode) > 0
            : presentThisMonth(ctx, inc.includingCode) && presentThisMonth(ctx, inc.includedCode);
        if (both) {
          issues.push(
            issue(
              "error",
              rule.id,
              `${inc.includedCode} は ${inc.includingCode} に包括され別途算定できません${inc.note ? `（${inc.note}）` : ""}`,
              inc.includedCode,
            ),
          );
        }
      }
      return { issues };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}

/** 施設基準ゲートルール（届出なしで算定したらエラー） */
export function createFacilityGateRule(table: FacilityGate[], validFrom: string, validTo?: string): Rule {
  const rule: Rule = {
    id: `rule-table/facility-gate/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      const issues: CalculationIssue[] = [];
      for (const gate of table) {
        if (countToday(ctx, gate.code) > 0 && !ctx.facility.has(gate.requiredStandard, ctx.visit.visitDate)) {
          issues.push(
            issue(
              "error",
              rule.id,
              `${gate.code} の算定には施設基準（届出コード ${gate.requiredStandard}）の届出が必要です${gate.note ? `（${gate.note}）` : ""}`,
              gate.code,
            ),
          );
        }
      }
      return { issues };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}

/** 病名適応ルール（必要病名なし／禁忌病名あり） */
export function createDiagnosisRequirementRule(table: DiagnosisRequirement[], validFrom: string, validTo?: string): Rule {
  const rule: Rule = {
    id: `rule-table/diagnosis-requirement/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext): RuleOutput {
      const issues: CalculationIssue[] = [];
      const diseaseCodes = new Set(ctx.diagnoses.map((d) => d.diseaseCode));
      for (const req of table) {
        if (countToday(ctx, req.code) === 0) continue;
        const severity = req.severity ?? "warning";
        if (req.requiredDiseaseCodes && req.requiredDiseaseCodes.length > 0) {
          const hasAny = req.requiredDiseaseCodes.some((c) => diseaseCodes.has(c));
          if (!hasAny) {
            issues.push(issue(severity, rule.id, `${req.code} に対応する傷病名がありません${req.note ? `（${req.note}）` : ""}`, req.code));
          }
        }
        for (const forbidden of req.forbiddenDiseaseCodes ?? []) {
          if (diseaseCodes.has(forbidden)) {
            issues.push(issue(severity, rule.id, `${req.code} は傷病名 ${forbidden} に対しては算定できません${req.note ? `（${req.note}）` : ""}`, req.code));
          }
        }
      }
      return { issues };
    },
  };
  if (validTo !== undefined) rule.validTo = validTo;
  return rule;
}

/** テーブル一式から、該当する解釈器ルールをまとめて生成する */
export function createDataDrivenRules(tables: RuleTables, validFrom: string, validTo?: string): Rule[] {
  const rules: Rule[] = [];
  if (tables.mutualExclusions && tables.mutualExclusions.length > 0) {
    rules.push(createMutualExclusionRule(tables.mutualExclusions, validFrom, validTo));
  }
  if (tables.frequencyLimits && tables.frequencyLimits.length > 0) {
    rules.push(createFrequencyLimitRule(tables.frequencyLimits, validFrom, validTo));
  }
  if (tables.inclusions && tables.inclusions.length > 0) {
    rules.push(createInclusionRule(tables.inclusions, validFrom, validTo));
  }
  if (tables.facilityGates && tables.facilityGates.length > 0) {
    rules.push(createFacilityGateRule(tables.facilityGates, validFrom, validTo));
  }
  if (tables.diagnosisRequirements && tables.diagnosisRequirements.length > 0) {
    rules.push(createDiagnosisRequirementRule(tables.diagnosisRequirements, validFrom, validTo));
  }
  return rules;
}
