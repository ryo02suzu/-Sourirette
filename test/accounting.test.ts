/**
 * 会計出力（領収証費用区分・明細書）のテスト。実マスタの区分で費用区分を判定。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildAccounting, costCategoryOf } from "../src/billing/accounting.js";
import { buildCodeToKubun } from "../src/billing/betsu1-loader.js";
import { decodeSjis } from "../src/billing/master-loader.js";
import type { ClaimLine } from "../src/billing/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const codeToKubun = buildCodeToKubun(decodeSjis(new Uint8Array(readFileSync(join(ROOT, "data/masters/h_ALL20260611.csv")))));

test("費用区分: 初診料→初・再診料、写真診断→画像診断", () => {
  assert.equal(costCategoryOf("301000110", codeToKubun), "初・再診料"); // A000
  assert.equal(costCategoryOf("305000110", codeToKubun), "画像診断"); // E系
  assert.equal(costCategoryOf("309002110", codeToKubun), "処置"); // I系（抜髄）
});

test("会計集計: 費用区分別の点数と明細を作る", () => {
  const lines: ClaimLine[] = [
    { procedureCode: "301000110", name: "歯科初診料", points: 272, quantity: 1 },
    { procedureCode: "305000110", name: "写真診断（全顎）", points: 160, quantity: 1 },
    { procedureCode: "305004010", name: "単純撮影（デジタル）", points: 252, quantity: 1 },
  ];
  const a = buildAccounting(lines, codeToKubun);
  assert.equal(a.totalPoints, 684);
  // 初・再診料272 / 画像診断 160+252=412
  const shoshin = a.byCategory.find((c) => c.category === "初・再診料");
  const gazou = a.byCategory.find((c) => c.category === "画像診断");
  assert.equal(shoshin!.points, 272);
  assert.equal(gazou!.points, 412);
  // 別紙様式2の順（初・再診料が画像診断より前）
  assert.ok(a.byCategory.findIndex((c) => c.category === "初・再診料") < a.byCategory.findIndex((c) => c.category === "画像診断"));
  // 明細は3項目
  assert.equal(a.detail.length, 3);
});

test("会計集計: 回数を点数に反映（points×quantity）", () => {
  const lines: ClaimLine[] = [{ procedureCode: "305000110", name: "写真診断", points: 160, quantity: 2 }];
  const a = buildAccounting(lines, codeToKubun);
  assert.equal(a.totalPoints, 320);
});
