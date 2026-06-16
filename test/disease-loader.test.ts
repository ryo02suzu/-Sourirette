/**
 * 歯科傷病名マスタ ローダーのテスト。実データで取込・検証・検索を確認。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  buildDiseaseIndex,
  decodeDiseaseMaster,
  isKnownDiseaseCode,
  parseDiseaseMaster,
  searchDiseases,
} from "../src/billing/disease-loader.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rows = parseDiseaseMaster(decodeDiseaseMaster(new Uint8Array(readFileSync(join(ROOT, "data/masters/hb_20260601.txt")))));
const index = buildDiseaseIndex(rows);

test("傷病名マスタ: 歯科傷病名を5,000行以上パースできる", () => {
  assert.ok(rows.length > 5000, `rows=${rows.length}`);
});

test("傷病名マスタ: 慢性歯周炎第１度（8840351）が引ける", () => {
  const d = index.get("8840351");
  assert.ok(d);
  assert.match(d!.name, /慢性歯周炎第１度/);
});

test("傷病名コード妥当性: 実在コードと未コード化(0000999)はOK、架空はNG", () => {
  assert.ok(isKnownDiseaseCode("8840351", index));
  assert.ok(isKnownDiseaseCode("0000999", index)); // 未コード化傷病名
  assert.ok(!isKnownDiseaseCode("9999999", index));
});

test("病名検索: 「慢性歯周炎」で複数ヒットする", () => {
  const hits = searchDiseases(rows, "慢性歯周炎");
  assert.ok(hits.length >= 4, `hits=${hits.length}`);
  assert.ok(hits.every((h) => h.name.includes("慢性歯周炎") || h.kana.includes("慢性歯周炎")));
});
