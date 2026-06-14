/**
 * 電子点数表（歯科）ローダーのテスト。実データ（data/tensuhyo/）で取込を検証する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  decodeTensuhyo,
  haihanToMutualExclusions,
  parseHaihan,
  parseSanteiKaisu,
  santeiKaisuToFrequencyLimits,
} from "../src/billing/tensuhyo-loader.js";
import { CalculationEngine, type CalculationContext } from "../src/billing/engine.js";
import { InMemoryMaster } from "../src/billing/master.js";
import { createDataDrivenRules } from "../src/billing/rule-tables.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (rel: string) => decodeTensuhyo(new Uint8Array(readFileSync(join(ROOT, rel))));

const ASOF = "2026-06-12"; // 令和8年6月時点で有効な行のみ

const santeiRows = parseSanteiKaisu(load("data/tensuhyo/04_santei_kaisu.csv"));
const haihanRows = parseHaihan(load("data/tensuhyo/03-1_haihan.csv"));

test("算定回数: 実データを2,000行以上パースできる", () => {
  assert.ok(santeiRows.length > 2000, `rows=${santeiRows.length}`);
});

test("算定回数→回数制限: 歯科初診料（301000110）は月1回として取り込まれる", () => {
  const limits = santeiKaisuToFrequencyLimits(santeiRows, ASOF);
  const shoshin = limits.find((l) => l.code === "301000110" && l.per === "month");
  assert.ok(shoshin, "初診料の月回数制限が見つからない");
  assert.equal(shoshin!.maxCount, 1);
  // 時間ベースのみ＝月/日に正規化されている
  assert.ok(limits.every((l) => l.per === "month" || l.per === "day"));
});

test("背反→併算定不可: 実データからペアを抽出し、対称重複を排除する", () => {
  const ex = haihanToMutualExclusions(haihanRows, "same-month", ASOF);
  assert.ok(ex.length > 100, `pairs=${ex.length}`);
  // 無順序ペアで重複排除されている（codeA < codeB 正規化）
  assert.ok(ex.every((e) => e.codeA < e.codeB));
  const keys = new Set(ex.map((e) => `${e.codeA}/${e.codeB}`));
  assert.equal(keys.size, ex.length, "重複ペアが残っている");
});

test("実データ→エンジン: 回数制限が実際に発火する（初診料を月2回でエラー）", () => {
  const limits = santeiKaisuToFrequencyLimits(santeiRows, ASOF);
  const engine = new CalculationEngine(createDataDrivenRules({ frequencyLimits: limits }, "2024-04-01"));
  const ctx: CalculationContext = {
    patient: { id: "p", birthDate: "1980-01-01", sex: "F" },
    visit: { id: "v", patientId: "p", visitDate: ASOF, visitType: "first" },
    procedures: [{ procedureCode: "301000110", quantity: 1 }],
    diagnoses: [],
    // 当月にすでに初診料1回算定済み → 当日もう1回で月2回＝上限超過
    history: { countInMonth: (code) => (code === "301000110" ? 1 : 0) },
    facility: { has: () => false },
    master: new InMemoryMaster(),
  };
  const result = engine.calculate(ctx);
  assert.ok(result.issues.some((i) => i.severity === "error" && i.procedureCode === "301000110"));
});
