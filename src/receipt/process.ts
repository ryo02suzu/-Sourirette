/**
 * 製品API: 1患者・1ヶ月分の入力 → 算定 → UKE生成 → 提出前点検 を一気通貫で処理する。
 *
 * 公式エンジン工場（loadOfficialEngine）で構成した実点数・公式ルール付きエンジンを使い、
 * カルテ入力（受診・処置・傷病名）から、レセプト電算ファイル（UKE）と点検結果・摘要欄候補までを
 * 1関数で返す。サーバ・CLI・アプリはこの関数を共用する。
 */
import type { Diagnosis, Patient, Visit } from "../domain/types.js";
import type { ClaimLine, CalculationIssue } from "../billing/engine.js";
import { commentCandidates, computeAlerts, isValidDisease, missedChargeHints, type OfficialEngine } from "../billing/official-engine.js";
import { ageAt } from "../domain/types.js";
import type { Alert } from "../alerts/types.js";
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
  /** 届出済みの施設基準コード（besshi5_code）。施設基準アラート用 */
  notifiedStandards?: string[];
  /** 既読（承認済み）アラートの contextKey。一致するアラートは抑制 */
  acknowledgedAlerts?: string[];
}

/** 入力の必須項目を検証し、欠落時は分かりやすいエラーにする */
function validateCoreInput(input: ReceiptCoreInput): void {
  if (input.patient === undefined || typeof input.patient.birthDate !== "string" || (input.patient.sex !== "M" && input.patient.sex !== "F")) {
    throw new Error("patient（birthDate, sex=M/F）は必須です");
  }
  if (typeof input.name !== "string" || input.name === "") throw new Error("name（氏名）は必須です");
  if (input.scheme === undefined) throw new Error("scheme（保険枠）は必須です");
  if (input.insurer === undefined || typeof input.insurer.insurerNo !== "string" || typeof input.insurer.number !== "string") {
    throw new Error("insurer（insurerNo, number）は必須です");
  }
  if (!Array.isArray(input.visits) || input.visits.length === 0) throw new Error("受診（visits）は1件以上必要です");
  for (const v of input.visits) {
    if (typeof v.date !== "string" || (v.visitType !== "first" && v.visitType !== "followup") || !Array.isArray(v.procedureCodes)) {
      throw new Error(`visit の形式が不正です（date, visitType=first/followup, procedureCodes[]）: ${JSON.stringify(v).slice(0, 80)}`);
    }
  }
  if (!Array.isArray(input.diagnoses) || input.diagnoses.length === 0) throw new Error("diagnoses（傷病名）は1件以上必要です");
}

/** 1レセプト分の UkeReceipt を算定して組み立てる（バッチ・単票で共用） */
export function buildUkeReceipt(loaded: OfficialEngine, input: ReceiptCoreInput): { receipt: UkeReceipt; totalPoints: number; visitDays: number; lines: ClaimLine[]; issues: CalculationIssue[] } {
  validateCoreInput(input);
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
  const issues = visitClaims.flatMap((vc) => vc.result.issues);
  return { receipt, totalPoints, visitDays, lines, issues };
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
  /** 算定エンジンの指摘（回数・背反・包括・部位・不正コード等のルール発火） */
  algorithmIssues: CalculationIssue[];
  /** 各診療行為コードに紐づく別表Ⅰ摘要欄コメント候補 */
  commentCandidates: { procedureCode: string; commentCode: string; displayText: string; recordingNote: string }[];
  /** 算定もれ提示: 該当すれば算定できる加算/通則のヒント（取り漏れ防止） */
  missedChargeHints: { procedureCode: string; type: string; condition: string; value: string; source: string }[];
  /** 算定支援アラート（error/warning/proposal。ブロックしない・上書き可・既読学習対応） */
  alerts: Alert[];
  /** 会計: 領収証の費用区分別集計＋明細書の個別明細 */
  accounting: AccountingResult;
  /** 窓口会計（input.copay 指定時のみ） */
  copayment?: CopaymentResult;
}

/** カルテ入力から、算定・UKE生成・点検までを一気通貫で処理する（単票） */
export function processReceipt(loaded: OfficialEngine, input: ProcessReceiptInput): ProcessReceiptResult {
  const { receipt, totalPoints, visitDays, lines, issues: algorithmIssues } = buildUkeReceipt(loaded, input);
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

  // 算定支援アラート（患者年齢・届出・既読を反映）
  const patientAge = ageAt(input.patient.birthDate, input.visits[0]!.date);
  const alerts = computeAlerts(
    loaded,
    {
      procedureCodes: allCodes,
      diseaseCodes: input.diagnoses.map((d) => d.diseaseCode),
      patientAge,
      ...(input.notifiedStandards !== undefined ? { notifiedStandards: input.notifiedStandards } : {}),
    },
    input.acknowledgedAlerts !== undefined ? new Set(input.acknowledgedAlerts) : undefined,
  );
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
    algorithmIssues,
    commentCandidates: candidates,
    missedChargeHints: missedChargeHints(loaded, allCodes),
    alerts,
    accounting,
    ...(copayment !== undefined ? { copayment } : {}),
  };
}
