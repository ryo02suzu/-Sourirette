/**
 * レセプト電算ファイル（UKE）出力の直列化基盤。
 *
 * 物理仕様の根拠: 「オンライン又は光ディスク等による請求に係る記録条件仕様（歯科用）
 * 令和8年6月版」（docs/specs/R08bt1_3_kiroku_dental.pdf 第1章 3（3））
 *   - ファイル名 RECEIPTS.UKE、CSV形式・可変長レコード
 *   - 項目区切りはカンマ（位取りカンマ不可）、引用符（"）は使用しない
 *   - 改行コードは CR+LF、最終レコードの改行コードの後に EOF コード（0x1A）
 *   - 文字符号は Shift_JIS（JIS X 0201 ＋ JIS X 0208 附属書1）
 *
 * レコード種別ごとのフィールド定義と検証は records.ts、ファイル組み立ては build.ts。
 */
import { encodeShiftJis } from "./shift-jis.js";

export interface UkeRecord {
  /** レコード識別子（例: "IR", "RE"）。公式仕様の識別子のみ使用する */
  identifier: string;
  /** 識別子に続くフィールド列。undefined は空欄として出力 */
  fields: (string | number | undefined)[];
}

/** 1レコードを1行に直列化する */
export function serializeRecord(record: UkeRecord): string {
  const fields = record.fields.map((f) => (f === undefined ? "" : String(f)));
  for (const f of fields) {
    if (f.includes(",") || f.includes('"') || f.includes("\r") || f.includes("\n") || f.includes("\x1a")) {
      throw new Error(`field contains forbidden character: ${JSON.stringify(f)}`);
    }
  }
  return [record.identifier, ...fields].join(",");
}

/** レセプトファイル全体（レコード列）を直列化する。行末は CR+LF（公式仕様準拠） */
export function serializeFile(records: UkeRecord[]): string {
  return records.map(serializeRecord).map((line) => line + "\r\n").join("");
}

/** RECEIPTS.UKE の中身として書き出すバイト列（Shift_JIS ＋ 末尾 EOF コード 0x1A） */
export function encodeUkeFile(records: UkeRecord[]): Uint8Array {
  const body = encodeShiftJis(serializeFile(records));
  const out = new Uint8Array(body.length + 1);
  out.set(body, 0);
  out[body.length] = 0x1a;
  return out;
}
