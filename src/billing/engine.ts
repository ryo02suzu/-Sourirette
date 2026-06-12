/**
 * 算定エンジンの核。
 *
 * 設計（docs/master-plan.md §5）:
 *   - ルールは Rule インターフェースを実装する小さなユニットの集合。
 *   - 各ルールは適用期間を持ち、診療報酬改定時は新ルールを追加して旧ルールを閉じる。
 *   - 出力は「算定結果」「エラー（算定不可）」「警告（要確認）」の3層。
 *     エンジンは勝手に確定しない。最終確定は歯科医師の操作。
 */
import type { Diagnosis, Patient, PerformedProcedure, Visit } from "../domain/types.js";
import type { MasterRepository } from "./master.js";

/** 同月・同日の算定履歴（回数制限チェック用）。実装は DB を背後に持つ。 */
export interface CalculationHistory {
  /** 同一月内に指定コードを算定した回数（当日を除く） */
  countInMonth(procedureCode: string, visitDate: string): number;
}

/** 施設基準（届出）の照会 */
export interface FacilityStandards {
  has(standardCode: string, onDate: string): boolean;
}

export interface CalculationContext {
  patient: Patient;
  visit: Visit;
  procedures: PerformedProcedure[];
  diagnoses: Diagnosis[];
  history: CalculationHistory;
  facility: FacilityStandards;
  master: MasterRepository;
}

/** 算定結果の1行（レセプトの摘要欄・点数欄の素になる） */
export interface ClaimLine {
  procedureCode: string;
  name: string;
  points: number;
  quantity: number;
  teeth?: string[];
}

export interface CalculationIssue {
  severity: "error" | "warning";
  ruleId: string;
  message: string;
  procedureCode?: string;
}

export interface CalculationResult {
  lines: ClaimLine[];
  issues: CalculationIssue[];
  totalPoints: number;
}

export interface RuleOutput {
  lines?: ClaimLine[];
  issues?: CalculationIssue[];
}

export interface Rule {
  /** 一意なルールID（例: "basic-visit/2026-04"）。issue の出所追跡に使う */
  id: string;
  /** 適用期間（診療日で判定）。改定時は新ルールを追加し旧ルールの validTo を閉じる */
  validFrom: string;
  validTo?: string;
  evaluate(ctx: CalculationContext): RuleOutput;
}

export class CalculationEngine {
  constructor(private readonly rules: Rule[]) {}

  calculate(ctx: CalculationContext): CalculationResult {
    const lines: ClaimLine[] = [];
    const issues: CalculationIssue[] = [];

    for (const rule of this.rules) {
      const date = ctx.visit.visitDate;
      if (date < rule.validFrom || (rule.validTo !== undefined && date > rule.validTo)) {
        continue;
      }
      const out = rule.evaluate(ctx);
      if (out.lines) lines.push(...out.lines);
      if (out.issues) issues.push(...out.issues);
    }

    const totalPoints = lines.reduce((sum, l) => sum + l.points * l.quantity, 0);
    return { lines, issues, totalPoints };
  }
}
