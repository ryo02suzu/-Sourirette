import { test } from "node:test";
import assert from "node:assert/strict";
import { CalculationEngine, type CalculationContext } from "../src/billing/engine.js";
import { InMemoryMaster } from "../src/billing/master.js";
import { createBasicVisitRule } from "../src/billing/rules/basic-visit.js";
import { ageAt } from "../src/domain/types.js";

// ⚠️ テスト用のダミーコード・サンプル点数。実コード・実点数は公式マスタを取込んで使う。
const CODES = { firstVisit: "TEST-SHOSHIN", followupVisit: "TEST-SAISHIN" };

function makeContext(overrides: Partial<CalculationContext> = {}): CalculationContext {
  const master = new InMemoryMaster();
  // 改定を模擬: 同一コードで適用期間の異なる2世代の点数を登録
  master.add({ code: CODES.firstVisit, name: "初診料", points: 100, validFrom: "2024-06-01", validTo: "2026-05-31" });
  master.add({ code: CODES.firstVisit, name: "初診料", points: 120, validFrom: "2026-06-01" });
  master.add({ code: CODES.followupVisit, name: "再診料", points: 50, validFrom: "2024-06-01" });
  return {
    patient: { id: "p1", birthDate: "1990-01-01", sex: "F" },
    visit: { id: "v1", patientId: "p1", visitDate: "2026-06-12", visitType: "first" },
    procedures: [],
    diagnoses: [],
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master,
    ...overrides,
  };
}

const engine = new CalculationEngine([createBasicVisitRule(CODES, "2024-06-01")]);

test("初診で初診料が算定され、点数は診療日時点のマスタから引かれる", () => {
  const result = engine.calculate(makeContext());
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]!.procedureCode, CODES.firstVisit);
  assert.equal(result.totalPoints, 120); // 2026-06-01 改定後の世代
  assert.equal(result.issues.length, 0);
});

test("改定前の診療日では旧点数で算定される（過去日の再計算）", () => {
  const ctx = makeContext();
  ctx.visit = { ...ctx.visit, visitDate: "2026-05-01" };
  const result = engine.calculate(ctx);
  assert.equal(result.totalPoints, 100);
});

test("初診料と再診料の併算定はエラーになる", () => {
  const ctx = makeContext({
    procedures: [{ procedureCode: CODES.followupVisit, quantity: 1 }],
  });
  const result = engine.calculate(ctx);
  assert.ok(result.issues.some((i) => i.severity === "error"));
});

test("マスタに存在しないコードはエラー（点数のハードコードがないことの裏返し）", () => {
  // ルールは適用されるが、マスタにその診療日の世代が存在しないケース
  const oldEngine = new CalculationEngine([createBasicVisitRule(CODES, "2010-01-01")]);
  const ctx = makeContext();
  ctx.visit = { ...ctx.visit, visitDate: "2010-01-01" }; // マスタは 2024-06-01 以降のみ
  const result = oldEngine.calculate(ctx);
  assert.equal(result.lines.length, 0);
  assert.equal(result.issues[0]?.severity, "error");
});

test("excludesFromBilling: 包括された行は合計点数・請求行から除外される（指摘は残る）", () => {
  // 2行を出すルール＋一方を excludesFromBilling で除外指示するルール
  const lineRule = {
    id: "two-lines",
    validFrom: "2024-01-01",
    evaluate: () => ({
      lines: [
        { procedureCode: "PARENT", name: "親", points: 234, quantity: 1 },
        { procedureCode: "CHILD", name: "子（包括）", points: 33, quantity: 1 },
      ],
    }),
  };
  const inclusionRule = {
    id: "incl",
    validFrom: "2024-01-01",
    evaluate: () => ({
      issues: [{ severity: "error" as const, ruleId: "incl", procedureCode: "CHILD", excludesFromBilling: true, message: "CHILD は PARENT に包括" }],
    }),
  };
  const eng = new CalculationEngine([lineRule, inclusionRule]);
  const r = eng.calculate(makeContext());
  assert.equal(r.totalPoints, 234, "包括された子の点数が合計に残っている");
  assert.ok(!r.lines.some((l) => l.procedureCode === "CHILD"), "包括された子が請求行に残っている");
  assert.ok(r.issues.some((i) => i.procedureCode === "CHILD"), "包括の指摘が消えている");
});

test("ageAt: 6歳の誕生日当日は6歳（乳幼児境界が環境TZに依存しない）", () => {
  assert.equal(ageAt("2020-06-14", "2026-06-14"), 6);
  assert.equal(ageAt("2020-06-15", "2026-06-14"), 5);
});
