/**
 * 算定支援アラートの型定義（framework非依存の純ロジック）。
 *
 * 設計思想: ブロックしない。すべて上書き可。歯科医師に委ねる"気づき"に留める。
 *   - error    🔴確認必須: 客観的に黒（施設基準未届・回数超過・年齢外・必須コメント欠落）
 *   - warning  🟡確認推奨: 病名↔処置の不適応など審査裁量。控えめ・無視可
 *   - proposal 💡取りこぼし提案: 算定忘れ。最も控えめ。やってないなら無視が正解
 * ※ error でも保存/提出は絶対にブロックしない。
 */
export type AlertLevel = "error" | "warning" | "proposal";

export type AlertCategory = "diagnosis_procedure" | "facility_standard" | "age_time_site";

export interface Alert {
  level: AlertLevel;
  category: AlertCategory;
  /** 元ルールID（DP001 / FS001 / AT012 等） */
  ruleId: string;
  /** 短い見出し */
  title: string;
  /** 詳細メッセージ（指図でなく参考情報） */
  message: string;
  /** 根拠（"情提103" や "保医発0305第6号 区分I005"）。必ず併記する */
  source: string;
  /** 対象の診療行為コード（9桁）または区分 */
  procedureCode?: string;
  /** 対象の傷病名コード */
  diseaseCode?: string;
  /**
   * 既読学習の文脈キー: (ルールID, 対象傷病名コード, 対象診療行為コード/区分)。
   * 歯科医師が承認するとこのキーが既読になり、次回から非表示になる。
   */
  contextKey: string;
  /** 審査裁量があり最終判断は歯科医師に委ねるべきか */
  requiresDentistReview: boolean;
}

/** 歯科医師が「これでOK」と承認したパターン（既読学習用） */
export interface AcknowledgedPattern {
  /** Alert.contextKey と一致 */
  contextKey: string;
  /** 承認日時（ISO） */
  acknowledgedAt: string;
  /** 承認者・メモ（任意） */
  note?: string;
}

/** アラート評価の入力（レセプト内容） */
export interface AlertInput {
  /** 算定した診療行為コード（9桁）の配列 */
  procedureCodes: string[];
  /** 傷病名コードの配列 */
  diseaseCodes: string[];
  /** 患者年齢（年齢条件の判定用。未指定なら年齢条件は判定保留＝提示する） */
  patientAge?: number;
  /**
   * 届出済みの施設基準コード（besshi5_code: 歯初診/外安全 等）。
   * 未指定（undefined）なら施設基準チェックを行わない（届出状況不明）。
   */
  notifiedStandards?: string[];
}

/** 文脈キーを生成する: ルールID#傷病名コード#診療行為コード（空は省略表現） */
export function makeContextKey(ruleId: string, diseaseCode?: string, procedureCode?: string): string {
  return `${ruleId}#${diseaseCode ?? ""}#${procedureCode ?? ""}`;
}
