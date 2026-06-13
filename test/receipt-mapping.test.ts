/**
 * レセプト種別（別表6）・負担区分（別表21）の決定と、算定エンジン→UKE 橋渡しのテスト。
 * 期待値は記録条件仕様（歯科用）令和8年6月版の別表から直接照合。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  determineBurden,
  determineReceiptType,
  outcomeCode,
  sexCode,
} from "../src/receipt/receipt-type.js";
import { claimToReceipt, monthlyClaimToReceipt, type VisitClaim } from "../src/receipt/from-claim.js";
import { serializeRecord } from "../src/receipt/uke.js";
import { assembleUkeFile } from "../src/receipt/build.js";
import { CalculationEngine, type CalculationResult } from "../src/billing/engine.js";
import { InMemoryMaster } from "../src/billing/master.js";
import { createBasicVisitRule } from "../src/billing/rules/basic-visit.js";
import type { Diagnosis, Patient, Visit } from "../src/domain/types.js";

// ---- 別表6 レセプト種別 ----

test("レセプト種別: 医保単独・入院外（本人=3112 / 未就学=3114 / 家族=3116）", () => {
  const base = { publicExpenseCount: 0, admission: false } as const;
  assert.equal(determineReceiptType({ ...base, scheme: { kind: "medical", beneficiary: "principal" } }), "3112");
  assert.equal(determineReceiptType({ ...base, scheme: { kind: "medical", beneficiary: "preschool" } }), "3114");
  assert.equal(determineReceiptType({ ...base, scheme: { kind: "medical", beneficiary: "family" } }), "3116");
});

test("レセプト種別: 医保単独・本人・入院=3111、高齢7割・入院外=3110", () => {
  assert.equal(
    determineReceiptType({ scheme: { kind: "medical", beneficiary: "principal" }, publicExpenseCount: 0, admission: true }),
    "3111",
  );
  assert.equal(
    determineReceiptType({ scheme: { kind: "medical", beneficiary: "elderly-7" }, publicExpenseCount: 0, admission: false }),
    "3110",
  );
});

test("レセプト種別: 医保+公費併用（1種=312x / 3種・本人入院外=3142）", () => {
  assert.equal(
    determineReceiptType({ scheme: { kind: "medical", beneficiary: "principal" }, publicExpenseCount: 1, admission: false }),
    "3122",
  );
  assert.equal(
    determineReceiptType({ scheme: { kind: "medical", beneficiary: "principal" }, publicExpenseCount: 3, admission: false }),
    "3142",
  );
});

test("レセプト種別: 公費単独・入院外=3212、2種公費併用・入院=3221", () => {
  assert.equal(determineReceiptType({ scheme: { kind: "public-only" }, publicExpenseCount: 1, admission: false }), "3212");
  assert.equal(determineReceiptType({ scheme: { kind: "public-only" }, publicExpenseCount: 2, admission: true }), "3221");
});

test("レセプト種別: 後期高齢者単独（一般入院外=3318 / 7割入院外=3310）・+2種公費一般入院=3337", () => {
  assert.equal(determineReceiptType({ scheme: { kind: "koki", category: "general" }, publicExpenseCount: 0, admission: false }), "3318");
  assert.equal(determineReceiptType({ scheme: { kind: "koki", category: "7" }, publicExpenseCount: 0, admission: false }), "3310");
  assert.equal(determineReceiptType({ scheme: { kind: "koki", category: "general" }, publicExpenseCount: 2, admission: true }), "3337");
});

test("レセプト種別: 不正入力は拒否（公費5種・公費単独で0種）", () => {
  assert.throws(
    () => determineReceiptType({ scheme: { kind: "medical", beneficiary: "principal" }, publicExpenseCount: 5, admission: false }),
    /公費種数は0〜4/,
  );
  assert.throws(
    () => determineReceiptType({ scheme: { kind: "public-only" }, publicExpenseCount: 0, admission: false }),
    /公費種数は1以上/,
  );
});

// ---- 別表21 負担区分 ----

test("負担区分: 医保単独=1、公費①単独=5、医保+公費①=2、医保+①+②=4、5者=9", () => {
  assert.equal(determineBurden({ medical: true }), "1");
  assert.equal(determineBurden({ medical: false, publicExpenses: [true] }), "5");
  assert.equal(determineBurden({ medical: true, publicExpenses: [true] }), "2");
  assert.equal(determineBurden({ medical: true, publicExpenses: [true, true] }), "4");
  assert.equal(determineBurden({ medical: true, publicExpenses: [true, true, true, true] }), "9");
});

test("負担区分: 公費②③④単独・組合せ（公費②=6 / 公費③④=L / 医保+公費④=G）", () => {
  assert.equal(determineBurden({ medical: false, publicExpenses: [false, true] }), "6");
  assert.equal(determineBurden({ medical: false, publicExpenses: [false, false, true, true] }), "L");
  assert.equal(determineBurden({ medical: true, publicExpenses: [false, false, false, true] }), "G");
});

test("男女区分・転帰区分の変換", () => {
  assert.equal(sexCode("M"), "1");
  assert.equal(sexCode("F"), "2");
  assert.equal(outcomeCode(undefined), "1");
  assert.equal(outcomeCode("cured"), "2");
  assert.equal(outcomeCode("transferred"), "4");
});

// ---- 算定エンジン → UKE 橋渡し ----

const CODES = { firstVisit: "313000110", followupVisit: "313000210" };

function makeResult(visitDate: string): { result: CalculationResult; patient: Patient; visit: Visit; diagnoses: Diagnosis[] } {
  const master = new InMemoryMaster();
  master.add({ code: CODES.firstVisit, name: "歯科初診料", points: 272, validFrom: "2026-06-01" });
  const engine = new CalculationEngine([createBasicVisitRule(CODES, "2026-06-01")]);
  const patient: Patient = { id: "p1", birthDate: "1980-06-30", sex: "F" };
  const visit: Visit = { id: "v1", patientId: "p1", visitDate, visitType: "first" };
  const diagnoses: Diagnosis[] = [{ diseaseCode: "8830052", teeth: ["16"], onsetDate: "2026-06-05" }];
  const result = engine.calculate({
    patient,
    visit,
    procedures: [],
    diagnoses,
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master,
  });
  return { result, patient, visit, diagnoses };
}

test("橋渡し: 初診の算定結果が SS（識別11・算定日・点数）になる", () => {
  const { result, patient, visit, diagnoses } = makeResult("2026-06-12");
  const receipt = claimToReceipt({
    patient,
    visit,
    diagnoses,
    result,
    receiptNo: 1,
    scheme: { kind: "medical", beneficiary: "family" },
    name: "基金　花子",
    kanaName: "キキンハナコ",
    insurer: { insurerNo: "01130012", symbol: "11010203", number: "123" },
  });
  // RE: 種別3116（医保単独・家族・入院外）・女=2・生年月日
  assert.equal(serializeRecord(receipt.re).startsWith("RE,1,3116,202606,基金　花子,2,19800630,"), true, serializeRecord(receipt.re));
  // HO: 合計点数=272
  assert.equal(serializeRecord(receipt.ho!), "HO,01130012,11010203,123,1,272,,,,,,,,");
  // HS: 16番(101600 現存歯)・う蝕病名
  assert.equal(serializeRecord(receipt.hs[0]!), "HS,,,101600,8830052,,,,,,,,");
  // SS: 識別11・負担区分1・コード313000110・点数272・回数1・12日に1
  const ss = serializeRecord(receipt.details[0]!).split(",");
  assert.equal(ss[0], "SS");
  assert.equal(ss[1], "11"); // 診療識別
  assert.equal(ss[2], "1"); // 負担区分
  assert.equal(ss[3], "313000110"); // 診療行為コード
  assert.equal(ss[76], "272"); // 点数
  assert.equal(ss[77], "1"); // 回数
  assert.equal(ss[78 + 11], "1"); // 12日の情報
});

test("橋渡し: assembleUkeFile で UK→IR→RE→HO→HS→SS→GO の完全なファイルになる", () => {
  const { result, patient, visit, diagnoses } = makeResult("2026-06-12");
  const receipt = claimToReceipt({
    patient,
    visit,
    diagnoses,
    result,
    receiptNo: 1,
    scheme: { kind: "medical", beneficiary: "family" },
    name: "基金　花子",
    insurer: { insurerNo: "01130012", number: "123" },
  });
  const records = assembleUkeFile({
    facility: {
      payer: "1",
      prefecture: "13",
      facilityCode: "1234567",
      facilityName: "基金歯科医院",
      billingMonth: "202607",
    },
    receipts: [receipt],
  });
  assert.deepEqual(records.map((r) => r.identifier), ["UK", "IR", "RE", "HO", "HS", "SS", "GO"]);
  assert.equal(serializeRecord(records[records.length - 1]!), "GO,1,272,99");
});

// ---- 月次集約 ----

/** 指定日・受診種別の1受診分の算定結果を作る（初診=初診料272 / 再診=再診料59） */
function makeVisit(visitDate: string, visitType: "first" | "followup"): VisitClaim {
  const master = new InMemoryMaster();
  master.add({ code: CODES.firstVisit, name: "歯科初診料", points: 272, validFrom: "2026-06-01" });
  master.add({ code: CODES.followupVisit, name: "歯科再診料", points: 59, validFrom: "2026-06-01" });
  const engine = new CalculationEngine([createBasicVisitRule(CODES, "2026-06-01")]);
  const visit: Visit = { id: `v-${visitDate}`, patientId: "p1", visitDate, visitType };
  const result = engine.calculate({
    patient: { id: "p1", birthDate: "1980-06-30", sex: "F" },
    visit,
    procedures: [],
    diagnoses: [],
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master,
  });
  return { visit, result };
}

