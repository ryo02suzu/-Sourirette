/**
 * 歯科傷病名マスタのローダー。
 *
 * 出典: 診療報酬情報提供サービス 傷病名マスター（歯科 hb_*.txt, Shift_JIS）。
 * レイアウト（マスターファイル仕様説明書 令和8年度版・3 傷病名マスター）:
 *   項番1 変更区分 / 2 レコード識別("B") / 3 傷病名コード(7桁) / 4 移行先コード(7桁) /
 *   5 基本名称桁数 / 6 基本名称 / 7 省略名称桁数 / 8 省略名称 / 9 カナ桁数 / 10 カナ名称。
 *
 * 用途: 傷病名コードの妥当性検証（HSレコードの返戻防止）・病名検索・病名適応ルールの
 * コード集合構築の土台。点数同様コードはハードコードせず本マスタを正とする。
 */
import { decodeSjis, parseCsvLine } from "./master-loader.js";

export interface DiseaseRow {
  /** 傷病名コード（7桁） */
  code: string;
  /** 基本名称 */
  name: string;
  /** 省略名称（紙レセプト用） */
  shortName: string;
  /** カナ名称 */
  kana: string;
  /** 廃止に伴う移行先コード（あれば） */
  transferTo?: string;
}

/** 歯科傷病名マスタ（Shift_JIS バッファ）→ UTF-8 文字列 */
export function decodeDiseaseMaster(buf: Uint8Array): string {
  return decodeSjis(buf);
}

/** 傷病名マスタ（UTF-8）をパースする */
export function parseDiseaseMaster(utf8: string): DiseaseRow[] {
  const rows: DiseaseRow[] = [];
  for (const line of utf8.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = parseCsvLine(line);
    if ((f[1] ?? "") !== "B") continue;
    const code = f[2] ?? "";
    if (!/^\d{7}$/.test(code)) continue;
    const transfer = (f[3] ?? "").trim();
    const row: DiseaseRow = {
      code,
      name: f[5] ?? "",
      shortName: f[7] ?? "",
      kana: f[9] ?? "",
    };
    if (/^\d{7}$/.test(transfer) && transfer !== "0000000") row.transferTo = transfer;
    rows.push(row);
  }
  return rows;
}

/** 傷病名コード → 行 の索引 */
export function buildDiseaseIndex(rows: readonly DiseaseRow[]): Map<string, DiseaseRow> {
  const map = new Map<string, DiseaseRow>();
  for (const r of rows) map.set(r.code, r);
  return map;
}

/** 傷病名コードがマスタに存在するか（未コード化傷病名 0000999 は別途許容） */
export function isKnownDiseaseCode(code: string, index: Map<string, DiseaseRow>): boolean {
  return code === "0000999" || index.has(code);
}

/** 名称・カナの部分一致で傷病名を検索する（UIの病名検索用） */
export function searchDiseases(rows: readonly DiseaseRow[], query: string, limit = 30): DiseaseRow[] {
  const q = query.trim();
  if (q === "") return [];
  const out: DiseaseRow[] = [];
  for (const r of rows) {
    if (r.name.includes(q) || r.kana.includes(q)) {
      out.push(r);
      if (out.length >= limit) break;
    }
  }
  return out;
}
