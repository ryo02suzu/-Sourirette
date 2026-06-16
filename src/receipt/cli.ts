/**
 * UKE 生成＋提出前自己点検の CLI（確認試験の予行）。
 *
 * ブラウザのデモ（app/）とは別に、本番の月次バッチ請求に近い「ファイルを書き出す」経路を
 * 提供する。算定エンジン → UKE 橋渡し → 自己点検 → Shift_JIS 書き出しを一気通貫で実行する。
 *
 * 使い方:
 *   npm run uke:demo                 → ./RECEIPTS.UKE を生成し点検結果を表示
 *   node dist/src/receipt/cli.js out/RECEIPTS.UKE
 *
 * ⚠️ 点数はサンプル値（公式マスタのDB取込＝Phase 2-1 で実点数に置き換える）。
 */
import { writeFileSync } from "node:fs";
import { CalculationEngine, type CalculationContext, type ClaimLine, type Rule } from "../billing/engine.js";
import { InMemoryMaster } from "../billing/master.js";
import { createBasicVisitRule } from "../billing/rules/basic-visit.js";
import type { Diagnosis, Patient, Visit } from "../domain/types.js";
import { monthlyClaimToReceipt, type VisitClaim } from "./from-claim.js";
import { assembleUkeFile } from "./build.js";
import { encodeUkeFile, serializeFile } from "./uke.js";
import { isSubmittable, validateUkeRecords } from "./validate.js";

const SINCE = "2026-04-01";
const VISIT_CODES = { firstVisit: "301000110", followupVisit: "301001710" } as const;
// ⚠️ 作成手引き記録例由来の実コード＋サンプル点数。
const X_RAY: { code: string; name: string; points: number; category: string }[] = [
  { code: "305000110", name: "歯科パノラマ断層撮影", points: 58, category: "31" },
  { code: "305004010", name: "歯科エックス線写真診断", points: 30, category: "31" },
];

function buildMaster(): InMemoryMaster {
  const m = new InMemoryMaster();
  m.add({ code: VISIT_CODES.firstVisit, name: "歯科初診料", points: 272, validFrom: SINCE });
  m.add({ code: VISIT_CODES.followupVisit, name: "歯科再診料", points: 59, validFrom: SINCE });
  for (const x of X_RAY) m.add({ code: x.code, name: x.name, points: x.points, validFrom: SINCE });
  return m;
}

const pricingRule: Rule = {
  id: `cli-pricing/${SINCE}`,
  validFrom: SINCE,
  evaluate(ctx: CalculationContext) {
    const lines: ClaimLine[] = [];
    for (const p of ctx.procedures) {
      const meta = X_RAY.find((x) => x.code === p.procedureCode);
      if (!meta) continue;
      const row = ctx.master.findProcedure(p.procedureCode, ctx.visit.visitDate);
      if (!row) continue;
      lines.push({ procedureCode: p.procedureCode, name: row.name, points: row.points, quantity: p.quantity, category: meta.category });
    }
    return { lines };
  },
};

function calcVisit(
  engine: CalculationEngine,
  master: InMemoryMaster,
  patient: Patient,
  date: string,
  type: "first" | "followup",
  procedureCodes: string[],
  diagnoses: Diagnosis[],
): VisitClaim {
  const visit: Visit = { id: `v-${date}`, patientId: patient.id, visitDate: date, visitType: type };
  const result = engine.calculate({
    patient,
    visit,
    procedures: procedureCodes.map((procedureCode) => ({ procedureCode, quantity: 1 })),
    diagnoses,
    history: { countInMonth: () => 0 },
    facility: { has: () => false },
    master,
  });
  return { visit, result };
}

/** サンプルの月次レセプトを組み立てて UKE レコード列を返す */
export function buildSampleUkeRecords() {
  const master = buildMaster();
  const engine = new CalculationEngine([createBasicVisitRule(VISIT_CODES, SINCE), pricingRule]);
  const patient: Patient = { id: "demo", birthDate: "1980-06-30", sex: "F" };
  const diagnoses: Diagnosis[] = [{ diseaseCode: "5250001", teeth: ["16"], onsetDate: "2026-06-05" }];
  const visits: VisitClaim[] = [
    calcVisit(engine, master, patient, "2026-06-05", "first", ["305000110", "305004010"], diagnoses),
    calcVisit(engine, master, patient, "2026-06-12", "followup", [], diagnoses),
    calcVisit(engine, master, patient, "2026-06-19", "followup", [], diagnoses),
  ];
  const receipt = monthlyClaimToReceipt({
    patient,
    visits,
    diagnoses,
    receiptNo: 1,
    scheme: { kind: "medical", beneficiary: "family" },
    name: "基金　花子",
    kanaName: "キキンハナコ",
    chartNo: "DEMO-0001",
    insurer: { insurerNo: "01130012", symbol: "11010203", number: "123" },
  });
  return assembleUkeFile({
    facility: {
      payer: "1",
      prefecture: "13",
      facilityCode: "1234567",
      facilityName: "ソーリレット歯科デモ医院",
      billingMonth: "202607",
      phone: "03-1234-5678",
    },
    receipts: [receipt],
  });
}

function main(): void {
  const outPath = process.argv[2] ?? "RECEIPTS.UKE";
  const records = buildSampleUkeRecords();
  const issues = validateUkeRecords(records);

  process.stdout.write("=== 生成レコード ===\n");
  process.stdout.write(serializeFile(records).replace(/\r\n/g, "\n"));
  process.stdout.write("\n=== 提出前自己点検（受付・事務点検ASP相当）===\n");
  if (issues.length === 0) {
    process.stdout.write("指摘なし。\n");
  } else {
    for (const i of issues) {
      const where = i.receiptNo !== undefined ? `（レセプト${i.receiptNo}）` : "";
      process.stdout.write(`[${i.severity === "reject" ? "受付不能" : "要確認"}] ${i.code} ${i.message}${where}\n`);
    }
  }

  const bytes = encodeUkeFile(records);
  writeFileSync(outPath, bytes);
  process.stdout.write(
    `\n${records.length}レコード / ${bytes.length}バイト・Shift_JIS を ${outPath} に書き出しました。\n` +
      `提出可否: ${isSubmittable(issues) ? "✓ 提出可（受付不能の指摘なし）" : "⚠ 受付不能の指摘あり。修正が必要"}\n` +
      "⚠️ 点数はサンプル値。実点数は公式マスタのDB取込（Phase 2-1）で置き換えます。\n",
  );
  if (!isSubmittable(issues)) process.exitCode = 1;
}

// このファイルが直接実行されたときのみ main を走らせる
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
