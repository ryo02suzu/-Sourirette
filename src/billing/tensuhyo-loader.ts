/**
 * 電子点数表（歯科）→ データ駆動ルールテーブルへの取込ローダー。
 *
 * 出典: 社会保険診療報酬支払基金「電子点数表（歯科）令和8年度版」tensuhyo_04.zip
 *   data/tensuhyo/04_santei_kaisu.csv（算定回数テーブル）
 *   data/tensuhyo/03-1〜03-5_haihan.csv（背反テーブル）
 *   data/tensuhyo/02_hokatsu.csv（包括テーブル）
 *   いずれも Shift_JIS・クォート付きCSV。
 *
 * 設計: マスタ（公式データ）を正として rule-tables.ts の解釈器に流し込む。点数は持たせない
 * （点数は診療行為マスタから引く）。本ローダーが扱うのは「回数制限・背反・包括」の関係データ。
 *
 * ⚠️ 安全方針: 機械的に取り込むが、本番の算定ブロックに有効化する前に歯科医師レビューを経る
 *    （特に背反の scope＝同日/同月、包括のグループ意味は電子点数表レイアウトで要確認）。
 */
import { decodeSjis, normalizeDate, parseCsvLine } from "./master-loader.js";
import type { FrequencyLimit, MutualExclusion } from "./rule-tables.js";

/** Shift_JIS バッファ → UTF-8 文字列（ローダーの入口） */
export function decodeTensuhyo(buf: Uint8Array): string {
  return decodeSjis(buf);
}

/** 適用期間内か（asOf 既定は当日）。validTo=99999999 は無期限 */
function isActive(validFromRaw: string, validToRaw: string, asOf: string): boolean {
  const from = normalizeDate(validFromRaw) ?? "1900-01-01";
  const to = normalizeDate(validToRaw); // 無期限は undefined
  return from <= asOf && (to === undefined || asOf <= to);
}

// ---- 算定回数テーブル → 回数制限 ----

export interface SanteiKaisuRow {
  code: string;
  addonCode: string;
  name: string;
  /** 期間区分の生値（月/日/週/歯/個/一連/口腔 等。時間ベース以外も保持） */
  period: string;
  maxCount: number;
  validFrom: string;
  validTo: string;
}

/** 算定回数テーブル（04）をパースする */
export function parseSanteiKaisu(utf8: string): SanteiKaisuRow[] {
  const rows: SanteiKaisuRow[] = [];
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    const code = f[1] ?? "";
    if (!/^\d{9}$/.test(code)) continue;
    rows.push({
      code,
      addonCode: f[2] ?? "",
      name: f[3] ?? "",
      period: f[6] ?? "",
      maxCount: Number(f[7] ?? "0"),
      validFrom: f[10] ?? "",
      validTo: f[11] ?? "",
    });
  }
  return rows;
}

/**
 * 算定回数行 → FrequencyLimit[]。
 * 現在の FrequencyLimit は per="day"|"month" のみ表現できるため、時間ベース（月・日）かつ
 * 基本行為（加算コード 00000）かつ適用期間内の行のみ取り込む。単位ベース（歯/個/口腔/一連
 * 等）は別概念のため対象外（モデル拡張＋レビュー後に追加）。
 */
export function santeiKaisuToFrequencyLimits(rows: readonly SanteiKaisuRow[], asOf = todayIso()): FrequencyLimit[] {
  const out: FrequencyLimit[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.addonCode !== "00000") continue;
    if (!isActive(r.validFrom, r.validTo, asOf)) continue;
    const per = r.period === "月" ? "month" : r.period === "日" ? "day" : undefined;
    if (per === undefined) continue;
    if (!Number.isFinite(r.maxCount) || r.maxCount <= 0) continue;
    const key = `${r.code}/${per}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: r.code, maxCount: r.maxCount, per, note: `電子点数表 算定回数（${r.name}）` });
  }
  return out;
}

// ---- 背反テーブル → 併算定不可 ----

export interface HaihanRow {
  codeA: string;
  addonA: string;
  codeB: string;
  addonB: string;
  /** 背反区分（1/2は対称ペア、3は特例。意味の確定は電子点数表レイアウトで要確認） */
  kind: string;
  validFrom: string;
  validTo: string;
}

/** 背反テーブル（03-x）をパースする */
export function parseHaihan(utf8: string): HaihanRow[] {
  const rows: HaihanRow[] = [];
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    const codeA = f[1] ?? "";
    const codeB = f[4] ?? "";
    if (!/^\d{9}$/.test(codeA) || !/^\d{9}$/.test(codeB)) continue;
    rows.push({
      codeA,
      addonA: f[2] ?? "",
      codeB,
      addonB: f[5] ?? "",
      kind: f[7] ?? "",
      validFrom: f[10] ?? "",
      validTo: f[11] ?? "",
    });
  }
  return rows;
}

/**
 * 背反行 → MutualExclusion[]。
 * 背反テーブルは方向違い（区分1/2）で対称収録されるため、無順序ペアで重複排除する。
 * 基本行為どうし（加算コード 00000）のみ取り込む（加算固有の背反は別途）。
 *
 * @param scope 同日/同月の別。電子点数表レイアウトで確定するまで呼び出し側が指定する
 *   （既定 same-month＝同一明細書内併算定不可の保守的解釈。要・歯科医師レビュー）。
 */
export function haihanToMutualExclusions(
  rows: readonly HaihanRow[],
  scope: "same-day" | "same-month" = "same-month",
  asOf = todayIso(),
): MutualExclusion[] {
  const out: MutualExclusion[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.addonA !== "00000" || r.addonB !== "00000") continue;
    if (r.codeA === r.codeB) continue;
    if (!isActive(r.validFrom, r.validTo, asOf)) continue;
    const [lo, hi] = r.codeA < r.codeB ? [r.codeA, r.codeB] : [r.codeB, r.codeA];
    const key = `${lo}/${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ codeA: lo, codeB: hi, scope, note: "電子点数表 背反" });
  }
  return out;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
