/**
 * 突合ハーネス用 PII 匿名化（P0-1）。
 *
 * 既存レセコンの実UKEを突合に使う前に、直接識別子を除去する。点数計算に不要な個人情報
 * （氏名・カナ・被保険者記号/番号・カルテ番号・受給者番号）をマスクする。算定に必要な
 * 生年月日（年齢加算）・男女・コード・日付・傷病名コードは保持する。
 *
 * 方針: PII除去後のレコードだけがエンジン（突合）に渡る。元バイト列は保持しない。
 */
import type { UkeRecord } from "../receipt/uke.js";

const MASK = ""; // 直接識別子は空に落とす（点数計算に不要）

/** レコード列のコピーを返し、直接識別子フィールドを空にする */
export function anonymizeUke(records: readonly UkeRecord[]): UkeRecord[] {
  return records.map((r) => {
    const f = [...r.fields];
    switch (r.identifier) {
      case "RE": // [3]氏名 [14]カルテ番号等 [24]カナ氏名
        if (f[3] !== undefined) f[3] = MASK;
        if (f[14] !== undefined) f[14] = MASK;
        if (f[24] !== undefined) f[24] = MASK;
        break;
      case "HO": // [1]記号 [2]番号
        if (f[1] !== undefined) f[1] = MASK;
        if (f[2] !== undefined) f[2] = MASK;
        break;
      case "KO": // [1]受給者番号
        if (f[1] !== undefined) f[1] = MASK;
        break;
      case "SN": // [3]記号 [4]番号 [6]受給者番号
        if (f[3] !== undefined) f[3] = MASK;
        if (f[4] !== undefined) f[4] = MASK;
        if (f[6] !== undefined) f[6] = MASK;
        break;
    }
    return { identifier: r.identifier, fields: f };
  });
}
