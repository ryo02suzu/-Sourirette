/**
 * 電子カルテ保存層（電子保存3原則＋アクセス制御・監査・暗号化バックアップ）のテスト。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { KarteStore, AccessDeniedError, type User } from "../src/karte/store.js";

const dentist: User = { id: "dr-yamada", role: "dentist" };
const reception: User = { id: "uketsuke-01", role: "reception" };
const soap = { S: "右下が痛い", O: "#46 打診痛", A: "急性根尖性歯周炎", P: "感染根管処置" };

test("真正性: 確定記録は連鎖し、verifyIntegrity が通る", () => {
  const s = new KarteStore();
  s.appendFinal(dentist, "pt-1", "v-1", soap);
  s.appendFinal(dentist, "pt-1", "v-2", { ...soap, P: "根管貼薬" });
  assert.equal(s.verifyIntegrity().ok, true);
});

test("真正性: 暗号化バックアップの本体を改ざんすると復元時に検知される（GCM）", () => {
  const s = new KarteStore();
  s.appendFinal(dentist, "pt-1", "v-1", soap);
  const backup = JSON.parse(s.exportBackup(dentist, "pw")) as { data: string };
  // 暗号文の1バイトを書き換える
  const bytes = Buffer.from(backup.data, "base64");
  bytes[0] = bytes[0]! ^ 0xff;
  const tampered = JSON.stringify({ ...backup, data: bytes.toString("base64") });
  assert.throws(() => KarteStore.importBackup(tampered, "pw"));
});

test("訂正: reviseFinal は旧版を保持し supersedes で指す", () => {
  const s = new KarteStore();
  const e1 = s.appendFinal(dentist, "pt-1", "v-1", soap);
  const e2 = s.reviseFinal(dentist, "pt-1", e1.id, { ...soap, A: "慢性根尖性歯周炎" });
  assert.equal(e2.supersedesId, e1.id);
  const chain = s.read(dentist, "pt-1");
  assert.equal(chain.length, 2); // 旧版が消えていない
  assert.equal(s.verifyIntegrity().ok, true);
});

test("アクセス制御: 受付は確定できない（dentistのみ）", () => {
  const s = new KarteStore();
  assert.throws(() => s.appendFinal(reception, "pt-1", "v-1", soap), AccessDeniedError);
});

test("アクセス制御: 受付は閲覧できる", () => {
  const s = new KarteStore();
  s.appendFinal(dentist, "pt-1", "v-1", soap);
  assert.equal(s.read(reception, "pt-1").length, 1);
});

test("監査証跡: 全操作が記録され、連鎖検証が通る", () => {
  const s = new KarteStore();
  s.appendFinal(dentist, "pt-1", "v-1", soap);
  s.read(reception, "pt-1");
  const trail = s.auditTrail(dentist);
  assert.ok(trail.length >= 2);
  assert.ok(trail.some((r) => r.action === "finalize" && r.userId === "dr-yamada"));
  assert.ok(trail.some((r) => r.action === "read" && r.role === "reception"));
  assert.equal(s.verifyIntegrity().ok, true);
});

test("監査証跡: 受付は監査証跡を閲覧できない", () => {
  const s = new KarteStore();
  assert.throws(() => s.auditTrail(reception), AccessDeniedError);
});

test("見読性: readableText が人の読める形を返す", () => {
  const s = new KarteStore();
  s.appendFinal(dentist, "pt-1", "v-1", soap);
  const text = s.readableText(dentist, "pt-1");
  assert.match(text, /急性根尖性歯周炎/);
  assert.match(text, /確定者: dr-yamada/);
});

test("保存性: 暗号化バックアップを往復でき、正しいパスワードで復元・検証できる", () => {
  const s = new KarteStore();
  s.appendFinal(dentist, "pt-1", "v-1", soap);
  s.appendFinal(dentist, "pt-2", "v-9", { ...soap, S: "別患者" });
  const backup = s.exportBackup(dentist, "correct-horse");
  const restored = KarteStore.importBackup(backup, "correct-horse");
  assert.equal(restored.verifyIntegrity().ok, true);
  assert.equal(restored.read(dentist, "pt-1").length, 1);
  assert.equal(restored.read(dentist, "pt-2").length, 1);
});

test("保存性: 誤ったパスワード/改ざんバックアップは復元できない", () => {
  const s = new KarteStore();
  s.appendFinal(dentist, "pt-1", "v-1", soap);
  const backup = s.exportBackup(dentist, "correct-horse");
  assert.throws(() => KarteStore.importBackup(backup, "wrong-pw"));
});
