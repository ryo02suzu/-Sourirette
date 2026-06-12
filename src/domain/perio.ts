/**
 * 歯周検査（P検）ドメインロジック。
 *
 * ⚠️ 病態区分・処置適応はデモ用ヒューリスティック。正式な病態判定・算定条件
 * （歯周基本検査/歯周精密検査の要件、P重防・SPTの移行条件）は Phase 2 で
 * 点数表・関連通知に基づき実装する。
 */

/** 1歯の検査値（4点法: 頬側近心・頬側遠心・舌側近心・舌側遠心） */
export interface ToothPerioRecord {
  fdi: string;
  /** プロービングデプス（mm）。長さ4 */
  pd: number[];
  /** 各計測点の出血（BOP） */
  bop: boolean[];
  /** 動揺度 0〜3 */
  mobility: 0 | 1 | 2 | 3;
}

export interface PerioSummary {
  teeth: number;
  sites: number;
  meanPd: number;
  maxPd: number;
  /** BOP 陽性率（0..1） */
  bopRate: number;
  sites4mm: number;
  sites6mm: number;
}

export type ToothSeverity = "none" | "mild" | "moderate" | "severe";

export function summarize(records: ToothPerioRecord[]): PerioSummary {
  let sites = 0, sum = 0, max = 0, bopPos = 0, s4 = 0, s6 = 0;
  for (const r of records) {
    for (let i = 0; i < r.pd.length; i++) {
      const pd = r.pd[i] ?? 0;
      if (pd <= 0) continue;
      sites += 1;
      sum += pd;
      if (pd > max) max = pd;
      if (r.bop[i]) bopPos += 1;
      if (pd >= 4) s4 += 1;
      if (pd >= 6) s6 += 1;
    }
  }
  return {
    teeth: records.length,
    sites,
    meanPd: sites === 0 ? 0 : Math.round((sum / sites) * 10) / 10,
    maxPd: max,
    bopRate: sites === 0 ? 0 : Math.round((bopPos / sites) * 1000) / 1000,
    sites4mm: s4,
    sites6mm: s6,
  };
}

/** 歯単位の重症度（デモ用: 最大PDと動揺度から） */
export function severityOf(record: ToothPerioRecord): ToothSeverity {
  const max = Math.max(0, ...record.pd);
  if (max >= 6 || record.mobility >= 2) return "severe";
  if (max >= 4) return "moderate";
  if (max > 0 && record.bop.some(Boolean)) return "mild";
  return "none";
}

export interface PerioAssessment {
  label: string;
  /** 提案する処置（コードは公式マスタ取込後に確定） */
  suggestions: string[];
}

/** 全顎の評価と処置提案（デモ用ヒューリスティック） */
export function assess(summary: PerioSummary): PerioAssessment {
  if (summary.sites === 0) return { label: "未検査", suggestions: [] };
  if (summary.sites6mm > 0) {
    return {
      label: "歯周炎（重度の部位あり）",
      suggestions: ["スケーリング", "SRP（6mm以上の部位を優先）", "再評価検査の予定"],
    };
  }
  if (summary.sites4mm > 0) {
    return {
      label: "歯周炎（中等度）",
      suggestions: ["スケーリング", "SRP（4mm以上の部位）", "TBI（ブラッシング指導）"],
    };
  }
  if (summary.bopRate >= 0.1) {
    return { label: "歯肉炎の所見", suggestions: ["スケーリング", "TBI（ブラッシング指導）"] };
  }
  return { label: "歯周組織は概ね安定", suggestions: ["定期メンテナンス（リコール設定）"] };
}
