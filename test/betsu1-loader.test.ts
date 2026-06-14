/**
 * 摘要欄必須コメント（別表Ⅰ歯科）ローダーのテスト。実データで取込を検証する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  buildCodeToKubun,
  buildKubunToCodes,
  codesForKubun,
  indexByKubun,
  isNumericCommentCode,
  normalizeKubun,
  parseBetsu1,
  requiredCommentsFor,
} from "../src/billing/betsu1-loader.js";
import { decodeSjis } from "../src/billing/master-loader.js";

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

test("コード→区分: 実マスタで初診料(301000110)→A000 を引ける", () => {
  const codeToKubun = buildCodeToKubun(decodeSjis(new Uint8Array(readFileSync(join(ROOT, "data/masters/h_ALL20260611.csv")))));
  assert.equal(codeToKubun.get("301000110"), "A000");
  assert.ok(codeToKubun.size > 3000, `size=${codeToKubun.size}`);
});

test("区分→コード展開: I005（抜髄）から9桁コード群を引ける（調査DBの区分を実コード化）", () => {
  const index = buildKubunToCodes(decodeSjis(new Uint8Array(readFileSync(join(ROOT, "data/masters/h_ALL20260611.csv")))));
  const codes = codesForKubun("I005", index);
  assert.ok(codes.includes("309002110"), `抜髄(単根管)が含まれない: ${codes.slice(0, 3)}`);
  assert.ok(codes.length >= 3);
});

test("引き当て: 初診料コードから別表Ⅰの摘要欄候補（健康診断コメント）が引ける", () => {
  const codeToKubun = buildCodeToKubun(decodeSjis(new Uint8Array(readFileSync(join(ROOT, "data/masters/h_ALL20260611.csv")))));
  const index = indexByKubun(entries);
  const candidates = requiredCommentsFor("301000110", codeToKubun, index);
  assert.ok(candidates.length > 0, "初診料の摘要欄候補が空");
  assert.ok(candidates.some((e) => e.commentCode === "820100300"));
});

test("別表Ⅰ: 9桁コメントコードの判定（特殊指定を除外）", () => {
  assert.ok(isNumericCommentCode("820100300"));
  assert.ok(!isNumericCommentCode("CA002（301000470）"));
  assert.ok(!isNumericCommentCode("診療行為コード"));
  // 大半は9桁の数値コメントコード
  const numeric = entries.filter((e) => isNumericCommentCode(e.commentCode));
  assert.ok(numeric.length > 120, `numeric=${numeric.length}`);
});