test("月次集約: 初診1回＋再診2回 → 診療実日数3・再診を1レコードにマージ（回数2）", () => {
  const visits = [
    makeVisit("2026-06-05", "first"),
    makeVisit("2026-06-12", "followup"),
    makeVisit("2026-06-19", "followup"),
  ];
  const receipt = monthlyClaimToReceipt({
    patient: { id: "p1", birthDate: "1980-06-30", sex: "F" },
    visits,
    diagnoses: [{ diseaseCode: "5250001", teeth: ["16"], onsetDate: "2026-06-05" }],
    receiptNo: 1,
    scheme: { kind: "medical", beneficiary: "family" },
    name: "基金　花子",
    insurer: { insurerNo: "01130012", number: "123" },
  });

  // HO: 診療実日数=3、合計点数=272+59+59=390
  assert.equal(serializeRecord(receipt.ho!), "HO,01130012,,123,3,390,,,,,,,,");

  // SS は2レコード（初診・再診マージ）
  assert.equal(receipt.details.length, 2);
  const first = serializeRecord(receipt.details[0]!).split(",");
  assert.equal(first[3], "313000110"); // 初診料
  assert.equal(first[77], "1"); // 回数1
  assert.equal(first[78 + 4], "1"); // 5日に1

  const re = serializeRecord(receipt.details[1]!).split(",");
  assert.equal(re[3], "313000210"); // 再診料
  assert.equal(re[76], "59"); // 点数（単価）
  assert.equal(re[77], "2"); // 回数2（マージ）
  assert.equal(re[78 + 11], "1"); // 12日に1
  assert.equal(re[78 + 18], "1"); // 19日に1
});

