/**
 * 公式エンジン工場のテスト。全公式データを1つに組み上げ、実点数・ルール発火・別表Ⅰ引き当てを検証。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { commentCandidates, isValidDisease, loadOfficialEngine, type OfficialDataSources } from "../src/billing/official-engine.js";
import type { CalculationContext } from "../src/billing/engine.js";

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
  diseaseMaster: buf("data/masters/hb_20260601.txt"),
  asOf: "2026-06-12",
};

const loaded = loadOfficialEngine(sources);

test("工場: 全公式データを1つに組み上げる（件数が揃う）", () => {
  assert.ok(loaded.counts.frequencyLimits > 1000, JSON.stringify(loaded.counts));
  assert.ok(loaded.counts.mutualExclusions > 1000);
  assert.ok(loaded.counts.inclusionGroups > 10);
  assert.ok(loaded.counts.betsu1Entries > 180);
});

function ctx(procedures: string[], monthCounts: Record<string, number> = {}): CalculationContext {
  return {
    patient: { id: "p", birthDate: "1980-01-01", sex: "F" },
    visit: { id: "v", patientId: "p", visitDate: "2026-06-12", visitType: "first" },
    procedures: procedures.map((procedureCode) => ({ procedureCode, quantity: 1 })),
    diagnoses: [],
    history: { countInMonth: (code) => monthCounts[code] ?? 0 },
    facility: { has: () => false },
    master: loaded.master,
  };
}

test("工場エンジン: 実点数で算定（初診料272点）", () => {
  const r = loaded.engine.calculate(ctx(["301000110"]));
  assert.equal(r.totalPoints, 272);
});

test("工場エンジン: 包括が発火（抜髄＋根管貼薬）", () => {
  const r = loaded.engine.calculate(ctx(["309002110", "309003310"]));
  assert.ok(r.issues.some((i) => i.severity === "error" && i.procedureCode === "309003310"));
});

test("工場エンジン: 回数制限が発火（初診料を月2回）", () => {
  const r = loaded.engine.calculate(ctx(["301000110"], { "301000110": 1 }));
  assert.ok(r.issues.some((i) => i.severity === "error" && i.procedureCode === "301000110"));
});

test("工場: 摘要欄コメント候補を引ける（初診料→健康診断）", () => {
  const candidates = commentCandidates(loaded, "301000110");
  assert.ok(candidates.some((e) => e.commentCode === "820100300"));
});

test("工場: 傷病名コードの妥当性（実在=OK / 架空=NG / 未コード化=OK）", () => {
  assert.ok(loaded.counts.diseases > 5000);
  assert.ok(isValidDisease(loaded, "8840351")); // 慢性歯周炎第１度
  assert.ok(isValidDisease(loaded, "0000999")); // 未コード化
  assert.ok(!isValidDisease(loaded, "9999999"));
});
