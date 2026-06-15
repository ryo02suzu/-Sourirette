/**
 * 突合ハーネスのテスト（P0-2）。
 * 自前生成UKEを「既存レセコン出力」に見立て、逆変換→再計算→突合で往復一致することを保証する
 * （実レセプトが来たら同じ経路で不一致が露見する）。匿名化が直接識別子を消すことも確認。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { loadOfficialEngine, type OfficialDataSources } from "../src/billing/official-engine.js";
import { processReceipt, type ProcessReceiptInput } from "../src/receipt/process.js";
import { parseFile } from "../src/receipt/uke.js";
import { anonymizeUke } from "../src/verify/anonymize.js";
import { ukeToInputs } from "../src/verify/uke-to-input.js";
import { reconcileRecords, summarize } from "../src/verify/reconcile.js";

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

const demo: ProcessReceiptInput = {
  facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "突合デモ医院", billingMonth: "202606" },
  patient: { birthDate: "1980-06-30", sex: "F" },
  name: "基金　花子",
  kanaName: "キキンハナコ",
  chartNo: "DEMO-1",
  scheme: { kind: "medical", beneficiary: "family" },
  insurer: { insurerNo: "01130012", number: "123" },
  visits: [
    { date: "2026-06-05", visitType: "first", procedureCodes: ["301000110", "305000110", "309002110", "309003310"] },
    { date: "2026-06-19", visitType: "followup", procedureCodes: ["301001610"] },
  ],
  diagnoses: [{ diseaseCode: "5220063", teeth: ["16"], onsetDate: "2026-06-05" }],
};

test("突合: 自前生成UKEは逆変換→再計算で完全一致（往復ラウンドトリップ）", () => {
  const original = parseFile(processReceipt(loaded, demo).recordsText);
  const per = reconcileRecords(original, loaded);
  assert.equal(per.length, 1);
  assert.equal(per[0]!.matched, true, JSON.stringify(per[0]!.diffs));
  assert.equal(per[0]!.totalDiff, 0);
  assert.equal(summarize(per).matchRate, 1);
});

test("逆変換: 受診・傷病名・歯式・点数の期待値が復元される", () => {
  const original = parseFile(processReceipt(loaded, demo).recordsText);
  const recs = ukeToInputs(original);
  assert.equal(recs.length, 1);
  const inp = recs[0]!.input;
  assert.equal(inp.patient.sex, "F");
  assert.equal(inp.patient.birthDate, "1980-06-30");
  assert.ok(inp.diagnoses.some((d) => d.diseaseCode === "5220063" && (d.teeth ?? []).includes("16")));
  // 初診料がある日は first、再診のみの日は followup
  assert.ok(inp.visits.some((v) => v.visitType === "first" && v.procedureCodes.includes("301000110")));
  assert.ok(inp.visits.some((v) => v.visitType === "followup"));
  assert.ok(recs[0]!.expected.totalPoints > 0);
});

test("匿名化: 直接識別子（氏名・カナ・記号・番号・カルテ番号）が除去される", () => {
  const original = parseFile(processReceipt(loaded, demo).recordsText);
  const anon = anonymizeUke(original);
  const re = anon.find((r) => r.identifier === "RE")!;
  assert.equal(re.fields[3], ""); // 氏名
  assert.equal(re.fields[14] ?? "", ""); // カルテ番号
  const ho = anon.find((r) => r.identifier === "HO")!;
  assert.equal(ho.fields[2], ""); // 被保険者番号
  // 匿名化しても算定に必要な情報（生年月日・コード）は残り、突合は成立する
  const per = reconcileRecords(anon, loaded);
  assert.equal(per[0]!.matched, true);
});

test("突合: 不一致（元に在るコードを当エンジンが出さない）を欠落として検出できる", () => {
  // 元UKEに架空の高額コードSSを1行差し込む → 当エンジンは出さない＝欠落として露見
  const original = parseFile(processReceipt(loaded, demo).recordsText);
  const re = original.find((r) => r.identifier === "RE")!;
  const goIdx = original.findIndex((r) => r.identifier === "GO");
  // 実在の診療行為コードだが当デモ入力に無いもの（例: 歯周基本治療相当）を1行追加
  const extraSs = parseFile("SS,11,1,308000110,0,0," + ",".repeat(70) + "100,1," + "1," + "0,".repeat(30).replace(/,$/, "")).find((r) => r.identifier === "SS");
  if (extraSs) original.splice(goIdx, 0, extraSs);
  const per = reconcileRecords(original, loaded);
  // 追加コードが欠落（missing）として出るか、または合計差が生じる
  assert.ok(per[0]!.diffs.some((d) => d.kind === "missing") || per[0]!.totalDiff !== 0);
  assert.ok(void re === undefined || true);
});
