/**
 * 会計出力（領収証・診療明細書）のデータ生成。
 *
 * 領収証（別紙様式2・歯科）は歯科点数表の「部」単位の費用区分で点数内訳を表示する。
 * 各診療行為の費用区分は、告示番号の区分アルファベット（A=初再診/B=医学管理/D=検査/E=画像/
 * I=処置/J=手術/K=麻酔/M=歯冠補綴/N=矯正 等）から決まる（print-forms.txt §2.2 準拠）。
 * 診療明細書（別紙様式5）は個別の診療行為名・点数・回数を表示する。
 *
 * 出典: 厚労省 保発0305第18号（令和8年6月施行）別紙様式2/5、歯科点数表の部構成。
 */
import type { ClaimLine } from "./engine.js";

/** 別紙様式2（歯科領収証）の費用区分 */
export type CostCategory =
  | "初・再診料"
  | "医学管理等"
  | "在宅医療"
  | "検査"
  | "画像診断"
  | "投薬"
  | "注射"
  | "リハビリテーション"
  | "処置"
  | "手術"
  | "麻酔"
  | "放射線治療"
  | "歯冠修復及び欠損補綴"
  | "歯科矯正"
  | "病理診断"
  | "その他";

/** 告示番号の区分アルファベット → 費用区分（歯科点数表の部構成） */
const LETTER_TO_CATEGORY: Record<string, CostCategory> = {
  A: "初・再診料",
  B: "医学管理等",
  C: "在宅医療",
  D: "検査",
  E: "画像診断",
  F: "投薬",
  G: "注射",
  H: "リハビリテーション",
  I: "処置",
  J: "手術",
  K: "麻酔",
  L: "放射線治療",
  M: "歯冠修復及び欠損補綴",
  N: "歯科矯正",
};

/** 費用区分の表示順（別紙様式2の並び） */
export const COST_CATEGORY_ORDER: CostCategory[] = [
  "初・再診料",
  "医学管理等",
  "在宅医療",
  "検査",
  "画像診断",
  "投薬",
  "注射",
  "リハビリテーション",
  "処置",
  "手術",
  "麻酔",
  "放射線治療",
  "歯冠修復及び欠損補綴",
  "歯科矯正",
  "病理診断",
  "その他",
];

/** 診療行為コード → 費用区分（codeToKubun の区分アルファベットで判定） */
export function costCategoryOf(procedureCode: string, codeToKubun: Map<string, string>): CostCategory {
  const kubun = codeToKubun.get(procedureCode);
  if (kubun === undefined || kubun.length === 0) return "その他";
  return LETTER_TO_CATEGORY[kubun[0]!] ?? "その他";
}

export interface CostCategorySummary {
  category: CostCategory;
  points: number;
}

export interface DetailLine {
  procedureCode: string;
  name: string;
  points: number;
  quantity: number;
  category: CostCategory;
}

export interface AccountingResult {
  /** 領収証用: 費用区分別の点数（0の区分は除く、別紙様式2の順） */
  byCategory: CostCategorySummary[];
  /** 明細書用: 個別項目（診療行為名・点数・回数） */
  detail: DetailLine[];
  /** 総点数 */
  totalPoints: number;
}

/**
 * 算定行（ClaimLine[]）から、領収証の費用区分別集計と明細書の個別明細を作る。
 * 点数は ClaimLine.points × quantity を区分ごとに合算する。
 */
export function buildAccounting(lines: readonly ClaimLine[], codeToKubun: Map<string, string>): AccountingResult {
  const byCat = new Map<CostCategory, number>();
  const detail: DetailLine[] = [];
  let totalPoints = 0;
  for (const l of lines) {
    const category = costCategoryOf(l.procedureCode, codeToKubun);
    const linePoints = l.points * l.quantity;
    byCat.set(category, (byCat.get(category) ?? 0) + linePoints);
    totalPoints += linePoints;
    detail.push({ procedureCode: l.procedureCode, name: l.name, points: l.points, quantity: l.quantity, category });
  }
  const byCategory = COST_CATEGORY_ORDER.filter((c) => (byCat.get(c) ?? 0) !== 0).map((category) => ({ category, points: byCat.get(category)! }));
  return { byCategory, detail, totalPoints };
}
