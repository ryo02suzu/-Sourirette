/**
 * 仮想歯科医院シミュレータ（電子点数表の3ルールを全部載せた統合スモークテスト）。
 *
 * 実マスタの実点数＋電子点数表の「回数制限・背反・包括」を全部載せたエンジンで、
 * 合成の患者・受診を1ヶ月分まわし、UKE生成→提出前自己点検まで一気通貫で動かす。
 * 正常患者に加え、各ルールを踏む違反患者を入れて、公式ルールが実際に発火するか確認する。
 *
 * ⚠️ 確認できるのは「配管が動く・載せたルールが発火する」ことだけ。算定が"臨床的に正しい"
 *    ことは証明できない（独立した検証者＝歯科医師・確認試験が別途必要）。受診内容は配管検証用
 *    の合成データで、臨床的に妥当な処置の組合せではない。
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
import {
  createInclusionGroupRule,
  decodeTensuhyo,
  haihanToMutualExclusions,
  parseHaihan,
  parseHojoMasterGroups,
  parseHokatsuChildren,
  parseSanteiKaisu,
  santeiKaisuToFrequencyLimits,
} from "../billing/tensuhyo-loader.js";
import type { Diagnosis, Patient, Visit } from "../domain/types.js";
import { monthlyClaimToReceipt, type VisitClaim } from "./from-claim.js";
import { assembleUkeFile } from "./build.js";
import { validateUkeRecords, isSubmittable } from "./validate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (rel: string) => readFileSync(join(ROOT, rel));
const ASOF = "2026-06-12";

const CODES = {
  shoshin: "301000110", // 歯科初診料
  panorama: "305000110", // 写真診断（全顎）
  xray: "305004010", // 単純撮影（デジタル）
  batsuzui: "309002110", // 抜髄（単根管）
  konkanchoyaku: "309003310", // 根管貼薬（単根管）← 抜髄に包括
  kaihou: "302002210", // 開放型病院共同指導料1 ← 初診と同日背反
};

function categoryOf(code: string): string {
  if (code.startsWith("3010")) return "11";
  if (code.startsWith("305")) return "31";
  if (code.startsWith("309")) return "41"; // 処置・手術
  return "80";
}

/** 実マスタ＋電子点数表の全ルールを1回だけ構築する */
function build() {
  const master = buildMasterFromRows(parseDentalProcedureMaster(decodeSjis(new Uint8Array(load("data/masters/h_ALL20260611.csv")))));
  const frequencyLimits = santeiKaisuToFrequencyLimits(parseSanteiKaisu(decodeTensuhyo(new Uint8Array(load("data/tensuhyo/04_santei_kaisu.csv")))), ASOF);
  const sameDay = haihanToMutualExclusions(parseHaihan(decodeTensuhyo(new Uint8Array(load("data/tensuhyo/03-1_haihan.csv")))), "same-day", ASOF);
  const sameMonth = haihanToMutualExclusions(parseHaihan(decodeTensuhyo(new Uint8Array(load("data/tensuhyo/03-2_haihan.csv")))), "same-month", ASOF);
  const mutualExclusions = [...sameDay, ...sameMonth];
  const parentsByGroup = parseHojoMasterGroups(decodeTensuhyo(new Uint8Array(load("data/tensuhyo/01_hojo_master.csv"))), ASOF);
  const childrenByGroup = parseHokatsuChildren(decodeTensuhyo(new Uint8Array(load("data/tensuhyo/02_hokatsu.csv"))), ASOF);
  const inclusionRule = createInclusionGroupRule(parentsByGroup, childrenByGroup, "2024-04-01");
  // 包括グループ数（ペア展開しないので件数はグループ単位）
  const inclusionGroups = [...parentsByGroup.keys()].filter((g) => childrenByGroup.has(g)).length;
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
  const engine = new CalculationEngine([pricing, ...createDataDrivenRules({ frequencyLimits, mutualExclusions }, "2024-04-01"), inclusionRule]);
  return { engine, master, counts: { frequencyLimits: frequencyLimits.length, mutualExclusions: mutualExclusions.length, inclusionGroups } };
}

interface SimPatient {
  name: string; kana: string; sex: "M" | "F"; birth: string;
  visits: [string, string[]][];
  diseaseCode: string; teeth: string[];
  expect?: string; // 期待する違反（説明用）
}

