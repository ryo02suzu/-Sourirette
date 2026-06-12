/**
 * 算定エンジンのデモ配線。
 *
 * コアの CalculationEngine / InMemoryMaster（src/billing）を実際に使い、
 * デモ用コード・サンプル点数で動かす。⚠️ 点数はすべてサンプル値。
 * 本番は支払基金の公式マスタ取込（valid_from 付き）に置き換える。
 */
import {
  CalculationEngine,
  type CalculationContext,
  type Rule,
  type RuleOutput,
} from "../../src/billing/engine.js";
import { InMemoryMaster } from "../../src/billing/master.js";
import { createBasicVisitRule } from "../../src/billing/rules/basic-visit.js";
import type { Diagnosis, PerformedProcedure } from "../../src/domain/types.js";

export const DEMO_CODES = {
  firstVisit: "DEMO-SHOSHIN",
  followupVisit: "DEMO-SAISHIN",
} as const;

const SINCE = "2026-04-01"; // デモ上の「現行改定」適用開始日

function buildMaster(): InMemoryMaster {
  const m = new InMemoryMaster();
  const rows: [string, string, number][] = [
    ["DEMO-SHOSHIN", "初診料", 260],
    ["DEMO-SAISHIN", "再診料", 55],
    ["DEMO-XRAY", "デンタルX線撮影・診断", 60],
    ["DEMO-MASUI", "浸潤麻酔", 30],
    ["DEMO-CR", "う蝕処置＋CR充填（光重合）", 160],
    ["DEMO-TBI", "ブラッシング指導（実地指導）", 80],
    ["DEMO-PKEN", "歯周基本検査", 200],
    ["DEMO-SCALING", "スケーリング（1/3顎）", 70],
  ];
  for (const [code, name, points] of rows) {
    m.add({ code, name, points, validFrom: SINCE });
  }
  return m;
}

/** 入力された診療行為をマスタの点数で算定行に変換する汎用ルール */
const procedurePricingRule: Rule = {
  id: `procedure-pricing/${SINCE}`,
  validFrom: SINCE,
  evaluate(ctx: CalculationContext): RuleOutput {
    const out: Required<RuleOutput> = { lines: [], issues: [] };
    for (const p of ctx.procedures) {
      // 基本診療料は basic-visit ルールが扱う
      if (p.procedureCode === DEMO_CODES.firstVisit || p.procedureCode === DEMO_CODES.followupVisit) continue;
      const row = ctx.master.findProcedure(p.procedureCode, ctx.visit.visitDate);
      if (!row) {
        out.issues.push({
          severity: "error",
          ruleId: this.id,
          procedureCode: p.procedureCode,
          message: `診療行為マスタに ${p.procedureCode} が見つかりません`,
        });
        continue;
      }
      const line: (typeof out.lines)[number] = {
        procedureCode: p.procedureCode,
        name: row.name,
        points: row.points,
        quantity: p.quantity,
      };
      if (p.teeth && p.teeth.length > 0) line.teeth = p.teeth;
      out.lines.push(line);
    }
    return out;
  },
};

/** 部位×病名×処置のトライアングルチェック（デモ: 充填にはう蝕病名が必要） */
const dxTriangleRule: Rule = {
  id: `dx-triangle/${SINCE}`,
  validFrom: SINCE,
  evaluate(ctx: CalculationContext): RuleOutput {
    const issues: RuleOutput["issues"] = [];
    const cr = ctx.procedures.find((p) => p.procedureCode === "DEMO-CR");
    if (cr) {
      const tooth = cr.teeth?.[0];
      const hasCariesDx = ctx.diagnoses.some(
        (d) => d.diseaseCode.includes("う蝕") && (!tooth || !d.teeth || d.teeth.length === 0 || d.teeth.includes(tooth)),
      );
      if (!hasCariesDx) {
        issues.push({
          severity: "error",
          ruleId: this.id,
          procedureCode: "DEMO-CR",
          message: `充填${tooth ? `（${tooth}）` : ""}に対応する傷病名（う蝕症）が登録されていません`,
        });
      }
    }
    // 歯周炎の病名があるのに当日 P検もスケーリングもない → 流れの確認を促す
    const hasPerioDx = ctx.diagnoses.some((d) => d.diseaseCode.includes("歯周炎"));
    const hasPerioWork = ctx.procedures.some((p) => p.procedureCode === "DEMO-PKEN" || p.procedureCode === "DEMO-SCALING");
    if (hasPerioDx && !hasPerioWork) {
      issues.push({
        severity: "warning",
        ruleId: this.id,
        message: "傷病名「歯周炎」があります。歯周検査・歯周基本治療の算定漏れがないか確認してください",
      });
    }
    return { issues };
  },
};

export interface DemoEngineInput {
  visitType: "first" | "followup";
  visitDate: string;
  procedures: PerformedProcedure[];
  diagnoses: Diagnosis[];
}

const engine = new CalculationEngine([
  createBasicVisitRule(DEMO_CODES, SINCE),
  procedurePricingRule,
  dxTriangleRule,
]);
const master = buildMaster();

export function calculateDemo(input: DemoEngineInput) {
  return engine.calculate({
    patient: { id: "demo", birthDate: "1981-02-14", sex: "F" },
    visit: { id: "demo-visit", patientId: "demo", visitDate: input.visitDate, visitType: input.visitType },
    procedures: input.procedures,
    diagnoses: input.diagnoses,
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master,
  });
}

export function masterName(code: string, onDate: string): string {
  return master.findProcedure(code, onDate)?.name ?? code;
}
