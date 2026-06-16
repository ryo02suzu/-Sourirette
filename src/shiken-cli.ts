/**
 * 確認試験（仮想）CLI: デモのカルテ入力 → 実点数算定 → UKE生成 → 確認試験を通す。
 * 実行: npm run shiken
 *
 * オンライン請求の前段（受付L1・事務点検L2）をローカルで再現し、提出可否を判定する。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { loadOfficialEngine, isValidDisease, type OfficialDataSources } from "./billing/official-engine.js";
import { processReceipt, type ProcessReceiptInput } from "./receipt/process.js";
import { runKakuninShiken } from "./receipt/submission-sim.js";

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

const input: ProcessReceiptInput = {
  facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "ソーリレット歯科デモ医院", billingMonth: "202607" },
  patient: { birthDate: "2023-01-01", sex: "M" },
  name: "基金　太郎",
  kanaName: "キキンタロウ",
  scheme: { kind: "medical", beneficiary: "family" },
  insurer: { insurerNo: "01130012", number: "123" },
  notifiedStandards: ["歯初診", "外安全", "外感染"],
  visits: [
    // 乳幼児・初診・深夜 → 乳幼児深夜加算が自動付与される
    { date: "2026-06-05", visitType: "first", procedureCodes: ["301000110", "305000110"], timeClass: "midnight" },
  ],
  diagnoses: [{ diseaseCode: "8840351", teeth: ["16"], onsetDate: "2026-06-05" }],
};

const r = processReceipt(loaded, input);
console.log(`算定結果: 合計 ${r.totalPoints} 点 / ${r.recordCount} レコード`);
for (const l of r.accounting.detail) console.log(`  ${l.procedureCode} ${l.points}点 ${l.name}`);

const bytes = Uint8Array.from(Buffer.from(r.ukeBase64, "base64"));
const sk = runKakuninShiken(bytes, { isKnownDiseaseCode: (c) => isValidDisease(loaded, c) });
console.log("\n" + sk.report);
process.exit(sk.passed ? 0 : 1);
