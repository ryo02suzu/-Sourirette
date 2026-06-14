/**
 * 摘要欄必須コメント（別表Ⅰ歯科）ローダーのテスト。実データで取込を検証する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { indexByKubun, isNumericCommentCode, normalizeKubun, parseBetsu1 } from "../src/billing/betsu1-loader.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const csv = readFileSync(join(ROOT, "data/masters/betsu1_shika_20260601.csv"), "utf-8");
const entries = parseBetsu1(csv);

test("区分の正規化（全角英数・ハイフン・空白）", () => {
  assert.equal(normalizeKubun("Ａ000"), "A000");
  assert.equal(normalizeKubun("Ｍ015-2"), "M015-2");
  assert.equal(normalizeKubun("Ｂ000－4"), "B000-4");
});

test("別表Ⅰ: 実データを180件以上パースできる", () => {
  assert.ok(entries.length > 180, `entries=${entries.length}`);
});

test("別表Ⅰ: 初診料の健康診断コメント（820100300）が引ける", () => {
  const found = entries.find((e) => e.commentCode === "820100300");
  assert.ok(found);
  assert.equal(found!.kubun, "A000");
  assert.match(found!.displayText, /健康診断/);
});

test("別表Ⅰ: 区分索引で根管充填（I008）→暫間根充（820100329）が引ける", () => {
  const idx = indexByKubun(entries);
  const i008 = idx.get("I008");
  assert.ok(i008 && i008.length > 0);
  assert.ok(i008!.some((e) => e.commentCode === "820100329"));
});

test("別表Ⅰ: 9桁コメントコードの判定（特殊指定を除外）", () => {
  assert.ok(isNumericCommentCode("820100300"));
  assert.ok(!isNumericCommentCode("CA002（301000470）"));
  assert.ok(!isNumericCommentCode("診療行為コード"));
  // 大半は9桁の数値コメントコード
  const numeric = entries.filter((e) => isNumericCommentCode(e.commentCode));
  assert.ok(numeric.length > 120, `numeric=${numeric.length}`);
});
