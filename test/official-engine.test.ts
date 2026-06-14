/**
 * 公式エンジン工場のテスト。全公式データを1つに組み上げ、実点数・ルール発火・別表Ⅰ引き当てを検証。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { commentCandidates, isValidDisease, loadOfficialEngine, type OfficialDataSources } from "../src/billing/official-engine.js";
import type { CalculationContext } from "../src/billing/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const buf = (rel: string) => new Uint8Array(readFileSync(join(ROOT, rel)));

const sources: OfficialDataSources = {
  procedureMaster: buf("data/masters/h_ALL20260611.csv"),
  santeiKaisu: buf("data/tensuhyo/04_santei_kaisu.csv"),
  haihanSameDay: buf("data/tensuhyo/03-1_haihan.csv"),
  haihanSameMonth: buf("data/tensuhyo/03-2_haihan.csv"),
  hojoMaster: buf("data/tensuhyo/01_hojo_master.csv"),
  hokatsu: buf("data/tensuhyo/02_hokatsu.csv"),
  betsu1Csv: readFileSync(join(ROOT, "data/masters/betsu1_shika_20260601.csv"), "utf-8"),
  diseaseMasters: [buf("data/masters/b_20260601.txt"), buf("data/masters/hb_20260601.txt")],
    rulesDbJson: readFileSync(join(ROOT, "data/rules/santei-rules-R8.json"), "utf-8"),
  asOf: "2026-06-12",
};

const loaded = loadOfficialEngine(sources);

test("工場: 全公式データを1つに組み上げる（件数が揃う）", () => {
  assert.ok(loaded.counts.frequencyLimits > 1000, JSON.stringify(loaded.counts));
  assert.ok(loaded.counts.mutualExclusions > 1000);
  assert.ok(loaded.counts.inclusionGroups > 10);
  assert.ok(loaded.counts.betsu1Entries > 180);
});

test("診断: 未解決の病名トークンが可視化される（黙って捨てない）", () => {
  // 解決できなかったトークンは件数・一覧として露出する（誤記・和名ゆれの検知）
  assert.equal(loaded.counts.unresolvedDiseaseTokens, loaded.unresolvedDiseaseTokens.length);
  // 故意に未解決とするプロセス記述（「○○以外」「→移行」等）は含めない
  assert.ok(!loaded.unresolvedDiseaseTokens.some((t) => /以外|→|疑い病名/.test(t.token)));
  // 各エントリは出所（ruleId）と field を持つ
  for (const t of loaded.unresolvedDiseaseTokens) {
    assert.ok(t.ruleId.length > 0);
    assert.ok(t.field === "required" || t.field === "forbidden");
  }
});

function ctx(procedures: string[], monthCounts: Record<string, number> = {}): CalculationContext {
  return {
    patient: { id: "p", birthDate: "1980-01-01", sex: "F" },
    visit: { id: "v", patientId: "p", visitDate: "2026-06-12", visitType: "first" },
    procedures: procedures.map((procedureCode) => ({ procedureCode, quantity: 1 })),
    diagnoses: [],
    history: { countInMonth: (code) => monthCounts[code] ?? 0 },
    facility: { has: () => false },
    master: loaded.master,
  };
}

test("工場エンジン: 実点数で算定（初診料272点）", () => {
  const r = loaded.engine.calculate(ctx(["301000110"]));
  assert.equal(r.totalPoints, 272);
});

test("工場エンジン: 包括が発火（抜髄＋根管貼薬）", () => {
  const r = loaded.engine.calculate(ctx(["309002110", "309003310"]));
  assert.ok(r.issues.some((i) => i.severity === "error" && i.procedureCode === "309003310"));
});

// 包括マッピングの健全性（既知の正しい関係をロック。電子点数表パースの系統ズレを検知する）
// excludesFromBilling で行除外する以上、誤マッピングは「沈黙の算定もれ」になるため重点検証。
test("包括(実データ): 抜髄に浸潤麻酔が包括され、請求行・合計から除外される", () => {
  const r = loaded.engine.calculate(ctx(["309002110", "311000210"])); // 抜髄234 + 浸潤麻酔30
  assert.equal(r.totalPoints, 234, "浸潤麻酔が合計に残っている（包括除外されていない）");
  assert.ok(!r.lines.some((l) => l.procedureCode === "311000210"), "浸潤麻酔が請求行に残っている");
  assert.ok(r.issues.some((i) => i.procedureCode === "311000210" && i.excludesFromBilling));
});

test("包括(実データ): 感染根管処置に根管貼薬が包括される", () => {
  const r = loaded.engine.calculate(ctx(["309003010", "309003310"])); // 感染根管160 + 根管貼薬
  assert.equal(r.totalPoints, 160);
  assert.ok(!r.lines.some((l) => l.procedureCode === "309003310"));
});

test("包括(実データ): 生活歯髄切断に歯髄保護処置が包括される", () => {
  const r = loaded.engine.calculate(ctx(["309001810", "309001010"])); // 生活歯髄切断233 + 歯髄保護200
  assert.equal(r.totalPoints, 233);
  assert.ok(!r.lines.some((l) => l.procedureCode === "309001010"));
});

test("包括の誤除外なし: 抜髄と同日の初診料は包括されず請求に残る（取りこぼし防止）", () => {
  const r = loaded.engine.calculate(ctx(["301000110", "309002110"])); // 初診料272 + 抜髄234
  assert.equal(r.totalPoints, 506);
  assert.ok(r.lines.some((l) => l.procedureCode === "301000110"));
  assert.ok(r.lines.some((l) => l.procedureCode === "309002110"));
});

test("包括は同日のみ: 親が居なければ子は請求に残る（根管貼薬を単独で算定）", () => {
  const r = loaded.engine.calculate(ctx(["309003310"])); // 抜髄なし
  assert.ok(r.lines.some((l) => l.procedureCode === "309003310"), "親不在なのに包括除外された");
  assert.ok(!r.issues.some((i) => i.excludesFromBilling));
});

test("工場エンジン: 回数制限が発火（初診料を月2回）", () => {
  const r = loaded.engine.calculate(ctx(["301000110"], { "301000110": 1 }));
  assert.ok(r.issues.some((i) => i.severity === "error" && i.procedureCode === "301000110"));
});

test("工場: 摘要欄コメント候補を引ける（初診料→健康診断）", () => {
  const candidates = commentCandidates(loaded, "301000110");
  assert.ok(candidates.some((e) => e.commentCode === "820100300"));
});

test("工場: 病名適応ルール（調査DB）が有効化・発火（Per病名で抜髄→警告）", () => {
  assert.ok(loaded.counts.diagnosisRules > 0, `diagnosisRules=${loaded.counts.diagnosisRules}`);
  const r = loaded.engine.calculate(ctx(["309002110"])); // 抜髄
  // 病名なし→必要病名なしの警告は出ないが、Per病名を付けると不適応警告
  const r2 = loaded.engine.calculate({
    patient: { id: "p", birthDate: "1980-01-01", sex: "F" },
    visit: { id: "v", patientId: "p", visitDate: "2026-06-12", visitType: "first" },
    procedures: [{ procedureCode: "309002110", quantity: 1 }],
    diagnoses: [{ diseaseCode: "8832354", onsetDate: "2026-06-01" }], // 急性根尖性歯周炎(Per)
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master: loaded.master,
  });
  assert.ok(r2.issues.some((i) => i.severity === "warning" && i.procedureCode === "309002110" && i.message.includes("算定できません")));
  // r（病名なし）は不適応警告を出さない
  assert.ok(!r.issues.some((i) => i.message.includes("算定できません")));
});

test("工場: 傷病名コードの妥当性（実在=OK / 架空=NG / 未コード化=OK）", () => {
  assert.ok(loaded.counts.diseases > 5000);
  assert.ok(isValidDisease(loaded, "8840351")); // 慢性歯周炎第１度
  assert.ok(isValidDisease(loaded, "0000999")); // 未コード化
  assert.ok(!isValidDisease(loaded, "9999999"));
});
