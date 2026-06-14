/**
 * バッチ処理: 1ヶ月分の全患者カルテ入力 → 全レセプトを算定 → 医院単位の1ファイル
 * （RECEIPTS.UKE）を生成し、提出前自己点検まで自動で行う。
 *
 * 「PC上で最後まで自動化」の中核。入力JSON（施設＋全レセプト）を渡すと、
 * 各レセプトを実点数で算定し、UK→各レセプト→GO の1ファイルに組み上げて返す。
 * ⚠️ 実提出（オンライン請求）は支払基金システム側（閉域網・証明書）でコード外。
 */
import { assembleUkeFile, type UkeFileInput } from "./build.js";
import { encodeUkeFile, serializeFile } from "./uke.js";
import { isSubmittable, validateUkeRecords, type ValidationIssue } from "./validate.js";
import { isValidDisease, type OfficialEngine } from "../billing/official-engine.js";
import type { CalculationIssue } from "../billing/engine.js";
import { buildUkeReceipt, type ReceiptCoreInput } from "./process.js";

export interface BatchInput {
  facility: UkeFileInput["facility"];
  receipts: ReceiptCoreInput[];
}

export interface BatchReceiptReport {
  receiptNo: number;
  name: string;
  totalPoints: number;
  visitDays: number;
  /** 算定エンジンの指摘（回数・背反・包括・部位・不正コード） */
  algorithmIssues: CalculationIssue[];
}

export interface BatchResult {
  /** UKE 全レコードのテキスト（改行 LF 正規化） */
  recordsText: string;
  /** Shift_JIS＋EOF のバイト列 */
  bytes: Uint8Array;
  recordCount: number;
  byteLength: number;
  /** レセプト件数（GO 総件数と一致） */
  receiptCount: number;
  /** 総合計点数（主保険分） */
  grandTotalPoints: number;
  perReceipt: BatchReceiptReport[];
  validation: ValidationIssue[];
  submittable: boolean;
}

/** 1ヶ月分の全レセプトを算定し、医院単位の RECEIPTS.UKE を組み上げる */
export function processBatch(loaded: OfficialEngine, input: BatchInput): BatchResult {
  if (input.receipts.length === 0) throw new Error("レセプト（receipts）が空です");

  const perReceipt: BatchReceiptReport[] = [];
  const built = input.receipts.map((r, i) => {
    const receiptNo = r.receiptNo ?? i + 1;
    const { receipt, totalPoints, visitDays, issues } = buildUkeReceipt(loaded, { ...r, receiptNo });
    perReceipt.push({ receiptNo, name: r.name, totalPoints, visitDays, algorithmIssues: issues });
    return receipt;
  });

  const records = assembleUkeFile({ facility: input.facility, receipts: built });
  const validation = validateUkeRecords(records, { isKnownDiseaseCode: (c) => isValidDisease(loaded, c) });
  const bytes = encodeUkeFile(records);

  // GO（最終レコード）の総件数・総合計点数
  const go = records[records.length - 1]!;
  const receiptCount = Number(go.fields[0] ?? 0) || 0;
  const grandTotalPoints = Number(go.fields[1] ?? 0) || 0;

  return {
    recordsText: serializeFile(records).replace(/\r\n/g, "\n"),
    bytes,
    recordCount: records.length,
    byteLength: bytes.length,
    receiptCount,
    grandTotalPoints,
    perReceipt,
    validation,
    submittable: isSubmittable(validation),
  };
}
