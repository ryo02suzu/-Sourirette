/**
 * FDI 表記 → レセ電算 歯式コード（6桁）変換。
 *
 * 構造（歯式マスタ f_20260306.csv で裏取り済み・verification-log 追記12参照）:
 *   歯式コード = 歯種4桁 ＋ 状態1桁 ＋ 部分1桁
 *   歯種4桁 = "10" + FDI 2桁（例: FDI 11 → 1011, FDI 26 → 1026, 乳歯 81 → 1081）
 *     ※ 右側上顎中切歯=101100 / 左側上顎第１大臼歯=102600 / 右側下顎第３大臼歯=104800 /
 *       右側上顎第２乳臼歯=105500 / 右側下顎乳中切歯=108100 で実マスタと一致確認
 *   状態: 0=現存歯 1=部 2=欠損歯 3=支台歯 5=便宜抜髄支台歯 6=残根 （歯式マスタ名称より）
 *   部分: 0=指定なし（近遠心等の部分指定は歯式マスタの当該コードに従う）
 */
import { parseTooth } from "./tooth.js";

export type ToothCondition = "present" | "part" | "missing" | "abutment" | "devital-abutment" | "root";

const CONDITION_DIGIT: Record<ToothCondition, string> = {
  present: "0",
  part: "1",
  missing: "2",
  abutment: "3",
  "devital-abutment": "5",
  root: "6",
};

/** FDI（例 "16"）→ 歯式コード6桁（例 "101600"） */
export function fdiToShikiCode(fdi: string, condition: ToothCondition = "present", partDigit = "0"): string {
  parseTooth(fdi); // 検証（不正なら throw）
  if (!/^[0-9]$/.test(partDigit)) throw new Error(`invalid part digit: ${partDigit}`);
  return `10${fdi}${CONDITION_DIGIT[condition]}${partDigit}`;
}

/** 口腔全体（部位指定なしの病名等で使用） */
export const SHIKI_WHOLE_MOUTH = "100000";
/** 上顎歯列 / 下顎歯列 */
export const SHIKI_UPPER_ARCH = "100100";
export const SHIKI_LOWER_ARCH = "100200";
