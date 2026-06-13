/**
 * Shift_JIS エンコーダ（ランタイム依存ゼロ）。
 *
 * UKE ファイルの文字符号は「JIS X 0201-1976 の8単位符号 ＋ JIS X 0208-1983 附属書1の
 * シフト符号化表現（シフトJIS）」（記録条件仕様 第1章 3（3）エ）。
 * Node 標準にエンコーダはないため、標準の TextDecoder("shift_jis") を逆引きして
 * 文字→バイト列の変換表を初回に構築する。
 *
 * JIS X 0208 規程外の文字（機種依存文字・絵文字等）は仕様の規定どおり
 * 全角疑問符「？」（0x81 0x48）に置換する。
 * NEC特殊文字（先行 0x87）・NEC選定IBM拡張（0xED/0xEE）・IBM拡張（0xFA-0xFC）は
 * JIS X 0208 外のため変換表から除外し、置換対象とする。
 */

const FULLWIDTH_QUESTION: readonly [number, number] = [0x81, 0x48];

let reverseMap: Map<string, readonly [number, number]> | undefined;

function getReverseMap(): Map<string, readonly [number, number]> {
  if (reverseMap !== undefined) return reverseMap;
  const map = new Map<string, readonly [number, number]>();
  const decoder = new TextDecoder("shift_jis");
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xef; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue; // 先行バイト範囲外
    if (lead === 0x87 || lead === 0xed || lead === 0xee) continue; // JIS X 0208 外の拡張
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      pair[0] = lead;
      pair[1] = trail;
      const s = decoder.decode(pair);
      if (s.length !== 1 || s === "�") continue;
      if (!map.has(s)) map.set(s, [lead, trail]);
    }
  }
  reverseMap = map;
  return map;
}

/** 1文字をバイト列へ。変換不能（JIS規程外）は undefined */
function encodeChar(ch: string): readonly number[] | undefined {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return undefined;
  if (cp <= 0x7f) return [cp]; // JIS X 0201（ASCII互換域）
  if (cp >= 0xff61 && cp <= 0xff9f) return [cp - 0xfec0]; // 半角カタカナ
  return getReverseMap().get(ch);
}

/** 文字列を Shift_JIS バイト列へ。JIS規程外コードは全角「？」に置換（仕様の規定） */
export function encodeShiftJis(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const bytes = encodeChar(ch);
    if (bytes !== undefined) out.push(...bytes);
    else out.push(...FULLWIDTH_QUESTION);
  }
  return Uint8Array.from(out);
}

/** Shift_JIS でのバイト数（置換後のバイト数） */
export function sjisByteLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const bytes = encodeChar(ch);
    n += bytes !== undefined ? bytes.length : 2;
  }
  return n;
}

/** 全文字が Shift_JIS（JIS X 0208 の範囲）で表現できるか */
export function isSjisEncodable(text: string): boolean {
  for (const ch of text) {
    if (ch === "？") continue; // 全角疑問符自体は正当
    if (encodeChar(ch) === undefined) return false;
  }
  return true;
}

/** 全文字が全角（2バイト文字）か。漢字モード項目の検証に使う */
export function isFullWidthSjis(text: string): boolean {
  for (const ch of text) {
    const bytes = encodeChar(ch);
    if (bytes === undefined || bytes.length !== 2) return false;
  }
  return true;
}
