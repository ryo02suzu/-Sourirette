/**
 * UKE 自己点検バリデータ・パーサ・返戻再請求・部位突合ルールのテスト。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeUkeFile, encodeUkeFile, parseFile, parseRecord, serializeRecord } from "../src/receipt/uke.js";
import { assembleUkeFile, type UkeReceipt } from "../src/receipt/build.js";
import { buildCo, buildHo, buildHs, buildRe, buildSs } from "../src/receipt/records.js";
import {
  isSubmittable,
  isValidPayerNumberCheckDigit,
  validateUkeRecords,
  type ValidationIssue,
} from "../src/receipt/validate.js";
import { buildResubmissionFile } from "../src/receipt/resubmit.js";
import { fdiToShikiCode } from "../src/domain/tooth-code.js";
import { CalculationEngine } from "../src/billing/engine.js";
import { InMemoryMaster } from "../src/billing/master.js";
import { createSiteDiagnosisRule } from "../src/billing/rules/site-diagnosis.js";

// ---- パーサ（ラウンドトリップ） ----

test("パーサ: parseRecord は serializeRecord の逆変換", () => {
  const line = "RE,1,3116,202606,基金　花子,2,19800630,,,20260605,1,,,,,,,,,,,,,,,";
  assert.equal(serializeRecord(parseRecord(line)), line);
});

test("パーサ: encode→decode でレコードが一致（Shift_JIS・EOF往復）", () => {
  const records = sampleFile();
  const decoded = decodeUkeFile(encodeUkeFile(records));
  assert.deepEqual(
    decoded.map((r) => serializeRecord(r)),
    records.map((r) => serializeRecord(r)),
  );
});

test("パーサ: 末尾EOF・空行を無視する", () => {
  const recs = parseFile("UK,1,13,3,1234567,,あ,202607,,00\r\nGO,1,0,99\r\n\x1a");
  assert.deepEqual(recs.map((r) => r.identifier), ["UK", "GO"]);
});

// ---- チェックデジット ----

test("チェックデジット: 手引き記録例の保険者・公費番号が通る", () => {
  assert.ok(isValidPayerNumberCheckDigit("01130012")); // 保険者（手引き p14）
  assert.ok(isValidPayerNumberCheckDigit("06132013")); // 保険者（別添C 再請求例）
  assert.ok(isValidPayerNumberCheckDigit("19136019")); // 公費負担者（手引き p16）
});

test("チェックデジット: 末尾1桁を変えると不正と判定", () => {
  assert.ok(!isValidPayerNumberCheckDigit("01130011"));
  assert.ok(!isValidPayerNumberCheckDigit("0113001")); // 桁不足
});

// ---- バリデータ ----

function sampleReceipt(): UkeReceipt {
  return {
    re: buildRe({
      receiptNo: 1,
      receiptType: "3116",
      treatmentMonth: "202606",
      name: "基金　花子",
      sex: "2",
      birthDate: "19800630",
    }),
    ho: buildHo({ insurerNo: "01130012", number: "123", actualDays: 1, totalPoints: 272 }),
    hs: [buildHs({ teeth: [fdiToShikiCode("16")], diseaseCode: "5250001" })],
    details: [buildSs({ category: "11", burden: "1", code: "301000110", points: 272, count: 1, daily: { 5: 1 } })],
  };
}

function sampleFile() {
  return assembleUkeFile({
    facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "歯科デモ医院", billingMonth: "202607" },
    receipts: [sampleReceipt()],
  });
}

test("バリデータ: 正常なファイルは指摘ゼロ・提出可能", () => {
  const issues = validateUkeRecords(sampleFile());
  assert.deepEqual(issues, []);
  assert.ok(isSubmittable(issues));
});

test("バリデータ: 保険者番号チェックデジット不正を検出（コード2010）", () => {
  const receipt = sampleReceipt();
  receipt.ho = buildHo({ insurerNo: "01130011", number: "123", actualDays: 1, totalPoints: 272 });
  const issues = validateUkeRecords(
    assembleUkeFile({
      facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "歯科デモ医院", billingMonth: "202607" },
      receipts: [receipt],
    }),
  );
  assert.ok(issues.some((i) => i.code === "2010" && i.severity === "reject"));
});

test("バリデータ: GO総合計点数の不整合を検出（コード1008）", () => {
  const records = sampleFile();
  // GO を改ざん（点数を狂わせる）
  const go = records[records.length - 1]!;
  go.fields[1] = 999;
  const issues = validateUkeRecords(records);
  assert.ok(issues.some((i) => i.code === "1008"));
  assert.ok(!isSubmittable(issues));
});

test("バリデータ: 診療行為レコードが無い（COのみ）を検出（コード2014）", () => {
  // assembleUkeFile は SS等なしを組立時に拒否するため、バリデータ単体に手組みで投入する
  const records = [
    parseRecord("UK,1,13,3,1234567,,歯科デモ医院,202607,,00"),
    parseRecord("IR,1,13,3,1234567,,202607,,"),
    buildRe({ receiptNo: 1, receiptType: "3116", treatmentMonth: "202606", name: "基金　花子", sex: "2", birthDate: "19800630" }),
    buildHo({ insurerNo: "01130012", number: "123", actualDays: 1, totalPoints: 272 }),
    buildHs({ teeth: [fdiToShikiCode("16")], diseaseCode: "5250001" }),
    buildCo({ burden: "1", code: "820000000" }),
    parseRecord("GO,1,272,99"),
  ];
  const issues = validateUkeRecords(records);
  assert.ok(issues.some((i) => i.code === "2014"));
});

test("バリデータ: レセプト種別が歯科でない（3始まりでない）を検出（コード2004）", () => {
  // 医科種別を無理やり差し込む
  const records = sampleFile();
  const re = records.find((r) => r.identifier === "RE")!;
  re.fields[1] = "1112";
  const issues = validateUkeRecords(records);
  assert.ok(issues.some((i) => i.code === "2004"));
});

// ---- 返戻 → 再請求（別添C） ----

/** 返戻ファイル（HI…HR…履歴ブロック…HG）を模擬的に組み立てる */
function makeReturnFile() {
  const ir = parseRecord("IR,1,13,3,1234567,,202406,03-1234-5678,");
  const re = parseRecord("RE,1,3114,202406,基金　太郎,1,19720630,,,20240615,1,,,,,,,,,,,,,,,"); // 未就学者(誤)
  const ho = parseRecord("HO,06132013,11010203,123,2,1150,,,,,,,,");
  const hs = parseRecord("HS,,,101600,5250001,,,,,,,,");
  const ss = buildSs({ category: "11", burden: "1", code: "301000110", points: 1150, count: 1, daily: { 15: 1 } });
  const hr = parseRecord("HR,202406,1,L3129");
  const h1 = parseRecord("8,1,0,IR,1,13,3,1234567");
  const h2 = parseRecord("8,2,0,RE,1,3114");
  const h3 = parseRecord("8,9,0,RC,Ver0000");
  return [
    parseRecord("HI,1,13,3,1234567,,202406"),
    ir, re, ho, hs, ss, hr, h1, h2, h3,
    parseRecord("HG,1,1150,99"),
  ];
}

