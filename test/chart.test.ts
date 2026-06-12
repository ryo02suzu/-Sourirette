import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeEntry, reviseEntry, verifyChain, type ChartEntry } from "../src/domain/chart.js";

const draft = (id: string): ChartEntry => ({
  id,
  visitId: "visit-1",
  status: "draft",
  soap: { S: "冷たいもので痛む", O: "右上6 C2", A: "う蝕の疑い", P: "充填予定" },
  authoredBy: "staff-1",
});

test("確定するとハッシュが付き、チェーン検証が通る", () => {
  const e1 = finalizeEntry(draft("e1"), "dentist-1", "2026-06-12T10:00:00Z", undefined);
  const e2 = finalizeEntry(draft("e2"), "dentist-1", "2026-06-12T11:00:00Z", e1.contentHash);
  assert.equal(e1.status, "final");
  assert.ok(e1.contentHash);
  assert.equal(verifyChain([e1, e2]), true);
});

test("改ざんされた記録はチェーン検証で検知できる", () => {
  const e1 = finalizeEntry(draft("e1"), "dentist-1", "2026-06-12T10:00:00Z", undefined);
  const e2 = finalizeEntry(draft("e2"), "dentist-1", "2026-06-12T11:00:00Z", e1.contentHash);
  const tampered: ChartEntry = { ...e1, soap: { ...e1.soap, A: "書き換え" } };
  assert.equal(verifyChain([tampered, e2]), false);
});

test("確定済み記録は再確定できない", () => {
  const e1 = finalizeEntry(draft("e1"), "dentist-1", "2026-06-12T10:00:00Z", undefined);
  assert.throws(() => finalizeEntry(e1, "dentist-2", "2026-06-13T10:00:00Z", undefined));
});

test("訂正は旧版を変更せず新版（draft）を作る", () => {
  const e1 = finalizeEntry(draft("e1"), "dentist-1", "2026-06-12T10:00:00Z", undefined);
  const revision = reviseEntry(e1, { ...e1.soap, P: "根管治療に変更" }, "dentist-1");
  assert.equal(revision.status, "draft");
  assert.equal(revision.supersedesId, "e1");
  assert.equal(e1.soap.P, "充填予定"); // 旧版は不変
});
