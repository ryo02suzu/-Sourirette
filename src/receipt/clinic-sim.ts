/**
 * 仮想歯科医院シミュレータ（ドッグフーディング用のスモークテスト）。
 *
 * 目的: 実マスタの実点数＋電子点数表の回数制限を載せたエンジンで、合成の患者・受診を
 * 1ヶ月分まわし、UKE生成→提出前自己点検まで一気通貫で動かす。配管（パイプライン）が
 * 壊れていないか・量に耐えるか・載っているルールが発火するかを確認する。
 *
 * ⚠️ これが確認できるのは「配管が動くこと」だけ。算定が"臨床的に正しい"ことは証明できない
 *    （テストケースも正解も自分で作る＝循環。独立した検証者＝歯科医師・確認試験が別途要る）。
 *    受診内容は配管検証用の合成データであり、臨床的に妥当な処置の組合せではない。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  CalculationEngine,
  type CalculationContext,
  type ClaimLine,
  type Rule,
} from "../billing/engine.js";
import { decodeSjis, parseDentalProcedureMaster, buildMasterFromRows } from "../billing/master-loader.js";
import { createDataDrivenRules } from "../billing/rule-tables.js";
import { parseSanteiKaisu, santeiKaisuToFrequencyLimits, decodeTensuhyo } from "../billing/tensuhyo-loader.js";
import type { Diagnosis, Patient, Visit } from "../domain/types.js";
import { monthlyClaimToReceipt, type VisitClaim } from "./from-claim.js";
import { assembleUkeFile } from "./build.js";
import { validateUkeRecords, isSubmittable } from "./validate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (rel: string) => readFileSync(join(ROOT, rel));

// 検証済みの実コード（実点数はマスタから引く）
const CODES = {
  shoshin: "301000110", // 歯科初診料
  panorama: "305000110", // 写真診断（全顎）
  xray: "305004010", // 単純撮影（デジタル）
};

/** コード接頭辞から診療識別（別表20）をざっくり割当（配管検証用） */
function categoryOf(code: string): string {
  if (code.startsWith("3010")) return "11"; // 初・再診
  if (code.startsWith("305")) return "31"; // Ｘ線検査
  return "80";
}

function makeEngine() {
  const master = buildMasterFromRows(parseDentalProcedureMaster(decodeSjis(new Uint8Array(load("data/masters/h_ALL20260611.csv")))));
  const limits = santeiKaisuToFrequencyLimits(parseSanteiKaisu(decodeTensuhyo(new Uint8Array(load("data/tensuhyo/04_santei_kaisu.csv")))), "2026-06-12");
  const pricing: Rule = {
    id: "sim-pricing/2026-04-01",
    validFrom: "2026-04-01",
    evaluate(ctx: CalculationContext) {
      const lines: ClaimLine[] = [];
      for (const p of ctx.procedures) {
        const row = ctx.master.findProcedure(p.procedureCode, ctx.visit.visitDate);
        if (!row) continue;
        lines.push({ procedureCode: p.procedureCode, name: row.name, points: row.points, quantity: p.quantity, category: categoryOf(p.procedureCode) });
      }
      return { lines };
    },
  };
  const engine = new CalculationEngine([pricing, ...createDataDrivenRules({ frequencyLimits: limits }, "2024-04-01")]);
  return { engine, master };
}

interface SimPatient {
  name: string;
  kana: string;
  sex: "M" | "F";
  birth: string;
  /** [日, コード列] の受診 */
  visits: [string, string[]][];
  diseaseCode: string;
  teeth: string[];
}

