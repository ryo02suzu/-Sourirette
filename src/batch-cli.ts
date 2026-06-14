/**
 * バッチ自動化 CLI: 入力JSON（1ヶ月分の全レセプト）→ RECEIPTS.UKE を1コマンドで自動生成。
 *
 * 使い方:
 *   npm run batch -- examples/clinic-month.json out/RECEIPTS.UKE
 *   node dist/src/batch-cli.js <入力JSON> [出力UKE=RECEIPTS.UKE]
 *
 * 「カルテ入力 → 全患者を実点数で算定 → 医院単位の1ファイル生成 → 提出前自己点検」を自動実行。
 * ⚠️ 実提出（オンライン請求）は支払基金システム側でコード外。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOfficialEngine, type OfficialDataSources } from "./billing/official-engine.js";
import { processBatch, type BatchInput } from "./receipt/batch.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const buf = (rel: string) => new Uint8Array(readFileSync(join(ROOT, rel)));
const abs = (p: string) => (isAbsolute(p) ? p : join(process.cwd(), p));

function loadEngine() {
  const sources: OfficialDataSources = {
    procedureMaster: buf("data/masters/h_ALL20260611.csv"),
    santeiKaisu: buf("data/tensuhyo/04_santei_kaisu.csv"),
    haihanSameDay: buf("data/tensuhyo/03-1_haihan.csv"),
    haihanSameMonth: buf("data/tensuhyo/03-2_haihan.csv"),
    hojoMaster: buf("data/tensuhyo/01_hojo_master.csv"),
    hokatsu: buf("data/tensuhyo/02_hokatsu.csv"),
    betsu1Csv: readFileSync(join(ROOT, "data/masters/betsu1_shika_20260601.csv"), "utf-8"),
    diseaseMasters: [buf("data/masters/b_20260601.txt"), buf("data/masters/hb_20260601.txt")],
  };
  return loadOfficialEngine(sources);
}

function main(): void {
  const inputPath = process.argv[2];
  if (inputPath === undefined) {
    process.stderr.write("使い方: node dist/src/batch-cli.js <入力JSON> [出力UKE=RECEIPTS.UKE]\n");
    process.exitCode = 2;
    return;
  }
  const outPath = process.argv[3] ?? "RECEIPTS.UKE";

  process.stdout.write("公式エンジンを構成中…\n");
  const loaded = loadEngine();
  const input = JSON.parse(readFileSync(abs(inputPath), "utf-8")) as BatchInput;

  const r = processBatch(loaded, input);

  process.stdout.write(`\n=== バッチ算定結果（${input.facility.facilityName} ${input.facility.billingMonth}）===\n`);
  for (const p of r.perReceipt) {
    process.stdout.write(`  レセプト${p.receiptNo} ${p.name}: ${p.totalPoints}点 / 実日数${p.visitDays}\n`);
    for (const is of p.algorithmIssues) {
      process.stdout.write(`      [${is.severity === "error" ? "エラー" : "警告"}] ${is.message}\n`);
    }
  }
  process.stdout.write(`\nレセプト ${r.receiptCount}件 / 総合計 ${r.grandTotalPoints}点 / ${r.recordCount}レコード・${r.byteLength}バイト\n`);
  if (r.validation.length === 0) {
    process.stdout.write("提出前自己点検: 指摘なし\n");
  } else {
    for (const v of r.validation) {
      process.stdout.write(`  [${v.severity === "reject" ? "受付不能" : "要確認"}] ${v.code} ${v.message}${v.receiptNo ? `（レセプト${v.receiptNo}）` : ""}\n`);
    }
  }

  const out = abs(outPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, r.bytes);
  process.stdout.write(`\n${r.submittable ? "✓ 提出可" : "⚠ 受付不能の指摘あり（要修正）"} → ${out} に書き出しました（Shift_JIS）\n`);
  process.stdout.write("⚠️ 実提出（オンライン請求）は支払基金システムで別途（確認試験・閉域網・証明書）。\n");
  if (!r.submittable) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
