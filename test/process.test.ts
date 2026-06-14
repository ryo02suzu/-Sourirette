/**
 * 製品API processReceipt のテスト（公式エンジンでカルテ入力→UKE→点検まで）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { loadOfficialEngine, isValidDisease, type OfficialDataSources } from "../src/billing/official-engine.js";
import { processReceipt, type ProcessReceiptInput } from "../src/receipt/process.js";
import { runKakuninShiken } from "../src/receipt/submission-sim.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const buf = (rel: string) => new Uint8Array(readFileSync(join(ROOT, rel)));

const sources: OfficialDataSources = {
  procedureMaster: buf("data/masters/h_ALL20260611.csv"),
  santeiKaisu: buf("data/tensuhyo/04_santei_kaisu.csv"),
  haihanSameDay: buf("data/tensuhyo/03-1_haihan.csv"),
  haihanSameMonth: buf("data/tensuhyo/03-2_haihan.csv"),
  hojoMaster: buf("data/tensuhyo/01_hojo_master.csv"),
  hokatsu: buf("data/tensuhyo/02_hokatsu.csv"),
  betsu1Csv: readFileSync(join(ROOT, "data/masters/betsu1_shika_20260601.csv"), "utf-8"),
  diseaseMasters: [buf("data/masters/b_20260601.txt"), buf("data/masters/hb_20260601.txt")],
    rulesDbJson: readFileSync(join(ROOT, "data/rules/santei-rules-R8.json"), "utf-8"),
  asOf: "2026-06-12",
};
const loaded = loadOfficialEngine(sources);

const baseInput: ProcessReceiptInput = {
  facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "テスト歯科", billingMonth: "202607" },
  patient: { birthDate: "1980-06-30", sex: "F" },
  name: "基金　花子",
  kanaName: "キキンハナコ",
  scheme: { kind: "medical", beneficiary: "family" },
  insurer: { insurerNo: "01130012", number: "123" },
  visits: [
    { date: "2026-06-05", visitType: "first", procedureCodes: ["301000110", "305000110"] },
    { date: "2026-06-19", visitType: "followup", procedureCodes: [] },
  ],
  diagnoses: [{ diseaseCode: "8840351", teeth: ["16"], onsetDate: "2026-06-05" }],
};

test("製品API: カルテ入力→実点数算定→UKE生成→自己点検OK", () => {
  const r = processReceipt(loaded, baseInput);
  assert.ok(r.totalPoints > 0);
  assert.equal(r.visitDays, 2);
  assert.ok(r.recordsText.startsWith("UK,"));
  assert.ok(r.recordsText.includes("GO,"));
  assert.ok(r.submittable, JSON.stringify(r.validation));
  assert.ok(r.ukeBase64.length > 0);
});

test("製品API: 実点数（初診料272点が含まれる）", () => {
  const r = processReceipt(loaded, { ...baseInput, visits: [{ date: "2026-06-05", visitType: "first", procedureCodes: ["301000110"] }] });
  assert.equal(r.totalPoints, 272);
});

test("製品API: 無効な傷病名コードは提出不可（自己点検でreject）", () => {
  const r = processReceipt(loaded, { ...baseInput, diagnoses: [{ diseaseCode: "9999999", teeth: ["16"], onsetDate: "2026-06-05" }] });
  assert.ok(!r.submittable);
  assert.ok(r.validation.some((v) => v.code === "2016"));
});

test("製品API: 摘要欄コメント候補が返る（初診料→別表Ⅰ）", () => {
  const r = processReceipt(loaded, baseInput);
  assert.ok(r.commentCandidates.some((c) => c.procedureCode === "301000110" && c.commentCode === "820100300"));
});

test("製品API: 算定もれ提示（初診→乳幼児加算等のヒント）が返る", () => {
  const r = processReceipt(loaded, baseInput);
  assert.ok(r.missedChargeHints.some((h) => h.procedureCode === "301000110" && h.value.includes("乳幼児加算")));
});

test("製品API: 会計（費用区分別集計＋明細）が返る", () => {
  const r = processReceipt(loaded, baseInput);
  assert.ok(r.accounting.byCategory.some((c) => c.category === "初・再診料"));
  assert.ok(r.accounting.byCategory.some((c) => c.category === "画像診断"));
  assert.ok(r.accounting.detail.length >= 2);
  assert.equal(r.accounting.totalPoints, r.totalPoints);
});

test("製品API: 算定エンジンの指摘がalgorithmIssuesに出る（初診を月2回→回数違反）", () => {
  const r = processReceipt(loaded, {
    ...baseInput,
    visits: [
      { date: "2026-06-02", visitType: "first", procedureCodes: ["301000110"] },
      { date: "2026-06-20", visitType: "first", procedureCodes: ["301000110"] },
    ],
  });
  assert.ok(r.algorithmIssues.some((i) => i.procedureCode === "301000110" && i.message.includes("月1回")));
});

test("製品API: マスタに無いコードは黙って落とさず指摘する", () => {
  const r = processReceipt(loaded, {
    ...baseInput,
    visits: [{ date: "2026-06-05", visitType: "first", procedureCodes: ["301000110", "999999999"] }],
  });
  assert.equal(r.totalPoints, 272); // 有効分は算定
  assert.ok(r.algorithmIssues.some((i) => i.procedureCode === "999999999" && i.message.includes("存在しません")));
});

test("製品API: 必須欠落は分かりやすいエラー", () => {
  assert.throws(() => processReceipt(loaded, { ...baseInput, name: "" }), /name（氏名）は必須/);
  assert.throws(() => processReceipt(loaded, { ...baseInput, visits: [] }), /1件以上/);
  assert.throws(() => processReceipt(loaded, { ...baseInput, diagnoses: [] }), /diagnoses/);
});

test("製品API: copay指定で窓口負担・高額療養費を返す", () => {
  const r = processReceipt(loaded, { ...baseInput, copay: { copayRatio: 0.3, category: "ウ" } });
  assert.ok(r.copayment);
  // 432点（初診272+写真診断160）→ 総医療費4,320円・3割＝1,300円（限度額未達）
  assert.equal(r.copayment!.grossMedicalCost, r.totalPoints * 10);
  assert.equal(r.copayment!.windowBurden, r.copayment!.burdenBeforeCap);
});

test("確認試験(仮想): 正常レセプトのUKEは合格（L1/L2エラーゼロ）", () => {
  const r = processReceipt(loaded, baseInput);
  const bytes = Uint8Array.from(Buffer.from(r.ukeBase64, "base64"));
  const sk = runKakuninShiken(bytes, { isKnownDiseaseCode: (c) => isValidDisease(loaded, c) });
  assert.equal(sk.stage, "合格");
  assert.equal(sk.passed, true);
  assert.equal(sk.l1.length, 0);
  assert.equal(sk.l2.length, 0);
  assert.match(sk.report, /確認試験合格相当/);
});

test("確認試験(仮想): 無効な傷病名コードのUKEは返戻（L2エラー）", () => {
  const r = processReceipt(loaded, { ...baseInput, diagnoses: [{ diseaseCode: "9999999", teeth: ["16"], onsetDate: "2026-06-05" }] });
  const bytes = Uint8Array.from(Buffer.from(r.ukeBase64, "base64"));
  const sk = runKakuninShiken(bytes, { isKnownDiseaseCode: (c) => isValidDisease(loaded, c) });
  assert.equal(sk.passed, false);
  assert.equal(sk.stage, "返戻");
  assert.ok(sk.l2.some((i) => i.code === "2016"));
});

test("提出ブロック: 背反（併算定不可）は submittable=false（そのまま出すと返戻）", () => {
  const r = processReceipt(loaded, { ...baseInput, visits: [{ date: "2026-06-05", visitType: "first", procedureCodes: ["301000110", "302002210"] }] });
  assert.equal(r.submittable, false);
  assert.ok(r.algorithmIssues.some((i) => i.severity === "error" && i.message.includes("併算定")));
});

test("提出ブロックしない: 包括は行除外で解決済みなので submittable=true", () => {
  const r = processReceipt(loaded, { ...baseInput, visits: [{ date: "2026-06-05", visitType: "first", procedureCodes: ["309002110", "309003310"] }] });
  assert.equal(r.totalPoints, 234); // 根管貼薬は除外
  assert.equal(r.submittable, true);
});

test("診療識別の省略: 同一識別の2件目以降はSSの診療識別が空（初診料＋乳幼児加算）", () => {
  const r = processReceipt(loaded, {
    ...baseInput,
    patient: { birthDate: "2023-01-01", sex: "M" },
    visits: [{ date: "2026-06-05", visitType: "first", procedureCodes: ["301000110"], timeClass: "midnight" }],
  });
  const ss = r.recordsText.split("\n").filter((l) => l.startsWith("SS,")).map((l) => l.split(","));
  // 初診料(11)が先頭で診療識別11、乳幼児深夜加算は同一識別11なので省略（空）
  assert.equal(ss[0]![1], "11");
  assert.equal(ss[0]![3], "301000110");
  assert.equal(ss[1]![1], ""); // 省略
  assert.equal(ss[1]![3], "301001270");
});

test("確認試験(仮想): 自動付与された加算で点数が増え、なお合格する", () => {
  // 乳幼児・初診・深夜 → 乳幼児深夜加算が自動付与され、UKEは合格のまま
  const r = processReceipt(loaded, {
    ...baseInput,
    patient: { birthDate: "2023-01-01", sex: "M" },
    visits: [{ date: "2026-06-05", visitType: "first", procedureCodes: ["301000110"], timeClass: "midnight" }],
  });
  assert.equal(r.totalPoints, 892); // 272 + 620
  const bytes = Uint8Array.from(Buffer.from(r.ukeBase64, "base64"));
  const sk = runKakuninShiken(bytes, { isKnownDiseaseCode: (c) => isValidDisease(loaded, c) });
  assert.equal(sk.passed, true);
});