/** 合成患者（配管検証用。臨床的妥当性は問わない） */
const PATIENTS: SimPatient[] = [
  { name: "患者　一郎", kana: "カンジャイチロウ", sex: "M", birth: "1975-04-02", diseaseCode: "5250001", teeth: ["16"], visits: [["2026-06-03", [CODES.shoshin, CODES.panorama, CODES.xray]], ["2026-06-17", [CODES.xray]]] },
  { name: "患者　花子", kana: "カンジャハナコ", sex: "F", birth: "1988-11-20", diseaseCode: "5250001", teeth: ["26"], visits: [["2026-06-05", [CODES.shoshin, CODES.panorama]]] },
  { name: "患者　三郎", kana: "カンジャサブロウ", sex: "M", birth: "1962-01-15", diseaseCode: "5250001", teeth: ["36"], visits: [["2026-06-10", [CODES.shoshin]], ["2026-06-24", [CODES.xray]]] },
  // 意図的な違反: 同月に初診を2回（電子点数表の回数制限が捕まえるはず）
  { name: "患者　四子", kana: "カンジャヨンコ", sex: "F", birth: "1999-07-07", diseaseCode: "5250001", teeth: ["46"], visits: [["2026-06-02", [CODES.shoshin]], ["2026-06-19", [CODES.shoshin]]] },
];

function run(): void {
  const { engine } = makeEngine();
  let totalPoints = 0;
  let submittable = 0;
  let withEngineIssues = 0;
  const lines: string[] = [];

  PATIENTS.forEach((pt, i) => {
    const patient: Patient = { id: `sim-${i}`, birthDate: pt.birth, sex: pt.sex };
    const diagnoses: Diagnosis[] = [{ diseaseCode: pt.diseaseCode, teeth: pt.teeth, onsetDate: pt.visits[0]![0] }];
    const visitClaims: VisitClaim[] = [];
    const engineIssues: string[] = [];
    for (const [date, codes] of pt.visits) {
      const visit: Visit = { id: `v-${i}-${date}`, patientId: patient.id, visitDate: date, visitType: codes.includes(CODES.shoshin) ? "first" : "followup" };
      const result = engine.calculate({
        patient, visit,
        procedures: codes.map((c) => ({ procedureCode: c, quantity: 1 })),
        diagnoses,
        // 月内履歴: 直前までの同月の同コード算定回数
        history: { countInMonth: (code) => visitClaims.reduce((n, vc) => n + vc.result.lines.filter((l) => l.procedureCode === code).reduce((m, l) => m + l.quantity, 0), 0) },
        facility: { has: () => false },
        master: makeEngine().master,
      });
      for (const is of result.issues) engineIssues.push(`${is.severity}: ${is.message}`);
      visitClaims.push({ visit, result });
    }
    const receipt = monthlyClaimToReceipt({ patient, visits: visitClaims, diagnoses, receiptNo: i + 1, scheme: { kind: "medical", beneficiary: "family" }, name: pt.name, kanaName: pt.kana, insurer: { insurerNo: "01130012", number: "123" } });
    const records = assembleUkeFile({ facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "シミュレーション歯科", billingMonth: "202607" }, receipts: [receipt] });
    const points = visitClaims.reduce((s, vc) => s + vc.result.totalPoints, 0);
    const issues = validateUkeRecords(records);
    totalPoints += points;
    if (isSubmittable(issues)) submittable++;
    if (engineIssues.length > 0) withEngineIssues++;
    lines.push(`  ${pt.name}: 受診${pt.visits.length}回 / ${points}点 / 自己点検 ${isSubmittable(issues) ? "OK" : "NG(" + issues.filter((x) => x.severity === "reject").length + ")"}${engineIssues.length ? " / エンジン指摘: " + engineIssues.join("; ") : ""}`);
  });

  process.stdout.write("=== 仮想歯科医院 2026年6月 ===\n");
  process.stdout.write(lines.join("\n") + "\n");
  process.stdout.write(`\n患者${PATIENTS.length}名 / 合計${totalPoints}点（実マスタ点数）/ 自己点検OK ${submittable}/${PATIENTS.length} / エンジン指摘あり ${withEngineIssues}名\n`);
  process.stdout.write("\n※ これは配管の動作確認。算定の臨床的正しさは未検証（独立した検証者＝歯科医師・確認試験が別途必要）。\n");
}

if (import.meta.url === `file://${process.argv[1]}`) run();
