/**
 * 窓口負担・高額療養費（自己負担限度額）計算のテスト。公式の標準例で検証。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCopayment, roundTo10Yen } from "../src/billing/copayment.js";

test("端数処理: 10円未満四捨五入", () => {
  assert.equal(roundTo10Yen(2814), 2810);
  assert.equal(roundTo10Yen(2815), 2820);
  assert.equal(roundTo10Yen(2819), 2820);
});

test("高額療養費: 70歳未満・区分ウ・総医療費100万円の標準例", () => {
  // 総点数100,000点＝総医療費1,000,000円、3割＝300,000円
  // 限度額ウ = 80,100 +(1,000,000-267,000)×1% = 87,430円、高額療養費 = 212,570円
  const r = calculateCopayment({ totalPoints: 100000, birthDate: "1980-01-01", copayRatio: 0.3, category: "ウ", onDate: "2026-06-12" });
  assert.equal(r.grossMedicalCost, 1000000);
  assert.equal(r.burdenBeforeCap, 300000);
  assert.equal(r.monthlyLimit, 87430);
  assert.equal(r.windowBurden, 87430);
  assert.equal(r.highCostBenefit, 212570);
});

test("高額療養費: 限度額に達しない場合は窓口負担そのまま", () => {
  // 総点数5,000点＝50,000円、3割＝15,000円。区分エ限度額57,600円に未達
  const r = calculateCopayment({ totalPoints: 5000, birthDate: "1980-01-01", copayRatio: 0.3, category: "エ", onDate: "2026-06-12" });
  assert.equal(r.windowBurden, 15000);
  assert.equal(r.highCostBenefit, 0);
});

test("高額療養費: 多数回該当は限度額が下がる（区分ウ→44,400円）", () => {
  const r = calculateCopayment({ totalPoints: 100000, birthDate: "1980-01-01", copayRatio: 0.3, category: "ウ", isMultiple: true, onDate: "2026-06-12" });
  assert.equal(r.monthlyLimit, 44400);
  assert.equal(r.windowBurden, 44400);
});

test("高額療養費: 70歳以上・一般・1割（世帯限度額57,600円で頭打ち）", () => {
  // 総点数70,000点＝700,000円、1割＝70,000円 → 一般 世帯限度額57,600円
  const r = calculateCopayment({ totalPoints: 70000, birthDate: "1950-01-01", copayRatio: 0.1, category: "一般", onDate: "2026-06-12" });
  assert.equal(r.monthlyLimit, 57600);
  assert.equal(r.windowBurden, 57600);
  assert.equal(r.highCostBenefit, 70000 - 57600);
});

test("整合性チェック: 年齢と所得区分の不整合は拒否", () => {
  // 70歳以上区分を70歳未満の患者に指定
  assert.throws(
    () => calculateCopayment({ totalPoints: 1000, birthDate: "1990-01-01", copayRatio: 0.3, category: "一般", onDate: "2026-06-12" }),
    /不整合/,
  );
});

test("認定証なし（窓口で限度額を適用しない）と適用ありの差", () => {
  const noCap = calculateCopayment({ totalPoints: 100000, birthDate: "1980-01-01", copayRatio: 0.3, category: "ウ", applyCapAtWindow: false, onDate: "2026-06-12" });
  assert.equal(noCap.windowBurden, 300000); // 窓口は全額、高額療養費は後で償還
  assert.equal(noCap.highCostBenefit, 0);
});
