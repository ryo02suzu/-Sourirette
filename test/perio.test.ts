import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, severityOf, summarize, type ToothPerioRecord } from "../src/domain/perio.js";

const rec = (fdi: string, pd: number[], bop: boolean[] = [false, false, false, false], mobility: 0 | 1 | 2 | 3 = 0): ToothPerioRecord =>
  ({ fdi, pd, bop, mobility });

test("summarize: 平均・最大・BOP率・4mm/6mm部位数を計算する", () => {
  const s = summarize([
    rec("16", [3, 4, 6, 2], [true, false, true, false]),
    rec("11", [2, 2, 2, 2]),
  ]);
  assert.equal(s.sites, 8);
  assert.equal(s.meanPd, 2.9); // (3+4+6+2+2+2+2+2)/8 = 2.875 → 2.9
  assert.equal(s.maxPd, 6);
  assert.equal(s.bopRate, 0.25);
  assert.equal(s.sites4mm, 2);
  assert.equal(s.sites6mm, 1);
});

test("summarize: 未入力（0以下）の計測点は除外する", () => {
  const s = summarize([rec("16", [0, 0, 3, 0])]);
  assert.equal(s.sites, 1);
  assert.equal(s.meanPd, 3);
});

test("severityOf: 閾値判定（4mm=中等度 / 6mm or 動揺2=重度）", () => {
  assert.equal(severityOf(rec("11", [2, 3, 2, 3])), "none");
  assert.equal(severityOf(rec("11", [2, 3, 2, 3], [true, false, false, false])), "mild");
  assert.equal(severityOf(rec("16", [4, 3, 2, 3])), "moderate");
  assert.equal(severityOf(rec("16", [6, 3, 2, 3])), "severe");
  assert.equal(severityOf(rec("16", [2, 2, 2, 2], [false, false, false, false], 2)), "severe");
});

test("assess: 重症度に応じた評価と処置提案を返す", () => {
  const severe = assess(summarize([rec("16", [6, 4, 3, 3])]));
  assert.match(severe.label, /重度/);
  assert.ok(severe.suggestions.some((s) => s.includes("SRP")));

  const stable = assess(summarize([rec("11", [2, 2, 2, 2])]));
  assert.match(stable.label, /安定/);
});
