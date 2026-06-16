/**
 * データ駆動ルール解釈器のテスト（合成データで挙動のみ検証）。
 * 実コード・実点数は使わない＝解釈器が正しくテーブルを解釈するかだけを見る。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CalculationEngine, type CalculationContext } from "../src/billing/engine.js";
import { InMemoryMaster } from "../src/billing/master.js";
import { createDataDrivenRules, type RuleTables } from "../src/billing/rule-tables.js";
import type { PerformedProcedure } from "../src/domain/types.js";

function ctx(overrides: {
  procedures?: PerformedProcedure[];
  monthCounts?: Record<string, number>;
  standards?: string[];
  diseaseCodes?: string[];
  visitDate?: string;
}): CalculationContext {
  const monthCounts = overrides.monthCounts ?? {};
  const standards = new Set(overrides.standards ?? []);
  return {
    patient: { id: "p", birthDate: "1980-01-01", sex: "F" },
    visit: { id: "v", patientId: "p", visitDate: overrides.visitDate ?? "2026-06-12", visitType: "first" },
    procedures: overrides.procedures ?? [],
    diagnoses: (overrides.diseaseCodes ?? []).map((diseaseCode) => ({ diseaseCode, onsetDate: "2026-06-01" })),
    history: { countInMonth: (code) => monthCounts[code] ?? 0 },
    facility: { has: (code) => standards.has(code) },
    master: new InMemoryMaster(),
  };
}

const proc = (procedureCode: string, quantity = 1): PerformedProcedure => ({ procedureCode, quantity });

function engineFor(tables: RuleTables): CalculationEngine {
  return new CalculationEngine(createDataDrivenRules(tables, "2024-04-01"));
}

test("併算定不可（同日）: 両方算定でエラー、片方だけなら指摘なし", () => {
  const engine = engineFor({ mutualExclusions: [{ codeA: "AAA", codeB: "BBB", scope: "same-day" }] });
  const both = engine.calculate(ctx({ procedures: [proc("AAA"), proc("BBB")] }));
  assert.equal(both.issues.filter((i) => i.severity === "error").length, 1);
  const one = engine.calculate(ctx({ procedures: [proc("AAA")] }));
  assert.equal(one.issues.length, 0);
});

test("併算定不可（同月）: 一方が当日・他方が月内履歴でもエラー", () => {
  const engine = engineFor({ mutualExclusions: [{ codeA: "SPT", codeB: "SRP", scope: "same-month" }] });
  const r = engine.calculate(ctx({ procedures: [proc("SPT")], monthCounts: { SRP: 1 } }));
  assert.equal(r.issues.filter((i) => i.severity === "error").length, 1);
});

test("回数制限（月）: 当日＋履歴の合計が上限超過でエラー", () => {
  const engine = engineFor({ frequencyLimits: [{ code: "MNG", maxCount: 1, per: "month" }] });
  const over = engine.calculate(ctx({ procedures: [proc("MNG")], monthCounts: { MNG: 1 } }));
  assert.equal(over.issues.filter((i) => i.severity === "error").length, 1);
  const ok = engine.calculate(ctx({ procedures: [proc("MNG")] }));
  assert.equal(ok.issues.length, 0);
});

test("回数制限（日）: 同日2回で上限1回を超過", () => {
  const engine = engineFor({ frequencyLimits: [{ code: "X", maxCount: 1, per: "day" }] });
  const r = engine.calculate(ctx({ procedures: [proc("X", 2)] }));
  assert.equal(r.issues.filter((i) => i.severity === "error").length, 1);
});

test("包括: 含まれる側を別途算定でエラー", () => {
  const engine = engineFor({ inclusions: [{ includingCode: "SPT", includedCode: "SC", scope: "same-month" }] });
  const r = engine.calculate(ctx({ procedures: [proc("SPT"), proc("SC")] }));
  assert.ok(r.issues.some((i) => i.severity === "error" && i.procedureCode === "SC"));
});

test("施設基準ゲート: 届出なしで算定はエラー、届出ありなら通る", () => {
  const engine = engineFor({ facilityGates: [{ code: "GTR", requiredStandard: "99" }] });
  const without = engine.calculate(ctx({ procedures: [proc("GTR")] }));
  assert.equal(without.issues.filter((i) => i.severity === "error").length, 1);
  const withStd = engine.calculate(ctx({ procedures: [proc("GTR")], standards: ["99"] }));
  assert.equal(withStd.issues.length, 0);
});

test("病名適応: 必要病名なしは警告、禁忌病名ありは指摘", () => {
  const engine = engineFor({
    diagnosisRequirements: [
      { code: "BATSU", requiredDiseaseCodes: ["PER1", "PER2"] },
      { code: "JUTEN", forbiddenDiseaseCodes: ["DATSU"] },
    ],
  });
  // 必要病名なし → 警告
  const noDx = engine.calculate(ctx({ procedures: [proc("BATSU")] }));
  assert.equal(noDx.issues.filter((i) => i.severity === "warning").length, 1);
  // 必要病名あり → 指摘なし
  const withDx = engine.calculate(ctx({ procedures: [proc("BATSU")], diseaseCodes: ["PER2"] }));
  assert.equal(withDx.issues.length, 0);
  // 禁忌病名あり → 警告
  const forbidden = engine.calculate(ctx({ procedures: [proc("JUTEN")], diseaseCodes: ["DATSU"] }));
  assert.equal(forbidden.issues.filter((i) => i.severity === "warning").length, 1);
});

test("テーブル空なら何のルールも生成されない（器だけ・データ未投入）", () => {
  assert.equal(createDataDrivenRules({}, "2024-04-01").length, 0);
});

test("複数テーブル同時: 別々の指摘が独立に出る", () => {
  const engine = engineFor({
    mutualExclusions: [{ codeA: "A", codeB: "B", scope: "same-day" }],
    frequencyLimits: [{ code: "C", maxCount: 1, per: "day" }],
  });
  const r = engine.calculate(ctx({ procedures: [proc("A"), proc("B"), proc("C", 2)] }));
  assert.equal(r.issues.filter((i) => i.severity === "error").length, 2);
});
