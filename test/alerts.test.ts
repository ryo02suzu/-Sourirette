/**
 * 算定支援アラートエンジンのテスト（純関数）。
 * 既存JSONの代表ルール DP001(抜髄×Per)・FS001(歯初診未届)・AT012(算定単位) で発火/非発火を検証。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseRulesDb } from "../src/billing/rules-db-loader.js";
import { buildCodeToKubun } from "../src/billing/betsu1-loader.js";
import { decodeSjis } from "../src/billing/master-loader.js";
import { evaluateAlerts, type AlertConfig } from "../src/alerts/engine.js";
import { makeContextKey, type AlertInput } from "../src/alerts/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rulesDb = parseRulesDb(readFileSync(join(ROOT, "data/rules/santei-rules-R8.json"), "utf-8"));
const codeToKubun = buildCodeToKubun(decodeSjis(new Uint8Array(readFileSync(join(ROOT, "data/masters/h_ALL20260611.csv")))));
const cfg: AlertConfig = { rulesDb, codeToKubun };

const BATSUZUI = "309002110"; // 抜髄（単根管）= 区分 I005
const PER = "8832354"; // 急性根尖性歯周炎（Per）
const PUL = "5220063"; // 歯髄炎（Pul）
const SHOSHIN = "301000110"; // 歯科初診料 = 区分 A000

test("DP001: 抜髄をPer病名で算定 → warning発火（不適応）", () => {
  const input: AlertInput = { procedureCodes: [BATSUZUI], diseaseCodes: [PER] };
  const alerts = evaluateAlerts(input, cfg);
  const w = alerts.find((a) => a.ruleId === "DP001" && a.level === "warning");
  assert.ok(w, "DP001の不適応warningが出ない");
  assert.equal(w!.procedureCode, BATSUZUI);
  assert.equal(w!.diseaseCode, PER);
  assert.ok(w!.source.includes("情提")); // 根拠併記
  assert.equal(w!.requiresDentistReview, true);
});

test("DP001: 抜髄をPul病名で算定 → 不適応は非発火（Perでないため）", () => {
  const alerts = evaluateAlerts({ procedureCodes: [BATSUZUI], diseaseCodes: [PUL] }, cfg);
  assert.ok(!alerts.some((a) => a.ruleId === "DP001" && a.title.includes("不適応")));
});

test("FS001: 歯初診 未届で初診料を算定 → error発火", () => {
  const input: AlertInput = { procedureCodes: [SHOSHIN], diseaseCodes: [PUL], notifiedStandards: [] };
  const alerts = evaluateAlerts(input, cfg);
  const e = alerts.find((a) => a.ruleId === "FS001" && a.level === "error");
  assert.ok(e, "歯初診未届のerrorが出ない");
  assert.equal(e!.procedureCode, SHOSHIN);
  assert.equal(e!.requiresDentistReview, false); // 客観的に黒
});

test("FS001: 歯初診 届出済みなら非発火", () => {
  const alerts = evaluateAlerts({ procedureCodes: [SHOSHIN], diseaseCodes: [PUL], notifiedStandards: ["歯初診"] }, cfg);
  assert.ok(!alerts.some((a) => a.ruleId === "FS001"));
});

test("施設基準: notifiedStandards未指定なら施設基準チェックしない（届出不明）", () => {
  const alerts = evaluateAlerts({ procedureCodes: [SHOSHIN], diseaseCodes: [PUL] }, cfg);
  assert.ok(!alerts.some((a) => a.category === "facility_standard"));
});

test("AT012: I000系（区分一致）を算定 → 算定単位proposalが発火", () => {
  // 区分 I000 のコードを1つ拾う
  const i000 = [...codeToKubun].find(([, k]) => k === "I000")?.[0];
  assert.ok(i000, "区分I000のコードが見つからない");
  const alerts = evaluateAlerts({ procedureCodes: [i000!], diseaseCodes: [PUL] }, cfg);
  const p = alerts.find((a) => a.ruleId === "AT012" && a.level === "proposal");
  assert.ok(p, "AT012(算定単位)のproposalが出ない");
  assert.match(p!.message, /1歯/);
});

test("AT012: 無関係な区分（初診）では非発火", () => {
  const alerts = evaluateAlerts({ procedureCodes: [SHOSHIN], diseaseCodes: [PUL] }, cfg);
  assert.ok(!alerts.some((a) => a.ruleId === "AT012"));
});

test("年齢条件: 乳幼児加算(AT001)は患者6歳以上なら非発火、6歳未満なら発火", () => {
  const over = evaluateAlerts({ procedureCodes: [SHOSHIN], diseaseCodes: [PUL], patientAge: 30 }, cfg);
  assert.ok(!over.some((a) => a.ruleId === "AT001"));
  const under = evaluateAlerts({ procedureCodes: [SHOSHIN], diseaseCodes: [PUL], patientAge: 3 }, cfg);
  assert.ok(under.some((a) => a.ruleId === "AT001" && a.level === "proposal"));
});

test("既読学習: 承認済みパターンは抑制される", () => {
  const input: AlertInput = { procedureCodes: [BATSUZUI], diseaseCodes: [PER] };
  const before = evaluateAlerts(input, cfg);
  const dp001 = before.find((a) => a.ruleId === "DP001")!;
  const acked = new Set([dp001.contextKey]);
  const after = evaluateAlerts(input, { ...cfg, acknowledged: acked });
  assert.ok(!after.some((a) => a.contextKey === dp001.contextKey), "既読パターンが抑制されていない");
  // contextKey は (ruleId, 病名, 処置) で生成される
  assert.equal(dp001.contextKey, makeContextKey("DP001", PER, BATSUZUI));
});

test("ブロックしない設計: errorでもアラートを返すだけ（例外を投げない）", () => {
  assert.doesNotThrow(() => evaluateAlerts({ procedureCodes: [SHOSHIN], diseaseCodes: [PUL], notifiedStandards: [] }, cfg));
});
