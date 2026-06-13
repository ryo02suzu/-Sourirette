/**
 * 算定エンジンの出力（CalculationResult）→ UKE レセプト（RE/HO/HS/SS）への変換橋渡し。
 *
 * 役割分担:
 *   - 点数・回数・コードは算定エンジン（src/billing）が確定したものをそのまま転記する。
 *   - レセプト種別・負担区分は patient/保険情報から determine*（別表6/21）で決定。
 *   - 歯式（部位）は傷病名部位レコード（HS）側に記録する。歯科診療行為レコード（SS）には
 *     歯式項目が存在しないため、ClaimLine.teeth は SS には出力しない（記録条件仕様準拠）。
 *
 * 対応範囲: 1受診（1日分）のレセプト生成。月内複数受診の集約（同一コードの算定日マージ・
 * 診療実日数の積み上げ）は呼び出し側の責務とする。
 */
import type { CalculationResult } from "../billing/engine.js";
import type { Diagnosis, Patient, Visit } from "../domain/types.js";
import { fdiToShikiCode, type ToothCondition } from "../domain/tooth-code.js";
import { buildHo, buildHs, buildRe, buildSs, type HsParams, type SsParams } from "./records.js";
import type { UkeRecord } from "./uke.js";
import type { UkeReceipt } from "./build.js";
import { determineBurden, determineReceiptType, sexCode, type PayerSet, type ReceiptScheme } from "./receipt-type.js";

/** YYYY-MM-DD → YYYYMMDD */
function compactDate(iso: string): string {
  return iso.replace(/-/g, "");
}

/** YYYY-MM-DD → 当月の日（1〜31） */
function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export interface ClaimReceiptInput {
  patient: Patient;
  visit: Visit;
  diagnoses: Diagnosis[];
  result: CalculationResult;
  /** レセプト記録順の番号（1から昇順） */
  receiptNo: number;
  /** レセプト種別の決定に使う保険枠（別表6） */
  scheme: ReceiptScheme;
  /** 併用公費の種数（0〜4）。レセプト種別の第3桁に反映 */
  publicExpenseCount?: number;
  /** 患者氏名（姓名間に1文字スペース） */
  name: string;
  /** 氏名フリガナ（全角カタカナ） */
  kanaName?: string;
  /** カルテ番号・患者ID（任意） */
  chartNo?: string;
  /** 保険者情報（HO レコード） */
  insurer: { insurerNo: string; symbol?: string; number: string };
  /** 診療実日数（このレセプトの受診日数）。省略時は1 */
  actualDays?: number;
  /**
   * 各 ClaimLine に適用する負担区分（別表21）。省略時は保険枠から決定
   * （医保/後期＝医保のみ、公費単独＝公費①のみ）。公費の按分が行ごとに異なる場合は
   * 呼び出し側で行ごとに指定する。
   */
  burden?: string;
  /** 傷病名部位の歯式に用いる状態コード（既定: 現存歯）。欠損症等は呼び出し側で指定 */
  toothCondition?: ToothCondition;
}

/** 保険枠から既定の負担区分を決める（単一管掌・全行共通の単純ケース） */
function defaultBurden(scheme: ReceiptScheme, publicExpenseCount: number): string {
  const payers: PayerSet =
    scheme.kind === "public-only"
      ? { medical: false, publicExpenses: [true] }
      : { medical: true, publicExpenses: Array.from({ length: publicExpenseCount }, () => true) };
  // 公費併用の按分は行単位で異なり得るが、既定は全管掌が当該行を負担する想定
  return determineBurden(payers);
}

/** 傷病名（Diagnosis）→ HS レコード */
export function diagnosisToHs(dx: Diagnosis, toothCondition: ToothCondition): UkeRecord {
  const params: HsParams = { diseaseCode: dx.diseaseCode };
  if (dx.teeth && dx.teeth.length > 0) {
    params.teeth = dx.teeth.map((fdi) => fdiToShikiCode(fdi, toothCondition));
  }
  if (dx.modifierCodes && dx.modifierCodes.length > 0) params.modifiers = dx.modifierCodes;
  return buildHs(params);
}

/** ClaimLine（1行＝1受診日）→ SS レコード */
export function claimLineToSs(
  line: CalculationResult["lines"][number],
  burden: string,
  day: number,
): UkeRecord {
  const params: SsParams = {
    burden,
    code: line.procedureCode,
    points: line.points,
    count: line.quantity,
    daily: { [day]: line.quantity },
  };
  if (line.category !== undefined) params.category = line.category;
  if (line.additions && line.additions.length > 0) {
    params.additions = line.additions.map((a) => (a.quantity !== undefined ? { code: a.code, quantity: a.quantity } : { code: a.code }));
  }
  return buildSs(params);
}

/**
 * 算定結果から1受診分の UKE レセプト（IR を除く RE〜SS）を構築する。
 * 合計点数は CalculationResult.totalPoints をそのまま保険者レコードに記録する。
 */
export function claimToReceipt(input: ClaimReceiptInput): UkeReceipt {
  const pub = input.publicExpenseCount ?? 0;
  const day = dayOfMonth(input.visit.visitDate);
  const burden = input.burden ?? defaultBurden(input.scheme, pub);
  const toothCondition = input.toothCondition ?? "present";
  const actualDays = input.actualDays ?? 1;

  const receiptType = determineReceiptType({
    scheme: input.scheme,
    publicExpenseCount: pub,
    admission: false, // 歯科の一次請求デモは入院外
  });

  const re = buildRe({
    receiptNo: input.receiptNo,
    receiptType,
    treatmentMonth: input.visit.visitDate.slice(0, 7).replace("-", ""),
    name: input.name,
    sex: sexCode(input.patient.sex),
    birthDate: compactDate(input.patient.birthDate),
    treatmentStartDate: input.diagnoses.length > 0
      ? compactDate(input.diagnoses.reduce((min, d) => (d.onsetDate < min ? d.onsetDate : min), input.diagnoses[0]!.onsetDate))
      : compactDate(input.visit.visitDate),
    outcome: "1",
    ...(input.chartNo !== undefined ? { chartNo: input.chartNo } : {}),
    ...(input.kanaName !== undefined ? { kanaName: input.kanaName } : {}),
  });

  const ho = buildHo({
    insurerNo: input.insurer.insurerNo,
    ...(input.insurer.symbol !== undefined ? { symbol: input.insurer.symbol } : {}),
    number: input.insurer.number,
    actualDays,
    totalPoints: input.result.totalPoints,
  });

  const hs = input.diagnoses.map((dx) => diagnosisToHs(dx, toothCondition));
  if (hs.length === 0) {
    throw new Error("レセプトには傷病名部位レコード（HS）が1以上必要です。傷病名を登録してください");
  }

  const details = input.result.lines.map((line) => claimLineToSs(line, burden, day));
  if (details.length === 0) {
    throw new Error("算定結果が空です（SS等の診療行為レコードが1以上必要）");
  }

  return { re, ho, hs, details };
}
