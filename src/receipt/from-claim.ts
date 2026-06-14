/**
 * 算定エンジンの出力（CalculationResult）→ UKE レセプト（RE/HO/HS/SS）への変換橋渡し。
 *
 * 役割分担:
 *   - 点数・回数・コードは算定エンジン（src/billing）が確定したものをそのまま転記する。
 *   - レセプト種別・負担区分は patient/保険情報から determine*（別表6/21）で決定。
 *   - 歯式（部位）は傷病名部位レコード（HS）側に記録する。歯科診療行為レコード（SS）には
 *     歯式項目が存在しないため、ClaimLine.teeth は SS には出力しない（記録条件仕様準拠）。
 *
 * 対応範囲:
 *   - monthlyClaimToReceipt: 月内の複数受診を1レセプトに集約する（本来の月次レセプト）。
 *     同一の診療行為（コード・診療識別・加算・点数が一致）を算定日情報にマージし、回数を
 *     合算する（記録条件仕様: 算定日情報の合計＝回数）。診療実日数は受診日数で算出。
 *   - claimToReceipt: 1受診分の薄いラッパー（単一受診のデモ・テスト用）。
 *
 * 既知の簡略化: SS の点数フィールドは ClaimLine.points（診療行為マスタの点数）をそのまま
 * 記録する。同一レコードに加算を含める場合の点数は本来「診療行為＋加算の合算」だが、
 * 加算の点数はデモのルールでは未計算のため、加算点数を含める運用は呼び出し側で point を
 * 合算済みにすること（合計点数の内部整合: Σ(点数×回数)=totalPoints は保たれる）。
 */
import type { CalculationResult, ClaimLine } from "../billing/engine.js";
import type { Diagnosis, Patient, Visit } from "../domain/types.js";
import { fdiToShikiCode, type ToothCondition } from "../domain/tooth-code.js";
import { buildHo, buildHs, buildSs, buildRe, type HsParams, type ReParams, type SsParams } from "./records.js";
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

/** 1受診分の算定結果 */
export interface VisitClaim {
  visit: Visit;
  result: CalculationResult;
}

export interface MonthlyReceiptInput {
  patient: Patient;
  /** 月内の受診（同一診療月であること）。1以上 */
  visits: VisitClaim[];
  /** 当月の傷病名（重複は集約）。1以上必要 */
  diagnoses: Diagnosis[];
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
  /**
   * 各 ClaimLine に適用する負担区分（別表21）。省略時は保険枠から決定。
   * 公費の按分が行ごとに異なる場合は呼び出し側で行ごとに指定する。
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

/** 同一の算定単位（マージ可能）かを表すキー */
function lineKey(line: ClaimLine): string {
  const additions = (line.additions ?? []).map((a) => `${a.code}:${a.quantity ?? ""}`).join("|");
  return [line.procedureCode, line.category ?? "", line.points, additions].join("#");
}

interface MergedLine {
  line: ClaimLine;
  /** 日（1〜31）→ 当日の回数 */
  daily: Map<number, number>;
}

/**
 * 月内の全受診の ClaimLine を同一算定単位ごとにマージする。
 * 同一コード・診療識別・加算・点数の行は1つの SS にまとめ、受診日ごとに算定日情報を積む。
 */
function mergeMonthlyLines(visits: readonly VisitClaim[]): MergedLine[] {
  const merged = new Map<string, MergedLine>();
  const order: string[] = [];
  for (const { visit, result } of visits) {
    const day = dayOfMonth(visit.visitDate);
    for (const line of result.lines) {
      const key = lineKey(line);
      let entry = merged.get(key);
      if (entry === undefined) {
        entry = { line, daily: new Map() };
        merged.set(key, entry);
        order.push(key);
      }
      entry.daily.set(day, (entry.daily.get(day) ?? 0) + line.quantity);
    }
  }
  return order.map((k) => merged.get(k)!);
}

/** マージ済みの行 → SS レコード。omitCategory=true で 診療識別 を省略する（同一識別の2件目以降） */
function mergedLineToSs(entry: MergedLine, burden: string, omitCategory = false): UkeRecord {
  const daily: Record<number, number> = {};
  let count = 0;
  for (const [day, n] of entry.daily) {
    daily[day] = n;
    count += n;
  }
  const params: SsParams = {
    burden,
    code: entry.line.procedureCode,
    points: entry.line.points,
    count,
    daily,
  };
  if (!omitCategory && entry.line.category !== undefined) params.category = entry.line.category;
  if (entry.line.additions && entry.line.additions.length > 0) {
    params.additions = entry.line.additions.map((a) =>
      a.quantity !== undefined ? { code: a.code, quantity: a.quantity } : { code: a.code },
    );
  }
  return buildSs(params);
}

/**
 * マージ済み行を SS レコード列へ。記録条件仕様に従い:
 *   - 診療識別（別表20）の昇順に並べてグループ化する。
 *   - 各診療識別グループの先頭行のみ 診療識別 を記録し、2件目以降は省略する。
 * これにより 初診料 と その乳幼児/時間外加算 のような同一識別の行で 診療識別 が重複しない。
 */
function buildDetailRecords(merged: readonly MergedLine[], burden: string): UkeRecord[] {
  const sorted = [...merged].sort((a, b) => Number(a.line.category ?? 0) - Number(b.line.category ?? 0));
  const seen = new Set<string>();
  return sorted.map((entry) => {
    const cat = entry.line.category ?? "";
    const omit = cat !== "" && seen.has(cat);
    if (cat !== "") seen.add(cat);
    return mergedLineToSs(entry, burden, omit);
  });
}

/** 傷病名を傷病名コード＋部位＋修飾語で重複排除する */
function dedupDiagnoses(diagnoses: readonly Diagnosis[]): Diagnosis[] {
  const seen = new Set<string>();
  const out: Diagnosis[] = [];
  for (const dx of diagnoses) {
    const key = [dx.diseaseCode, (dx.teeth ?? []).join(","), (dx.modifierCodes ?? []).join(",")].join("#");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dx);
  }
  return out;
}

