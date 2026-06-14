/**
 * 医院プロファイル（都道府県・届出施設基準）と算定エンジンへの接続。
 *
 * 役割:
 *   - 都道府県: レセプトの都道府県コード（別表2）に使う。点数表は全国一律であり、
 *     都道府県で点数は変わらない。都道府県で変わるのは「審査のローカルルール」
 *     「公費・自治体助成（会計）」「都道府県コード」の3つ。本モジュールは都道府県コードを
 *     確定し、ローカルルール・助成のフックを将来のために用意する。
 *   - 届出施設基準: 医院が地方厚生（支）局長に届け出た施設基準。これに応じて算定できる
 *     加算が変わる。エンジンの FacilityStandards（届出照会）に変換して渡す。
 *
 * 設計原則: 点数・算定可否はコードにハードコードしない。施設基準コードは別表5（記録条件仕様）、
 * 加算の算定要件は告示・通知・歯科診療行為マスタを正とし、確定値は歯科医師レビューを経る。
 */
import type { FacilityStandards } from "./engine.js";

/** 別表2 都道府県コード（記録条件仕様 令和8年6月版 別表2 から転記＝全47件） */
export const PREFECTURES: { code: string; name: string }[] = [
  { code: "01", name: "北海道" },
  { code: "02", name: "青森" },
  { code: "03", name: "岩手" },
  { code: "04", name: "宮城" },
  { code: "05", name: "秋田" },
  { code: "06", name: "山形" },
  { code: "07", name: "福島" },
  { code: "08", name: "茨城" },
  { code: "09", name: "栃木" },
  { code: "10", name: "群馬" },
  { code: "11", name: "埼玉" },
  { code: "12", name: "千葉" },
  { code: "13", name: "東京" },
  { code: "14", name: "神奈川" },
  { code: "15", name: "新潟" },
  { code: "16", name: "富山" },
  { code: "17", name: "石川" },
  { code: "18", name: "福井" },
  { code: "19", name: "山梨" },
  { code: "20", name: "長野" },
  { code: "21", name: "岐阜" },
  { code: "22", name: "静岡" },
  { code: "23", name: "愛知" },
  { code: "24", name: "三重" },
  { code: "25", name: "滋賀" },
  { code: "26", name: "京都" },
  { code: "27", name: "大阪" },
  { code: "28", name: "兵庫" },
  { code: "29", name: "奈良" },
  { code: "30", name: "和歌山" },
  { code: "31", name: "鳥取" },
  { code: "32", name: "島根" },
  { code: "33", name: "岡山" },
  { code: "34", name: "広島" },
  { code: "35", name: "山口" },
  { code: "36", name: "徳島" },
  { code: "37", name: "香川" },
  { code: "38", name: "愛媛" },
  { code: "39", name: "高知" },
  { code: "40", name: "福岡" },
  { code: "41", name: "佐賀" },
  { code: "42", name: "長崎" },
  { code: "43", name: "熊本" },
  { code: "44", name: "大分" },
  { code: "45", name: "宮崎" },
  { code: "46", name: "鹿児島" },
  { code: "47", name: "沖縄" },
];

const PREFECTURE_CODES = new Set(PREFECTURES.map((p) => p.code));

/** 施設基準（届出）カタログの1項目 */
export interface FacilityStandardDef {
  /** 別表5 施設基準届出コード（2桁）。記録条件仕様 別表5 で確定したもののみ収録 */
  code: string;
  /** 略称（レセプトの届出欄・院内表示用） */
  shortName: string;
  /** 正式名称 */
  name: string;
  /** 一次資料で確定済みか。false は要・別表5全件取得＋歯科医師レビュー */
  verified: boolean;
}

/**
 * 施設基準届出コードのカタログ。
 *
 * ⚠️ 現状は記録条件仕様 別表5 に明記の2件のみ確定収録。歯科の施設基準は外来環・口管強
 * （か強診）・歯援診・在歯管・医管・GTR 等まだ多数あり、別表5の全件と各加算の算定要件
 * （告示・通知）を取得し、歯科医師レビューを経て段階的に追加する（「膨大な量を間違いなく」は
 * 手書きでなく、別表5＋マスタ＋レビューで一件ずつ確定する方針）。
 */
export const FACILITY_STANDARDS: FacilityStandardDef[] = [
  { code: "01", shortName: "補管", name: "クラウン・ブリッジ維持管理料", verified: true },
  { code: "17", shortName: "歯初診", name: "歯科初診料（歯科外来診療医療安全対策等）", verified: true },
];

const FACILITY_CODES = new Set(FACILITY_STANDARDS.map((s) => s.code));

/** 医院プロファイル（設定画面で編集する想定） */
export interface ClinicProfile {
  /** 別表2 都道府県コード（2桁） */
  prefectureCode: string;
  /** 医療機関コード7桁 */
  facilityCode: string;
  /** 医療機関名称（全角） */
  facilityName: string;
  /**
   * 届出済みの施設基準届出コード（別表5）。各コードに届出日があるため、適用期間を厳密に
   * 扱う場合は {code, since} の配列に拡張する（当面は現在有効なコード集合として扱う）。
   */
  notifiedStandards: string[];
}

/** プロファイルの整合性を検証する（未知の都道府県/施設基準コードを弾く） */
export function validateClinicProfile(profile: ClinicProfile): string[] {
  const errors: string[] = [];
  if (!PREFECTURE_CODES.has(profile.prefectureCode)) {
    errors.push(`未知の都道府県コード: ${profile.prefectureCode}`);
  }
  if (!/^\d{7}$/.test(profile.facilityCode)) {
    errors.push(`医療機関コードは7桁: ${profile.facilityCode}`);
  }
  for (const code of profile.notifiedStandards) {
    if (!FACILITY_CODES.has(code)) {
      errors.push(`未知の施設基準届出コード: ${code}（別表5未収録。カタログへの追加が必要）`);
    }
  }
  return errors;
}

/**
 * 医院プロファイルを算定エンジンの FacilityStandards（届出照会）へ変換する。
 * これにより「設定で届出を選ぶ → 該当加算が算定可能になる」がエンジンに反映される。
 */
export function profileToFacilityStandards(profile: ClinicProfile): FacilityStandards {
  const notified = new Set(profile.notifiedStandards);
  return {
    // onDate は将来の届出適用期間チェック用。現状は集合の包含で判定する。
    has: (standardCode: string, _onDate: string): boolean => notified.has(standardCode),
  };
}

/** 都道府県コード → 名称 */
export function prefectureName(code: string): string | undefined {
  return PREFECTURES.find((p) => p.code === code)?.name;
}
