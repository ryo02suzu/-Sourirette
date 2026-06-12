/**
 * レセプト電算ファイル（UKE）出力の枠組み。
 *
 * ⚠️ レコード種別ごとのフィールド定義（並び・桁・必須/任意）は、支払基金が公開する
 *    「レセプト電算処理システム 記録条件仕様（歯科用）」の最新版から転記して確定させる。
 *    このファイルは直列化の基盤（行の組み立て・検証フック）のみを提供し、
 *    フィールド仕様を推測で実装しない。
 *
 * フォーマットの骨格（医科・歯科共通の構造）:
 *   - 1行 = 1レコード。先頭フィールドがレコード識別子（IR/RE/HO/SY/CO 等）。
 *   - フィールドはカンマ区切り、行末は CR+LF。
 *   - 文字コードは Shift_JIS（内部は UTF-8 で扱い、書き出し時にエンコードする。
 *     Node 標準には Shift_JIS エンコーダがないため、実装時に iconv-lite 等を導入する）。
 */

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
    if (f.includes(",") || f.includes("\r") || f.includes("\n")) {
      throw new Error(`field contains forbidden character: ${JSON.stringify(f)}`);
    }
  }
  return [record.identifier, ...fields].join(",");
}

/** レセプトファイル全体（レコード列）を直列化する。行末は CR+LF（公式仕様準拠） */
export function serializeFile(records: UkeRecord[]): string {
  return records.map(serializeRecord).map((line) => line + "\r\n").join("");
}