test("返戻→再請求: HI/HG/HR を除去し UK/GO を付加、履歴ブロックは温存", () => {
  const returned = makeReturnFile();
  const { records, droppedReturnReasons, preservedHistoryRecords } = buildResubmissionFile({
    returnedRecords: returned,
    facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "歯科デモ医院", billingMonth: "202407" },
    // 返戻理由（未就学者誤り）を訂正: 種別3114→3116
    modifyRequestData: (req) => {
      for (const r of req) if (r.identifier === "RE") r.fields[1] = "3116";
    },
  });
  const ids = records.map((r) => r.identifier);
  assert.equal(ids[0], "UK");
  assert.equal(ids[ids.length - 1], "GO");
  assert.ok(!ids.includes("HI"));
  assert.ok(!ids.includes("HG"));
  assert.ok(!ids.includes("HR")); // トップレベル返戻理由は削除
  assert.equal(droppedReturnReasons, 1);
  // 履歴ブロック（識別子8）は温存
  assert.equal(records.filter((r) => r.identifier === "8").length, 3);
  assert.equal(preservedHistoryRecords, 3);
  // 種別の訂正が反映され、再請求ファイルは自己点検に通る
  const re = records.find((r) => r.identifier === "RE")!;
  assert.equal(re.fields[1], "3116");
  // GO は再計算（1件・1150点）
  assert.equal(serializeRecord(records[records.length - 1]!), "GO,1,1150,99");
});

test("返戻→再請求: 再構築したファイルはバリデータに通る", () => {
  const returned = makeReturnFile();
  const { records } = buildResubmissionFile({
    returnedRecords: returned,
    facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "歯科デモ医院", billingMonth: "202407" },
    modifyRequestData: (req) => {
      for (const r of req) if (r.identifier === "RE") r.fields[1] = "3116";
    },
  });
  // 履歴ブロック（識別子8）はバリデータの想定外レコードなので、請求データ部分のみ検証する
  const requestOnly = records.filter((r) => r.identifier !== "8");
  const issues = validateUkeRecords(requestOnly);
  assert.ok(isSubmittable(issues), JSON.stringify(issues));
});

// ---- 部位×病名 突合ルール（#4） ----

test("部位突合: 病名部位に無い歯への処置はエラー", () => {
  const engine = new CalculationEngine([createSiteDiagnosisRule("2024-06-01")]);
  const result = engine.calculate({
    patient: { id: "p", birthDate: "1980-01-01", sex: "M" },
    visit: { id: "v", patientId: "p", visitDate: "2026-06-12", visitType: "first" },
    procedures: [{ procedureCode: "K001", teeth: ["16", "26"], quantity: 1 }],
    diagnoses: [{ diseaseCode: "5250001", teeth: ["16"], onsetDate: "2026-06-05" }],
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master: new InMemoryMaster(),
  });
  const err = result.issues.find((i) => i.severity === "error");
  assert.ok(err);
  assert.match(err!.message, /26番/); // 26番が病名部位に無い
});

test("部位突合: 全ての処置歯が病名部位に含まれれば指摘なし／部位なし処置はスキップ", () => {
  const engine = new CalculationEngine([createSiteDiagnosisRule("2024-06-01")]);
  const result = engine.calculate({
    patient: { id: "p", birthDate: "1980-01-01", sex: "M" },
    visit: { id: "v", patientId: "p", visitDate: "2026-06-12", visitType: "first" },
    procedures: [
      { procedureCode: "K001", teeth: ["16"], quantity: 1 },
      { procedureCode: "A000", quantity: 1 }, // 部位なし→対象外
    ],
    diagnoses: [{ diseaseCode: "5250001", teeth: ["16"], onsetDate: "2026-06-05" }],
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master: new InMemoryMaster(),
  });
  assert.equal(result.issues.length, 0);
});
