/**
 * 製品API: 1患者・1ヶ月分の入力 → 算定 → UKE生成 → 提出前点検 を一気通貫で処理する。
 *
 * 公式エンジン工場（loadOfficialEngine）で構成した実点数・公式ルール付きエンジンを使い、
 * カルテ入力（受診・処置・傷病名）から、レセプト電算ファイル（UKE）と点検結果・摘要欄候補までを
 * 1関数で返す。サーバ・CLI・アプリはこの関数を共用する。
 */
import type { Diagnosis, Patient, Visit } from "../domain/types.js";
import type { ClaimLine } from "../billing/engine.js";
import { commentCandidates, isValidDisease, type OfficialEngine } from "../billing/official-engine.js";
import { buildAccounting, type AccountingResult } from "../billing/accounting.js";
import { calculateCopayment, type CopaymentResult, type IncomeOver70, type IncomeUnder70 } from "../billing/copayment.js";
import { monthlyClaimToReceipt, type VisitClaim } from "./from-claim.js";
import { assembleUkeFile, type UkeFileInput, type UkeReceipt } from "./build.js";
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

/** 1レセプト（1患者・1ヶ月）の入力（施設情報を除く） */
export interface ReceiptCoreInput {
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

export interface ProcessReceiptInput extends ReceiptCoreInput {
  facility: UkeFileInput["facility"];
  /** 窓口会計（負担割合・所得区分）を計算する場合に指定 */
  copay?: { copayRatio: number; category: IncomeUnder70 | IncomeOver70; isMultiple?: boolean; applyCapAtWindow?: boolean };
}

/** 1レセプト分の UkeReceipt を算定して組み立てる（バッチ・単票で共用） */
export function buildUkeReceipt(loaded: OfficialEngine, input: ReceiptCoreInput): { receipt: UkeReceipt; totalPoints: number; visitDays: number; lines: ClaimLine[] } {
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

  const totalPoints = visitClaims.reduce((s, vc) => s + vc.result.totalPoints, 0);
  const visitDays = new Set(input.visits.map((v) => v.date)).size;
  const lines = visitClaims.flatMap((vc) => vc.result.lines);
  return { receipt, totalPoints, visitDays, lines };
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
  /** 会計: 領収証の費用区分別集計＋明細書の個別明細 */
  accounting: AccountingResult;
  /** 窓口会計（input.copay 指定時のみ） */
  copayment?: CopaymentResult;
}

/** カルテ入力から、算定・UKE生成・点検までを一気通貫で処理する（単票） */
export function processReceipt(loaded: OfficialEngine, input: ProcessReceiptInput): ProcessReceiptResult {
  const { receipt, totalPoints, visitDays, lines } = buildUkeReceipt(loaded, input);
  const records = assembleUkeFile({ facility: input.facility, receipts: [receipt] });
  const validation = validateUkeRecords(records, { isKnownDiseaseCode: (c) => isValidDisease(loaded, c) });
  const bytes = encodeUkeFile(records);

  const accounting = buildAccounting(lines, loaded.codeToKubun);
  let copayment: CopaymentResult | undefined;
  if (input.copay !== undefined) {
    copayment = calculateCopayment({
      totalPoints,
      birthDate: input.patient.birthDate,
      copayRatio: input.copay.copayRatio,
      category: input.copay.category,
      onDate: input.visits[0]!.date,
      ...(input.copay.isMultiple !== undefined ? { isMultiple: input.copay.isMultiple } : {}),
      ...(input.copay.applyCapAtWindow !== undefined ? { applyCapAtWindow: input.copay.applyCapAtWindow } : {}),
    });
  }

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
    accounting,
    ...(copayment !== undefined ? { copayment } : {}),
  };
}
