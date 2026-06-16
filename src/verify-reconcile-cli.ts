/**
 * 突合ハーネス CLI（P0-2）。実行: npm run verify:reconcile [path]
 *
 * - path 指定（.UKE ファイル or ディレクトリ）: 既存レセコンの実UKEを匿名化→逆変換→再計算→突合。
 * - path 省略: 自前生成UKEで往復一致を確認するセルフデモ（データが無くてもパイプライン疎通を確認）。
 *
 * 実レセプトは必ず匿名化（PII除去）してから突合に渡す。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { loadOfficialEngine, type OfficialDataSources } from "./billing/official-engine.js";
import { decodeUkeFile, parseFile } from "./receipt/uke.js";
import { processReceipt, type ProcessReceiptInput } from "./receipt/process.js";
import { anonymizeUke } from "./verify/anonymize.js";
import { reconcileRecords, summarize, formatReport } from "./verify/reconcile.js";

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

const path = process.argv[2];

if (path === undefined) {
  // セルフデモ: 自前生成UKEを「既存レセコン出力」とみなして往復突合
  const demo: ProcessReceiptInput = {
    facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "突合デモ医院", billingMonth: "202606" },
    patient: { birthDate: "1980-06-30", sex: "F" },
    name: "基金　花子",
    scheme: { kind: "medical", beneficiary: "family" },
    insurer: { insurerNo: "01130012", number: "123" },
    visits: [
      { date: "2026-06-05", visitType: "first", procedureCodes: ["301000110", "305000110", "309002110", "309003310"] },
      { date: "2026-06-19", visitType: "followup", procedureCodes: ["301001610"] },
    ],
    diagnoses: [{ diseaseCode: "5220063", teeth: ["16"], onsetDate: "2026-06-05" }],
  };
  const original = parseFile(processReceipt(loaded, demo).recordsText);
  const anon = anonymizeUke(original);
  const per = reconcileRecords(anon, loaded);
  console.log("（セルフデモ: 自前生成UKEを既存レセコン出力に見立てた往復突合。pathを渡すと実UKEを突合）\n");
  console.log(formatReport({ perReceipt: per, summary: summarize(per) }));
  process.exit(per.every((r) => r.matched) ? 0 : 1);
}

// 実ファイル/ディレクトリ突合
const files = statSync(path).isDirectory()
  ? readdirSync(path).filter((n) => /\.uke$/i.test(n)).map((n) => join(path, n))
  : [path];
const allPer = files.flatMap((file) => {
  const records = decodeUkeFile(new Uint8Array(readFileSync(file)));
  return reconcileRecords(anonymizeUke(records), loaded);
});
const summary = summarize(allPer);
console.log(formatReport({ perReceipt: allPer, summary }));
process.exit(summary.matchRate === 1 ? 0 : 1);
