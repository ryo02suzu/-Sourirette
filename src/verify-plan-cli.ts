/**
 * 研鑽（実医院突合）の優先順位プランを生成する。
 * 実行: npm run verify:plan  → docs/verification-priority.md を出力
 *
 * 手起こしルール層（病名適応・施設基準・通則注）は、正しさを実医院突合でしか確定できない。
 * 限られた突合時間を「効くもの・高頻度のもの・怪しいもの」から順に使えるよう、
 * data/rules/santei-rules-R8.json を リスク順に並べたチェックリストにする。
 *
 * リスク = 影響度 × 不確かさ
 *   影響度: 実際に発火するか（不適応＝warning発火 / 施設基準＝error）／支払基金が機械チェック
 *           している高頻度事例か（computer_check の対象区分と一致するか）。
 *   不確かさ: confidence（high/medium/low）・needs_verification フラグ。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const db = JSON.parse(readFileSync(join(ROOT, "data/rules/santei-rules-R8.json"), "utf-8")) as RulesDbShape;

interface DP {
  id: string; procedure_kubun?: string; procedure_name?: string;
  relation?: string; confidence?: string; needs_verification?: boolean;
  source?: string; note?: string; required_diseases?: string[]; forbidden_diseases?: string[];
}
interface FS { id: string; standard_name?: string; besshi5_code?: string; gated_procedure_codes?: string[]; confidence?: string; source?: string; }
interface CC { id: string; target_codes?: string[]; check_name?: string; }
interface RulesDbShape { diagnosis_procedure: DP[]; facility_standard: FS[]; computer_check: CC[]; age_time_site: unknown[]; }

/** computer_check が対象にする区分の集合（＝支払基金が機械チェックする高頻度の的） */
const ccKubun = new Set<string>();
for (const cc of db.computer_check) for (const t of cc.target_codes ?? []) ccKubun.add(t);

const confWeight = (c?: string): number => (c === "high" ? 20 : c === "medium" ? 10 : 0);

interface Row { tier: string; score: number; id: string; kind: string; fires: string; name: string; conf: string; flags: string; source: string }

const rows: Row[] = [];

for (const dp of db.diagnosis_procedure) {
  const fires = dp.relation === "不適応"; // 不適応のみ warning 発火（適応は発火させない方針）
  const cc = dp.procedure_kubun !== undefined && [...ccKubun].some((k) => dp.procedure_kubun!.split("/").includes(k));
  const uncertain = dp.confidence === "low" || dp.confidence === "medium" || dp.needs_verification === true;
  let score = 0;
  if (fires) score += 100;
  if (cc) score += 40;
  score += confWeight(dp.confidence);
  if (dp.needs_verification) score += 5; // 怪しい発火ルールは優先的に確認
  const tier = fires && cc ? "A 最優先" : fires && !uncertain ? "B 発火・高信頼" : fires ? "C 発火・要確認" : "E 非発火(適応)";
  rows.push({
    tier, score, id: dp.id, kind: dp.relation ?? "?",
    fires: fires ? "warning発火" : "—",
    name: `${dp.procedure_kubun ?? ""} ${dp.procedure_name ?? ""}`.trim(),
    conf: dp.confidence ?? "?",
    flags: [cc ? "支払基金チェック対象" : "", dp.needs_verification ? "needs_verification" : ""].filter(Boolean).join("・") || "—",
    source: dp.source ?? "",
  });
}

for (const fs of db.facility_standard) {
  const gated = (fs.gated_procedure_codes ?? []).length > 0;
  rows.push({
    tier: gated ? "D 施設基準(発火)" : "D 施設基準(無効化中)",
    score: gated ? 60 : 30,
    id: fs.id, kind: "施設基準",
    fires: gated ? "error発火" : "ゲート無効化(誤発火防止)",
    name: fs.standard_name ?? fs.besshi5_code ?? "",
    conf: fs.confidence ?? "?",
    flags: gated ? "未届で算定→error" : "加算コード特定後に有効化",
    source: fs.source ?? "",
  });
}

const order = ["A 最優先", "B 発火・高信頼", "C 発火・要確認", "D 施設基準(発火)", "D 施設基準(無効化中)", "E 非発火(適応)"];
rows.sort((a, b) => (order.indexOf(a.tier) - order.indexOf(b.tier)) || (b.score - a.score) || a.id.localeCompare(b.id));

const counts = order.map((t) => `${t}: ${rows.filter((r) => r.tier === t).length}件`).join(" ／ ");

const lines: string[] = [];
lines.push("# 研鑽（実医院突合）優先順位リスト");
lines.push("");
lines.push("> 自動生成（`npm run verify:plan`）。手起こしルール層を「効く・高頻度・怪しい」順に並べた、");
lines.push("> 実医院の実レセプト×既存レセコン出力との突合を進めるためのチェックリスト。");
lines.push("> 上から順に潰せば、影響の大きい誤りから先に見つかる。");
lines.push("");
lines.push("**注**: CSV由来層（点数・包括・背反・回数）は公式データ＋回帰テストで固定済みのため本リストの対象外。");
lines.push("ここは審査情報提供事例・告示通知から手起こしした、実医院でしか正解が取れない層。");
lines.push("");
lines.push(`内訳: ${counts}`);
lines.push("");
lines.push("優先度の意味:");
lines.push("- **A 最優先**: 不適応warningが発火し、かつ支払基金が機械チェックしている高頻度の的。誤りなら実害最大。");
lines.push("- **B 発火・高信頼**: 不適応warning発火・confidence high。発火するので突合価値が高い。");
lines.push("- **C 発火・要確認**: 不適応warning発火だが confidence 中/低 または needs_verification。怪しい発火＝先に確認。");
lines.push("- **D 施設基準**: 発火するもの／加算コード未特定で無効化中のもの（コード特定→有効化の検証）。");
lines.push("- **E 非発火(適応)**: 適応事例。現状ルール化しておらず影響小。最後でよい。");
lines.push("");
lines.push("| 優先 | ID | 対象 | 発火 | 信頼度 | フラグ | 出所 | 検証状態 |");
lines.push("|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  lines.push(`| ${r.tier} | ${r.id} | ${r.name} | ${r.fires} | ${r.conf} | ${r.flags} | ${r.source} | ☐ 未突合 |`);
}
lines.push("");
lines.push("## 使い方");
lines.push("1. 上から順に、その区分の実レセプト（実家クリニック）を既存レセコン出力と突き合わせる。");
lines.push("2. 一致＝「検証状態」を ☑ 検証済 に。不一致＝ルール（病名/区分/コード）を修正し再テスト。");
lines.push("3. A→B→C を一巡したら、施設基準(D)の加算コード特定→有効化、最後に適応(E)。");
lines.push("4. JSON更新後は `npm run verify:plan` で本リストを再生成。");

writeFileSync(join(ROOT, "docs/verification-priority.md"), lines.join("\n") + "\n");
console.log(`研鑽優先順位リストを生成: docs/verification-priority.md（${rows.length}件）`);
console.log(counts);
