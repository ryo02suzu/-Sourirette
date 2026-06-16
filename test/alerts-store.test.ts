/**
 * 既読（承認パターン）ストアのテスト。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryAcknowledgmentStore } from "../src/alerts/store.js";

test("承認→既読判定・集合取得", () => {
  const s = new InMemoryAcknowledgmentStore();
  assert.ok(!s.isAcknowledged("DP001#8832354#309002110"));
  s.acknowledge("DP001#8832354#309002110", "Per併存の別歯のため可", "2026-06-14T00:00:00Z");
  assert.ok(s.isAcknowledged("DP001#8832354#309002110"));
  assert.ok(s.acknowledgedKeys().has("DP001#8832354#309002110"));
  assert.equal(s.all()[0]!.note, "Per併存の別歯のため可");
});

test("取り消し", () => {
  const s = new InMemoryAcknowledgmentStore();
  s.acknowledge("X#a#b");
  s.revoke("X#a#b");
  assert.ok(!s.isAcknowledged("X#a#b"));
});

test("serialize/deserialize で永続化できる", () => {
  const s = new InMemoryAcknowledgmentStore();
  s.acknowledge("FS001##301000110", undefined, "2026-06-14T00:00:00Z");
  const json = s.serialize();
  const restored = InMemoryAcknowledgmentStore.deserialize(json);
  assert.ok(restored.isAcknowledged("FS001##301000110"));
  assert.equal(restored.all().length, 1);
});

test("初期パターンを与えて構築できる（DB読込相当）", () => {
  const s = new InMemoryAcknowledgmentStore([{ contextKey: "AT001##301000110", acknowledgedAt: "2026-06-14T00:00:00Z" }]);
  assert.ok(s.isAcknowledged("AT001##301000110"));
});
