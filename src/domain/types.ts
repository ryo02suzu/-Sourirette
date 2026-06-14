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

/** 診療日時点の年齢（加算の年齢条件などに使用） */
export function ageAt(birthDate: string, onDate: string): number {
  const birth = new Date(birthDate);
  const on = new Date(onDate);
  let age = on.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    on.getMonth() < birth.getMonth() ||
    (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}