test("月次集約: 診療月の混在は拒否", () => {
  assert.throws(
    () =>
      monthlyClaimToReceipt({
        patient: { id: "p1", birthDate: "1980-06-30", sex: "F" },
        visits: [makeVisit("2026-06-05", "first"), makeVisit("2026-07-03", "followup")],
        diagnoses: [{ diseaseCode: "5250001", onsetDate: "2026-06-05" }],
        receiptNo: 1,
        scheme: { kind: "medical", beneficiary: "family" },
        name: "基金　花子",
        insurer: { insurerNo: "01130012", number: "123" },
      }),
    /同一診療月/,
  );
});

test("月次集約: 同一傷病名の重複は1レコードに集約", () => {
  const receipt = monthlyClaimToReceipt({
    patient: { id: "p1", birthDate: "1980-06-30", sex: "F" },
    visits: [makeVisit("2026-06-05", "first")],
    diagnoses: [
      { diseaseCode: "5250001", teeth: ["16"], onsetDate: "2026-06-05" },
      { diseaseCode: "5250001", teeth: ["16"], onsetDate: "2026-06-05" },
    ],
    receiptNo: 1,
    scheme: { kind: "medical", beneficiary: "family" },
    name: "基金　花子",
    insurer: { insurerNo: "01130012", number: "123" },
  });
  assert.equal(receipt.hs.length, 1);
});

test("橋渡し: 公費単独レセプトの負担区分は公費①（=5）になる", () => {
  const { result, patient, visit, diagnoses } = makeResult("2026-06-12");
  const receipt = claimToReceipt({
    patient,
    visit,
    diagnoses,
    result,
    receiptNo: 1,
    scheme: { kind: "public-only" },
    publicExpenseCount: 1,
    name: "基金　太郎",
    insurer: { insurerNo: "01130012", number: "123" },
  });
  const ss = serializeRecord(receipt.details[0]!).split(",");
  assert.equal(ss[2], "5"); // 負担区分 = 公費①単独
});
