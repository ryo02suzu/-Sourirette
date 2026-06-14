/**
 * 製品API: 1患者・1ヶ月分の入力 → 算定 → UKE生成 → 提出前点検 を一気通貫で処理する。
 *
 * 公式エンジン工場（loadOfficialEngine）で構成した実点数・公式ルール付きエンジンを使い、
 * カルテ入力（受診・処置・傷病名）から、レセプト電算ファイル（UKE）と点検結果・摘要欄候補までを
 * 1関数で返す。サーバ・CLI・アプリはこの関数を共用する。
 */
import type { Diagnosis, Patient, Visit } from "../domain/types.js";
import { commentCandidates, isValidDisease, type OfficialEngine } from "../billing/official-engine.js";
import { monthlyClaimToReceipt, type VisitClaim } from "./from-claim.js";
import { assembleUkeFile, type UkeFileInput } from "./build.js";
import { encodeUkeFile, serializeFile } from "./uke.js";
import { isSubmittable, validateUkeRecords, type ValidationIssue } from "./validate.js";
import type { ReceiptScheme } from "./receipt-type.js";

export interface ProcessVisit {
  /** 受診日 YYYY-MM-DD */
  date: string;
  visitType: "first" | "followup";
  /** 算定する診療行為コード（9桁）の列 */
  procedureCodes: string[];
}

export interface ProcessReceiptInput {
  facility: UkeFileInput["facility"];
  receiptNo?: number;
  patient: { birthDate: string; sex: "M" | "F" };
  name: string;
  kanaName?: string;
  chartNo?: string;
  scheme: ReceiptScheme;
  publicExpenseCount?: number;
  insurer: { insurerNo: string; symbol?: string; number: string };
  visits: ProcessVisit[];
  diagnoses: Diagnosis[];
}

export interface ProcessReceiptResult {
  /** UKE 全レコードのテキスト（改行は LF に正規化） */
  recordsText: string;
  /** UKE バイト列（Shift_JIS＋EOF）を base64 で（ダウンロード用） */
  ukeBase64: string;
  recordCount: number;
  byteLength: number;
  totalPoints: number;
  visitDays: number;
  validation: ValidationIssue[];
  submittable: boolean;
  /** 各診療行為コードに紐づく別表Ⅰ摘要欄コメント候補 */
  commentCandidates: { procedureCode: string; commentCode: string; displayText: string; recordingNote: string }[];
}

/** カルテ入力から、算定・UKE生成・点検までを一気通貫で処理する */
export function processReceipt(loaded: OfficialEngine, input: ProcessReceiptInput): ProcessReceiptResult {
  if (input.visits.length === 0) throw new Error("受診（visits）が空です");
  const patient: Patient = { id: "rx", birthDate: input.patient.birthDate, sex: input.patient.sex };

  const visitClaims: VisitClaim[] = [];
  for (const v of input.visits) {
    const visit: Visit = { id: `v-${v.date}`, patientId: patient.id, visitDate: v.date, visitType: v.visitType };
    const result = loaded.engine.calculate({
      patient,
      visit,
      procedures: v.procedureCodes.map((procedureCode) => ({ procedureCode, quantity: 1 })),
      diagnoses: input.diagnoses,
      history: {
        countInMonth: (code) =>
          visitClaims.reduce((n, vc) => n + vc.result.lines.filter((l) => l.procedureCode === code).reduce((m, l) => m + l.quantity, 0), 0),
      },
      facility: { has: () => false },
      master: loaded.master,
    });
    visitClaims.push({ visit, result });
  }

  const receipt = monthlyClaimToReceipt({
    patient,
    visits: visitClaims,
    diagnoses: input.diagnoses,
    receiptNo: input.receiptNo ?? 1,
    scheme: input.scheme,
    ...(input.publicExpenseCount !== undefined ? { publicExpenseCount: input.publicExpenseCount } : {}),
    name: input.name,
    ...(input.kanaName !== undefined ? { kanaName: input.kanaName } : {}),
    ...(input.chartNo !== undefined ? { chartNo: input.chartNo } : {}),
    insurer: input.insurer,
  });

  const records = assembleUkeFile({ facility: input.facility, receipts: [receipt] });
  const validation = validateUkeRecords(records, { isKnownDiseaseCode: (c) => isValidDisease(loaded, c) });
  const bytes = encodeUkeFile(records);
  const totalPoints = visitClaims.reduce((s, vc) => s + vc.result.totalPoints, 0);
  const visitDays = new Set(input.visits.map((v) => v.date)).size;

  const allCodes = [...new Set(input.visits.flatMap((v) => v.procedureCodes))];
  const candidates = allCodes.flatMap((code) =>
    commentCandidates(loaded, code).map((e) => ({ procedureCode: code, commentCode: e.commentCode, displayText: e.displayText, recordingNote: e.recordingNote })),
  );

  return {
    recordsText: serializeFile(records).replace(/\r\n/g, "\n"),
    ukeBase64: Buffer.from(bytes).toString("base64"),
    recordCount: records.length,
    byteLength: bytes.length,
    totalPoints,
    visitDays,
    validation,
    submittable: isSubmittable(validation),
    commentCandidates: candidates,
  };
}
