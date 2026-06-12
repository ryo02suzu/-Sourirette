/**
 * 歯式（部位）ドメインモデル。
 *
 * 内部表現は FDI（ISO 3950）2桁表記に統一する:
 *   永久歯: 11–18(右上) 21–28(左上) 31–38(左下) 41–48(右下)
 *   乳歯:   51–55(右上) 61–65(左上) 71–75(左下) 81–85(右下)
 * 表示は日本式（「右上6」等）に変換し、レセ電算の部位コードへは出力層で変換する。
 */

export type Jaw = "upper" | "lower";
export type Side = "right" | "left";

export interface Tooth {
  /** FDI 2桁表記（例: "16", "55"） */
  readonly fdi: string;
  readonly jaw: Jaw;
  readonly side: Side;
  /** 正中からの位置。永久歯 1–8 / 乳歯 1–5 */
  readonly position: number;
  readonly deciduous: boolean;
}

const QUADRANTS: Record<string, { jaw: Jaw; side: Side; deciduous: boolean }> = {
  "1": { jaw: "upper", side: "right", deciduous: false },
  "2": { jaw: "upper", side: "left", deciduous: false },
  "3": { jaw: "lower", side: "left", deciduous: false },
  "4": { jaw: "lower", side: "right", deciduous: false },
  "5": { jaw: "upper", side: "right", deciduous: true },
  "6": { jaw: "upper", side: "left", deciduous: true },
  "7": { jaw: "lower", side: "left", deciduous: true },
  "8": { jaw: "lower", side: "right", deciduous: true },
};

/** FDI 表記を検証して Tooth に変換する。不正な表記は Error を投げる。 */
export function parseTooth(fdi: string): Tooth {
  if (!/^[1-8][1-8]$/.test(fdi)) {
    throw new Error(`invalid FDI tooth notation: ${fdi}`);
  }
  const quadrant = QUADRANTS[fdi[0]!]!;
  const position = Number(fdi[1]);
  const maxPosition = quadrant.deciduous ? 5 : 8;
  if (position > maxPosition) {
    throw new Error(`invalid FDI tooth notation: ${fdi}`);
  }
  return { fdi, position, ...quadrant };
}

export function isValidTooth(fdi: string): boolean {
  try {
    parseTooth(fdi);
    return true;
  } catch {
    return false;
  }
}

/** 乳歯の位置の日本式表記は A–E */
const DECIDUOUS_LETTERS = ["A", "B", "C", "D", "E"] as const;

/** 日本式表記（例: "16" → "右上6"、"55" → "右上E"） */
export function toJapaneseNotation(tooth: Tooth): string {
  const side = tooth.side === "right" ? "右" : "左";
  const jaw = tooth.jaw === "upper" ? "上" : "下";
  const pos = tooth.deciduous ? DECIDUOUS_LETTERS[tooth.position - 1]! : String(tooth.position);
  return `${side}${jaw}${pos}`;
}

/** 同一顎・同一側か（ブリッジ・連続処置の部位整合チェックに使用） */
export function sameQuadrant(a: Tooth, b: Tooth): boolean {
  return a.jaw === b.jaw && a.side === b.side;
}