const PATIENTS: SimPatient[] = [
  { name: "患者　一郎", kana: "カンジャイチロウ", sex: "M", birth: "1975-04-02", diseaseCode: "5250001", teeth: ["16"], visits: [["2026-06-03", [CODES.shoshin, CODES.panorama]], ["2026-06-17", [CODES.xray]]] },
  { name: "患者　花子", kana: "カンジャハナコ", sex: "F", birth: "1988-11-20", diseaseCode: "5250001", teeth: ["26"], visits: [["2026-06-05", [CODES.shoshin, CODES.batsuzui]]] },
  // 違反: 回数（同月に初診2回）
  { name: "違反　回数", kana: "イハンカイスウ", sex: "F", birth: "1990-01-01", diseaseCode: "5250001", teeth: ["36"], visits: [["2026-06-02", [CODES.shoshin]], ["2026-06-20", [CODES.shoshin]]], expect: "回数制限" },
  // 違反: 包括（抜髄と同日に根管貼薬）
  { name: "違反　包括", kana: "イハンホウカツ", sex: "M", birth: "1980-05-05", diseaseCode: "5250001", teeth: ["46"], visits: [["2026-06-08", [CODES.batsuzui, CODES.konkanchoyaku]]], expect: "包括" },
  // 違反: 背反（初診と同日に開放型病院共同指導料1）
  { name: "違反　背反", kana: "イハンハイハン", sex: "F", birth: "1972-09-09", diseaseCode: "5250001", teeth: ["11"], visits: [["2026-06-10", [CODES.shoshin, CODES.kaihou]]], expect: "背反" },
];

function run(): void {
  const { engine, master, counts } = build();
  process.stdout.write(`=== 仮想歯科医院 2026年6月（公式ルール: 回数${counts.frequencyLimits}件 / 背反${counts.mutualExclusions}件 / 包括${counts.inclusionGroups}グループ・索引判定）===\n`);

  let totalPoints = 0;
  let caught = 0;
  PATIENTS.forEach((pt, i) => {
    const patient: Patient = { id: `sim-${i}`, birthDate: pt.birth, sex: pt.sex };
    const diagnoses: Diagnosis[] = [{ diseaseCode: pt.diseaseCode, teeth: pt.teeth, onsetDate: pt.visits[0]![0] }];
    const visitClaims: VisitClaim[] = [];
    const engineErrors: string[] = [];
    for (const [date, codes] of pt.visits) {
      const visit: Visit = { id: `v-${i}-${date}`, patientId: patient.id, visitDate: date, visitType: codes.includes(CODES.shoshin) ? "first" : "followup" };
      const ctx: CalculationContext = {
        patient, visit,
        procedures: codes.map((c) => ({ procedureCode: c, quantity: 1 })),
        diagnoses,
        history: { countInMonth: (code) => visitClaims.reduce((n, vc) => n + vc.result.lines.filter((l) => l.procedureCode === code).reduce((m, l) => m + l.quantity, 0), 0) },
        facility: { has: () => false },
        master,
      };
      const result = engine.calculate(ctx);
      for (const is of result.issues) if (is.severity === "error") engineErrors.push(is.message);
      visitClaims.push({ visit, result });
    }
    const receipt = monthlyClaimToReceipt({ patient, visits: visitClaims, diagnoses, receiptNo: i + 1, scheme: { kind: "medical", beneficiary: "family" }, name: pt.name, kanaName: pt.kana, insurer: { insurerNo: "01130012", number: "123" } });
    const records = assembleUkeFile({ facility: { payer: "1", prefecture: "13", facilityCode: "1234567", facilityName: "シミュレーション歯科", billingMonth: "202607" }, receipts: [receipt] });
    const points = visitClaims.reduce((s, vc) => s + vc.result.totalPoints, 0);
    totalPoints += points;
    const selfcheck = isSubmittable(validateUkeRecords(records)) ? "自己点検OK" : "自己点検NG";
    const mark = pt.expect ? (engineErrors.length ? `✓検出(${pt.expect})` : `✗未検出(${pt.expect})`) : (engineErrors.length ? `指摘あり` : `指摘なし`);
    if (pt.expect && engineErrors.length) caught++;
    process.stdout.write(`  ${pt.name}: ${points}点 / ${selfcheck} / ${mark}${engineErrors.length ? "  → " + engineErrors[0] : ""}\n`);
  });

  const violators = PATIENTS.filter((p) => p.expect).length;
  process.stdout.write(`\n合計${totalPoints}点（実マスタ）/ 違反検出 ${caught}/${violators}\n`);
  process.stdout.write("※ 配管とルール発火の確認のみ。臨床的正しさは未検証（歯科医師・確認試験が別途必要）。\n");
}

if (import.meta.url === `file://${process.argv[1]}`) run();