/**
 * 月内の複数受診を1枚のレセプト（IR を除く RE〜SS）に集約する。
 * 合計点数は各受診の totalPoints の総和、診療実日数は受診日数。
 */
export function monthlyClaimToReceipt(input: MonthlyReceiptInput): UkeReceipt {
  if (input.visits.length === 0) throw new Error("受診（visits）は1件以上必要です");
  const months = new Set(input.visits.map((v) => v.visit.visitDate.slice(0, 7)));
  if (months.size > 1) {
    throw new Error(`1レセプトは同一診療月の受診のみ（混在: ${[...months].join(", ")}）`);
  }
  const month = [...months][0]!; // YYYY-MM
  const pub = input.publicExpenseCount ?? 0;
  const burden = input.burden ?? defaultBurden(input.scheme, pub);
  const toothCondition = input.toothCondition ?? "present";

  const diagnoses = dedupDiagnoses(input.diagnoses);
  if (diagnoses.length === 0) {
    throw new Error("レセプトには傷病名部位レコード（HS）が1以上必要です。傷病名を登録してください");
  }

  // 診療実日数は「実際に算定行が生じた日」で数える。算定行ゼロの受診（処置未入力・
  // 全行が包括除外 等）は 算定日情報に現れないため、診療実日数にも含めない（審査整合）。
  const distinctDays = new Set(input.visits.filter((v) => v.result.lines.length > 0).map((v) => v.visit.visitDate)).size;
  const totalPoints = input.visits.reduce((sum, v) => sum + v.result.totalPoints, 0);

  const receiptType = determineReceiptType({
    scheme: input.scheme,
    publicExpenseCount: pub,
    admission: false, // 歯科の一次請求デモは入院外
  });

  const earliestOnset = diagnoses.reduce((min, d) => (d.onsetDate < min ? d.onsetDate : min), diagnoses[0]!.onsetDate);
  const reParams: ReParams = {
    receiptNo: input.receiptNo,
    receiptType,
    treatmentMonth: month.replace("-", ""),
    name: input.name,
    sex: sexCode(input.patient.sex),
    birthDate: compactDate(input.patient.birthDate),
    treatmentStartDate: compactDate(earliestOnset),
    outcome: "1",
  };
  if (input.chartNo !== undefined) reParams.chartNo = input.chartNo;
  if (input.kanaName !== undefined) reParams.kanaName = input.kanaName;
  const re = buildRe(reParams);

  const ho = buildHo({
    insurerNo: input.insurer.insurerNo,
    ...(input.insurer.symbol !== undefined ? { symbol: input.insurer.symbol } : {}),
    number: input.insurer.number,
    actualDays: distinctDays,
    totalPoints,
  });

  const hs = diagnoses.map((dx) => diagnosisToHs(dx, toothCondition));

  const details = buildDetailRecords(mergeMonthlyLines(input.visits), burden);
  if (details.length === 0) {
    throw new Error("算定結果が空です（SS等の診療行為レコードが1以上必要）");
  }

  return { re, ho, hs, details };
}

// ---- 単一受診のラッパー（既存テスト・デモ互換） ----

export interface ClaimReceiptInput {
  patient: Patient;
  visit: Visit;
  diagnoses: Diagnosis[];
  result: CalculationResult;
  receiptNo: number;
  scheme: ReceiptScheme;
  publicExpenseCount?: number;
  name: string;
  kanaName?: string;
  chartNo?: string;
  insurer: { insurerNo: string; symbol?: string; number: string };
  /** 診療実日数（省略時は1） */
  actualDays?: number;
  burden?: string;
  toothCondition?: ToothCondition;
}

/** 1受診分の算定結果から UKE レセプトを構築する（monthlyClaimToReceipt の単一受診版）。 */
export function claimToReceipt(input: ClaimReceiptInput): UkeReceipt {
  const monthlyInput: MonthlyReceiptInput = {
    patient: input.patient,
    visits: [{ visit: input.visit, result: input.result }],
    diagnoses: input.diagnoses,
    receiptNo: input.receiptNo,
    scheme: input.scheme,
    name: input.name,
    insurer: input.insurer,
  };
  if (input.publicExpenseCount !== undefined) monthlyInput.publicExpenseCount = input.publicExpenseCount;
  if (input.kanaName !== undefined) monthlyInput.kanaName = input.kanaName;
  if (input.chartNo !== undefined) monthlyInput.chartNo = input.chartNo;
  if (input.burden !== undefined) monthlyInput.burden = input.burden;
  if (input.toothCondition !== undefined) monthlyInput.toothCondition = input.toothCondition;
  const receipt = monthlyClaimToReceipt(monthlyInput);
  // 単一受診で actualDays を明示指定したい場合は HO を作り直す
  if (input.actualDays !== undefined && receipt.ho !== undefined) {
    receipt.ho = buildHo({
      insurerNo: input.insurer.insurerNo,
      ...(input.insurer.symbol !== undefined ? { symbol: input.insurer.symbol } : {}),
      number: input.insurer.number,
      actualDays: input.actualDays,
      totalPoints: input.result.totalPoints,
    });
  }
  return receipt;
}
