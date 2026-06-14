/**
 * 摘要欄 必須コメント（記載要領 別表Ⅰ（歯科））のローダー。
 *
 * 出典: 厚生労働省「診療報酬請求書等の記載要領」別表Ⅰ（歯科）令和8年版
 *   （保医発0327第2号・令和8年6月1日適用、0529訂正後 001707270.xlsx の歯科シートを
 *    CSV化したもの: data/masters/betsu1_shika_20260601.csv、UTF-8）。
 *
 * 内容: 区分（告示番号）ごとに、レセプト「摘要」欄へ記載すべきコメント（レセプト電算処理
 * システム用コード＝コメントコードと表示文言）を定める。返戻の最大要因の一つ（記載漏れ）対策。
 *
 * ⚠️ 記載事項には条件（「〜の場合」等のprose）が含まれるため、本ローダーはカタログ（参照表）
 *    として取り込む。常時必須の強制ルール化は条件解釈＋code→区分の対応が要るため別途
 *    （その際も誤検知回避のため warning とし、記載事項prose を歯科医師に提示して判断を仰ぐ）。
 */
import { parseCsvLine } from "./master-loader.js";

export interface Betsu1Entry {
  /** 区分（告示番号。例: "A000", "I008", "M015-2"）。正規化済み（半角・大文字） */
  kubun: string;
  /** 診療行為名称（フリガナ混じりの原文） */
  procedureName: string;
  /** 摘要欄への記載事項（条件を含むprose） */
  recordingNote: string;
  /**
   * レセプト電算用コメントコード（例: "820100300"）。
   * 「診療行為コード」「医薬品コード」「算定日情報」等の特殊指定はそのまま保持する。
   */
  commentCode: string;
  /** 当該コードによるレセプト表示文言 */
  displayText: string;
  /** 紙レセプトのみ記載 */
  paperOnly: boolean;
}

/** 区分（告示番号）を正規化する: 全角英数→半角・各種ハイフン→"-"・空白除去・大文字化 */
export function normalizeKubun(raw: string): string {
  return raw
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐-‒–—―−－]/g, "-")
    .replace(/[\s　]/g, "")
    .toUpperCase();
}

/** 別表Ⅰ（歯科）CSV（UTF-8・ヘッダ付き）をパースする */
export function parseBetsu1(utf8: string): Betsu1Entry[] {
  const entries: Betsu1Entry[] = [];
  const lines = utf8.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    const no = (f[0] ?? "").trim();
    if (!/^\d+$/.test(no)) continue; // ヘッダ・タイトル行をスキップ（項番が数字の行のみ）
    const commentCode = (f[4] ?? "").trim();
    if (commentCode === "") continue; // コメントコードのない注記行は対象外
    entries.push({
      kubun: normalizeKubun(f[1] ?? ""),
      procedureName: (f[2] ?? "").trim(),
      recordingNote: (f[3] ?? "").trim(),
      commentCode,
      displayText: (f[5] ?? "").trim(),
      paperOnly: (f[6] ?? "").trim() !== "",
    });
  }
  return entries;
}

/** 区分（告示番号）→ 別表Ⅰ エントリ一覧 の索引 */
export function indexByKubun(entries: readonly Betsu1Entry[]): Map<string, Betsu1Entry[]> {
  const map = new Map<string, Betsu1Entry[]>();
  for (const e of entries) {
    let arr = map.get(e.kubun);
    if (arr === undefined) map.set(e.kubun, (arr = []));
    arr.push(e);
  }
  return map;
}

/** 9桁 コメントコードのみを抽出（特殊指定「診療行為コード」等を除く） */
export function isNumericCommentCode(code: string): boolean {
  return /^\d{9}$/.test(code);
}

/**
 * 歯科診療行為マスタ（UTF-8）から 9桁コード → 区分（告示番号）の対応を作る。
 * 区分 = 区分アルファベット(列4) + 区分番号3桁(列5) + 枝番(列6, 00以外は "-n")。
 * 例: 301000110(初診料) → "A000" / CAD/CAM冠系 → "M015-2"。別表Ⅰの区分と突合できる。
 */
export function buildCodeToKubun(utf8: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    if ((f[1] ?? "") !== "H") continue;
    const code = f[2] ?? "";
    if (!/^\d{9}$/.test(code)) continue;
    const alpha = (f[3] ?? "").trim();
    if (alpha === "" || alpha === "0") continue;
    const num = (f[4] ?? "").trim();
    const eda = (f[5] ?? "").trim();
    let kubun = alpha + num;
    if (eda !== "" && eda !== "00") kubun += `-${Number(eda)}`;
    map.set(code, normalizeKubun(kubun));
  }
  return map;
}

/**
 * 区分（告示番号）→ その区分に属する9桁診療行為コード一覧 の索引。
 * 算定ルール調査DBの procedure_kubun（例 I005, J000）を実コードに展開するのに使う。
 */
export function buildKubunToCodes(utf8: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const codeToKubun = buildCodeToKubun(utf8);
  for (const [code, kubun] of codeToKubun) {
    let arr = map.get(kubun);
    if (arr === undefined) map.set(kubun, (arr = []));
    arr.push(code);
  }
  return map;
}

/**
 * 区分（例 "I005"）に対応する9桁コードを返す。完全一致＋枝番付き（"I005-2"等）も含める。
 * 調査DBの区分が "I000/I001" のように複数指定の場合は呼び出し側で分割して渡す。
 */
export function codesForKubun(kubun: string, index: Map<string, string[]>): string[] {
  const k = normalizeKubun(kubun);
  const out: string[] = [];
  for (const [key, codes] of index) {
    if (key === k || key.startsWith(`${k}-`)) out.push(...codes);
  }
  return out;
}

/**
 * 診療行為コードに対し、別表Ⅰが定める摘要欄コメント候補を返す。
 * 区分が一致するエントリ（条件付き）を返すため、最終的にどれを記載するかは記載事項
 * （recordingNote）の条件を見て歯科医師が判断する（強制ではなく候補提示）。
 */
export function requiredCommentsFor(
  procedureCode: string,
  codeToKubun: Map<string, string>,
  index: Map<string, Betsu1Entry[]>,
): Betsu1Entry[] {
  const kubun = codeToKubun.get(procedureCode);
  if (kubun === undefined) return [];
  return index.get(kubun) ?? [];
}
