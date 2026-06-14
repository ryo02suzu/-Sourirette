/** ドメイン共通の型。DB スキーマ（db/schema.sql）と対応する。 */

export type VisitType = "first" | "followup"; // 初診 / 再診

/** 受診の時間区分（時間外/休日/深夜加算の自動算定に使う）。既定は通常時間内 */
export type TimeClass = "regular" | "afterHours" | "holiday" | "midnight";

export interface Patient {
  id: string;
  birthDate: string; // ISO 8601 (YYYY-MM-DD)
  sex: "M" | "F";
}

export interface Visit {
  id: string;
  patientId: string;
  visitDate: string; // ISO 8601
  visitType: VisitType;
  /** 診療時間区分（時間外/休日/深夜）。未指定は通常時間内（加算なし） */
  timeClass?: TimeClass;
}

/** 傷病名（コードは公式傷病名マスタ準拠） */
export interface Diagnosis {
  diseaseCode: string;
  modifierCodes?: string[];
  /** 部位（FDI 2桁表記）。全顎等の部位を持たない病名は省略 */
  teeth?: string[];
  onsetDate: string;
  outcome?: "cured" | "died" | "stopped" | "transferred";
}

/** 実施した診療行為（算定エンジンの入力。コードは診療行為マスタ準拠） */
export interface PerformedProcedure {
  procedureCode: string;
  teeth?: string[];
  quantity: number;
}

/** 診療日時点の年齢（加算の年齢条件などに使用）。
 *  Date を介さず YYYY-MM-DD を数値で比較する（new Date のUTC解釈による境界日のずれを避け、
 *  実行環境のタイムゾーンに依存せず決定的にする）。 */
export function ageAt(birthDate: string, onDate: string): number {
  const b = birthDate.split("-").map(Number);
  const o = onDate.split("-").map(Number);
  const [by, bm, bd] = [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0];
  const [oy, om, od] = [o[0] ?? 0, o[1] ?? 0, o[2] ?? 0];
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}
