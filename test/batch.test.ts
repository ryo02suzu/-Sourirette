/**
 * バッチ処理（1ヶ月分の全レセプト→医院単位の1ファイル）のテスト。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { loadOfficialEngine, type OfficialDataSources } from "../src/billing/official-engine.js";
import { processBatch, type BatchInput } from "../src/receipt/batch.js";

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

const input: BatchInput = JSON.parse(readFileSync(join(ROOT, "examples/clinic-month.json"), "utf-8"));

test("バッチ: 複数レセプトを医院単位の1ファイルに組み上げる", () => {
  const r = processBatch(loaded, input);
  // 2レセプト・各実点数の合計（684 + 272 = 956）
  assert.equal(r.receiptCount, 2);
  assert.equal(r.grandTotalPoints, 956);
  assert.equal(r.perReceipt.length, 2);
  assert.equal(r.perReceipt[0]!.totalPoints, 684);
  assert.equal(r.perReceipt[1]!.totalPoints, 272);
  // UK で始まり GO で終わる1ファイル
  assert.ok(r.recordsText.startsWith("UK,"));
  assert.ok(r.recordsText.trimEnd().endsWith(`GO,2,956,99`));
  // 提出前自己点検OK・末尾EOF
  assert.ok(r.submittable, JSON.stringify(r.validation));
  assert.equal(r.bytes[r.bytes.length - 1], 0x1a);
});

test("バッチ: レセプト番号は記録順に1から自動採番される", () => {
  const r = processBatch(loaded, input);
  assert.deepEqual(r.perReceipt.map((p) => p.receiptNo), [1, 2]);
});

test("バッチ: 空入力は拒否", () => {
  assert.throws(() => processBatch(loaded, { facility: input.facility, receipts: [] }), /空/);
});
