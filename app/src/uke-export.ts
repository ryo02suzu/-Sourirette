/**
 * UKE出力デモ配線。
 *
 * コア（算定エンジン src/billing → UKE 橋渡し src/receipt → Shift_JIS 直列化）を実際に
 * 通し、記録条件仕様（歯科用）準拠の RECEIPTS.UKE を生成・ダウンロードする。
 * モックの飾りではなく本物のパイプラインを実行する。
 *
 * ⚠️ 診療行為コードは公式の作成手引き記録例に出現する実コードを使用するが、点数は
 *    サンプル値。本番は支払基金の公式マスタ取込（valid_from 付き）に置き換える。
 */
import {
  CalculationEngine,
  type CalculationContext,
  type ClaimLine,
  type Rule,
  type RuleOutput,
} from "../../src/billing/engine.js";
import { InMemoryMaster } from "../../src/billing/master.js";
import { createBasicVisitRule } from "../../src/billing/rules/basic-visit.js";
import type { Diagnosis, Patient, Visit } from "../../src/domain/types.js";
import { monthlyClaimToReceipt, type VisitClaim } from "../../src/receipt/from-claim.js";
import { assembleUkeFile, type UkeFileInput } from "../../src/receipt/build.js";
import { encodeUkeFile, serializeFile } from "../../src/receipt/uke.js";

const SINCE = "2026-04-01";

// 基本診療料コード（歯科・9桁。作成手引き記録例より）
const VISIT_CODES = { firstVisit: "301000110", followupVisit: "301001710" } as const;

// 処置・検査系のデモ行為（識別＝別表20）。⚠️点数はサンプル値。
interface DemoProcedure {
  code: string;
  name: string;
  points: number;
  category: string; // 別表20 診療識別
}
const DEMO_PROCEDURES: DemoProcedure[] = [
  { code: "305000110", name: "歯科パノラマ断層撮影", points: 58, category: "31" },
  { code: "305004010", name: "歯科エックス線写真診断（単純撮影）", points: 30, category: "31" },
];

function buildMaster(): InMemoryMaster {
  const m = new InMemoryMaster();
  m.add({ code: VISIT_CODES.firstVisit, name: "歯科初診料", points: 272, validFrom: SINCE });
  m.add({ code: VISIT_CODES.followupVisit, name: "歯科再診料", points: 59, validFrom: SINCE });
  for (const p of DEMO_PROCEDURES) m.add({ code: p.code, name: p.name, points: p.points, validFrom: SINCE });
  return m;
}

/** 入力処置をマスタ点数で算定行に変換し、各行に診療識別（別表20）を付与する */
const procedurePricingRule: Rule = {
  id: `uke-demo-pricing/${SINCE}`,
  validFrom: SINCE,
  evaluate(ctx: CalculationContext): RuleOutput {
    const lines: ClaimLine[] = [];
    for (const p of ctx.procedures) {
      const meta = DEMO_PROCEDURES.find((d) => d.code === p.procedureCode);
      if (!meta) continue; // 基本診療料は basic-visit ルールが扱う
      const row = ctx.master.findProcedure(p.procedureCode, ctx.visit.visitDate);
      if (!row) continue;
      lines.push({
        procedureCode: p.procedureCode,
        name: row.name,
        points: row.points,
        quantity: p.quantity,
        category: meta.category,
      });
    }
    return { lines };
  },
};

const engine = new CalculationEngine([createBasicVisitRule(VISIT_CODES, SINCE), procedurePricingRule]);
const master = buildMaster();

export interface UkeExportResult {
  /** 生成したレコード行のテキスト（プレビュー用。改行は実体の CR+LF を LF に正規化） */
  text: string;
  /** Shift_JIS ＋ EOF を含む実バイト列 */
  bytes: Uint8Array;
  recordCount: number;
  byteLength: number;
  totalPoints: number;
  /** 診療実日数（受診日数） */
  visitDays: number;
}

/** 1受診分をエンジンで計算する */
function calcVisit(
  patient: Patient,
  visitDate: string,
  visitType: "first" | "followup",
  procedureCodes: string[],
  diagnoses: Diagnosis[],
): VisitClaim {
  const visit: Visit = { id: `demo-${visitDate}`, patientId: patient.id, visitDate, visitType };
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

/**
 * デモ症例を算定エンジンで計算し、1か月分（複数受診）のレセプトとして RECEIPTS.UKE を生成する。
 *   - 6/5 初診: 歯科初診料＋パノラマ＋エックス線写真診断
 *   - 6/12, 6/19 再診: 歯科再診料（同一コードは算定日情報にマージ・回数2）
 */
export function generateDemoUke(): UkeExportResult {
  const patient: Patient = { id: "demo", birthDate: "1980-06-30", sex: "F" };
  const diagnoses: Diagnosis[] = [{ diseaseCode: "5250001", teeth: ["16"], onsetDate: "2026-06-05" }];

  const visits: VisitClaim[] = [
    calcVisit(patient, "2026-06-05", "first", ["305000110", "305004010"], diagnoses),
    calcVisit(patient, "2026-06-12", "followup", [], diagnoses),
    calcVisit(patient, "2026-06-19", "followup", [], diagnoses),
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
  const totalPoints = visits.reduce((s, v) => s + v.result.totalPoints, 0);
  const visitDays = new Set(visits.map((v) => v.visit.visitDate)).size;

  const facility: UkeFileInput["facility"] = {
    payer: "1", // 別表1: 支払基金
    prefecture: "13", // 別表2: 東京
    facilityCode: "1234567",
    facilityName: "ソーリレット歯科デモ医院", // 医療機関名称は漢字モード（全角）。半角英字は不可
    billingMonth: "202607",
    phone: "03-1234-5678",
  };

  const records = assembleUkeFile({ facility, receipts: [receipt] });
  const bytes = encodeUkeFile(records);
  return {
    text: serializeFile(records).replace(/\r\n/g, "\n"),
    bytes,
    recordCount: records.length,
    byteLength: bytes.length,
    totalPoints,
    visitDays,
  };
}

/** 生成した UKE バイト列を RECEIPTS.UKE としてブラウザでダウンロードさせる */
export function downloadUke(bytes: Uint8Array): void {
  // Uint8Array をそのまま Blob に渡す（Shift_JIS バイト列を変質させない）
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "RECEIPTS.UKE";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
