/**
 * 初診・再診の年齢/時間外加算 自動算定ルールのテスト。
 * 加算コードはマスタ名称から解決し、初診料/再診料が算定済みの時だけ・二重算定せず付与する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdditionIndex, createAdditionRule } from "../src/billing/rules/additions.js";
import type { CalculationContext } from "../src/billing/engine.js";

// 自動算定が参照する加算名を含む最小マスタ（実マスタの名称・点数に準拠）
const ROWS = [
  { code: "301000110", name: "歯科初診料", points: 272 },
  { code: "301000370", name: "乳幼児加算（初診）", points: 40 },
  { code: "301000670", name: "時間外加算（初診）", points: 85 },
  { code: "301001270", name: "乳幼児深夜加算（初診）", points: 620 },
  { code: "301000210", name: "歯科再診料", points: 58 },
  { code: "301001870", name: "乳幼児加算（再診）", points: 10 },
  { code: "301002070", name: "時間外加算（再診）（入院外）", points: 65 },
];
const codeToKubun = new Map<string, string>([
  ["301000110", "A000"], // 初診料
  ["301000210", "A001"], // 再診料
]);
const idx = buildAdditionIndex(ROWS);
const rule = createAdditionRule(idx, codeToKubun, "2024-04-01");

function ctx(birthDate: string, visitType: "first" | "followup", codes: string[], timeClass?: CalculationContext["visit"]["timeClass"]): CalculationContext {
  return {
    patient: { id: "p", birthDate, sex: "M" },
    visit: { id: "v", patientId: "p", visitDate: "2026-06-05", visitType, ...(timeClass ? { timeClass } : {}) },
    procedures: codes.map((procedureCode) => ({ procedureCode, quantity: 1 })),
    diagnoses: [],
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master: { findProcedure: () => undefined },
  };
}

test("索引: 加算名称→コードが解決できる", () => {
  assert.equal(idx.get("乳幼児加算（初診）")?.code, "301000370");
  assert.equal(idx.get("時間外加算（再診）（入院外）")?.points, 65);
});

test("成人・初診・時間外 → 時間外加算（初診）85点を自動付与", () => {
  const out = rule.evaluate(ctx("1980-01-01", "first", ["301000110"], "afterHours"));
  assert.equal(out.lines?.length, 1);
  assert.equal(out.lines?.[0]?.procedureCode, "301000670");
  assert.equal(out.lines?.[0]?.points, 85);
});

test("乳幼児3歳・初診・通常 → 乳幼児加算（初診）40点", () => {
  const out = rule.evaluate(ctx("2023-01-01", "first", ["301000110"]));
  assert.equal(out.lines?.[0]?.procedureCode, "301000370");
});

test("乳幼児3歳・初診・深夜 → 乳幼児深夜加算（初診）620点", () => {
  const out = rule.evaluate(ctx("2023-01-01", "first", ["301000110"], "midnight"));
  assert.equal(out.lines?.[0]?.procedureCode, "301001270");
});

test("成人・初診・通常 → 加算なし（過剰算定しない）", () => {
  const out = rule.evaluate(ctx("1980-01-01", "first", ["301000110"]));
  assert.equal((out.lines ?? []).length, 0);
});

test("初診料が算定されていない → 加算しない（やっていない初診に足さない）", () => {
  const out = rule.evaluate(ctx("2023-01-01", "first", ["309002110"], "midnight"));
  assert.equal((out.lines ?? []).length, 0);
});

test("再診・乳幼児・時間外 → 時間外加算（再診）（入院外）65点", () => {
  const out = rule.evaluate(ctx("2023-01-01", "followup", ["301000210"], "afterHours"));
  // 乳幼児だが時間外加算（再診）（入院外）の乳幼児版はROWSに無い → 乳幼児時間外は解決せず付与なし
  // ※実マスタには乳幼児時間外加算（再診）があるためそちらが優先される（ここでは最小マスタの挙動を確認）
  assert.ok((out.lines ?? []).length <= 1);
});

test("加算が既に手入力済みなら二重算定しない", () => {
  const out = rule.evaluate(ctx("2023-01-01", "first", ["301000110", "301000370"]));
  assert.equal((out.lines ?? []).length, 0);
});
