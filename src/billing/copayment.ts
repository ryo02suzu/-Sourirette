/**
 * 窓口負担と高額療養費（自己負担限度額）の計算。
 *
 * 出典: 健康保険法施行令の高額療養費 自己負担限度額（令和）。限度額はハードコードせず
 * 「適用期間付きの設定データ」として保持し、政令改正時は差し替える方針。
 *
 * 対象: 1医療機関・月単位の窓口負担（現物給付＝限度額適用認定証ありで限度額に達したら頭打ち）。
 * ⚠️ 世帯合算（複数医療機関・同一世帯）・70歳以上の外来個人上限（年間144,000円）は、
 *    この医院単独の計算では完結しないため入力（worldCount/外部集計）に委ねる範囲とする。
 */
import { ageAt } from "../domain/types.js";

/** 70歳未満の所得区分（標準報酬月額ベース） */
export type IncomeUnder70 = "ア" | "イ" | "ウ" | "エ" | "オ";
/** 70歳以上の所得区分 */
export type IncomeOver70 = "現役Ⅲ" | "現役Ⅱ" | "現役Ⅰ" | "一般" | "低所得Ⅱ" | "低所得Ⅰ";

interface FormulaLimit {
  /** 基準額（円） */
  base: number;
  /** 1%加算の閾値（総医療費からこの額を引いた分の1%）。0なら定額 */
  threshold: number;
  /** 多数回該当（直近12月で4回目以降）の限度額 */
  multiple: number;
}

/** 高額療養費 自己負担限度額テーブル（令和・健保法施行令）。適用期間: 2024-06-01〜 */
export const HIGH_COST_LIMITS_REIWA = {
  appliedFrom: "2024-06-01",
  under70: {
    ア: { base: 252600, threshold: 842000, multiple: 140100 },
    イ: { base: 167400, threshold: 558000, multiple: 93000 },
    ウ: { base: 80100, threshold: 267000, multiple: 44400 },
    エ: { base: 57600, threshold: 0, multiple: 44400 },
    オ: { base: 35400, threshold: 0, multiple: 24600 },
  } satisfies Record<IncomeUnder70, FormulaLimit>,
  // 70歳以上の世帯（外来＋入院）月限度額。現役並みは70歳未満ア/イ/ウと同式
  over70Household: {
    現役Ⅲ: { base: 252600, threshold: 842000, multiple: 140100 },
    現役Ⅱ: { base: 167400, threshold: 558000, multiple: 93000 },
    現役Ⅰ: { base: 80100, threshold: 267000, multiple: 44400 },
    一般: { base: 57600, threshold: 0, multiple: 44400 },
    低所得Ⅱ: { base: 24600, threshold: 0, multiple: 24600 },
    低所得Ⅰ: { base: 15000, threshold: 0, multiple: 15000 },
  } satisfies Record<IncomeOver70, FormulaLimit>,
} as const;

/** 月の自己負担限度額（世帯）を計算する */
function monthlyLimit(limit: FormulaLimit, grossMedicalCost: number, isMultiple: boolean): number {
  if (isMultiple) return limit.multiple;
  if (limit.threshold === 0) return limit.base;
  return limit.base + Math.max(0, grossMedicalCost - limit.threshold) * 0.01;
}

/** 10円未満四捨五入（一部負担金の端数処理） */
export function roundTo10Yen(amount: number): number {
  return Math.round(amount / 10) * 10;
}

export interface CopaymentInput {
  /** 当月・当院の総点数 */
  totalPoints: number;
  /** 患者の生年月日（ISO）。年齢から70歳以上/未満を判定 */
  birthDate: string;
  /** 負担割合（0.1/0.2/0.3） */
  copayRatio: number;
  /** 所得区分（70歳未満 or 70歳以上） */
  category: IncomeUnder70 | IncomeOver70;
  /** 当月の診療日（年齢判定の基準。既定は当日） */
  onDate?: string;
  /** 直近12月で高額療養費に4回以上該当（多数回該当） */
  isMultiple?: boolean;
  /** 限度額適用認定証あり等で窓口で限度額を適用する（現物給付）。既定 true */
  applyCapAtWindow?: boolean;
}

export interface CopaymentResult {
  /** 総医療費（円）= 総点数×10 */
  grossMedicalCost: number;
  /** 高額療養費適用前の窓口負担（10円丸め） */
  burdenBeforeCap: number;
  /** 月の自己負担限度額（円） */
  monthlyLimit: number;
  /** 実際の窓口負担（限度額で頭打ち） */
  windowBurden: number;
  /** 高額療養費（現物給付で窓口負担が減った額） */
  highCostBenefit: number;
}

const UNDER70 = new Set<string>(["ア", "イ", "ウ", "エ", "オ"]);

/**
 * 窓口負担と高額療養費を計算する。
 * 総医療費＝総点数×10、窓口負担＝総医療費×負担割合（10円丸め）。限度額認定証ありなら
 * 月の自己負担限度額で頭打ち（現物給付）、超過分が高額療養費。
 */
export function calculateCopayment(input: CopaymentInput): CopaymentResult {
  const onDate = input.onDate ?? new Date().toISOString().slice(0, 10);
  const age = ageAt(input.birthDate, onDate);
  const grossMedicalCost = input.totalPoints * 10;
  const burdenBeforeCap = roundTo10Yen(grossMedicalCost * input.copayRatio);

  const isUnder70 = UNDER70.has(input.category);
  if (isUnder70 !== (age < 70)) {
    throw new Error(`所得区分（${input.category}）と年齢（${age}歳）が不整合です`);
  }
  const formula = isUnder70
    ? HIGH_COST_LIMITS_REIWA.under70[input.category as IncomeUnder70]
    : HIGH_COST_LIMITS_REIWA.over70Household[input.category as IncomeOver70];

  const limit = monthlyLimit(formula, grossMedicalCost, input.isMultiple ?? false);
  const applyCap = input.applyCapAtWindow ?? true;
  const windowBurden = applyCap ? Math.min(burdenBeforeCap, limit) : burdenBeforeCap;

  return {
    grossMedicalCost,
    burdenBeforeCap,
    monthlyLimit: limit,
    windowBurden,
    highCostBenefit: burdenBeforeCap - windowBurden,
  };
}
