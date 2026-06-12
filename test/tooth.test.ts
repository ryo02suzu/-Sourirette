import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTooth, parseTooth, sameQuadrant, toJapaneseNotation } from "../src/domain/tooth.js";

test("永久歯の FDI 表記をパースできる", () => {
  const tooth = parseTooth("16");
  assert.equal(tooth.jaw, "upper");
  assert.equal(tooth.side, "right");
  assert.equal(tooth.position, 6);
  assert.equal(tooth.deciduous, false);
});

test("乳歯の FDI 表記をパースできる", () => {
  const tooth = parseTooth("75");
  assert.equal(tooth.jaw, "lower");
  assert.equal(tooth.side, "left");
  assert.equal(tooth.deciduous, true);
});

test("不正な表記を拒否する", () => {
  for (const bad of ["00", "19", "56", "90", "1", "165", "あ1"]) {
    assert.equal(isValidTooth(bad), false, bad);
  }
});

test("日本式表記に変換できる", () => {
  assert.equal(toJapaneseNotation(parseTooth("16")), "右上6");
  assert.equal(toJapaneseNotation(parseTooth("31")), "左下1");
  assert.equal(toJapaneseNotation(parseTooth("55")), "右上E");
  assert.equal(toJapaneseNotation(parseTooth("81")), "右下A");
});

test("同一顎・同一側の判定", () => {
  assert.equal(sameQuadrant(parseTooth("14"), parseTooth("16")), true);
  assert.equal(sameQuadrant(parseTooth("14"), parseTooth("24")), false);
});
