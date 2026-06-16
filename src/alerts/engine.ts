/**
 * 算定支援アラートエンジン（純関数）。
 *
 * レセプト内容（算定コード配列＋傷病名＋患者文脈）→ 発火アラート配列。
 * 副作用なし・framework非依存。既読パターンに一致するアラートは抑制する（総量制御）。
 *
 * カテゴリ別の発火:
 *   - diagnosis_procedure → warning（forbidden該当 / required欠落）
 *   - facility_standard   → error（未届の施設基準で gated_procedure を算定）
 *   - age_time_site       → proposal（取りこぼし: 該当すれば算定できる加算/通則）
 */
import type { RulesDb, DiseaseResolver } from "../billing/rules-db-loader.js";
import { buildDiseaseAbbrToCodes, resolveDiseaseCodes } from "../billing/rules-db-loader.js";
import type { Alert, AlertInput } from "./types.js";
import { makeContextKey } from "./types.js";

export interface AlertConfig {
  rulesDb: RulesDb;
  /** 9桁診療行為コード → 区分（告示番号）。区分単位のルール照合に使う */
  codeToKubun: Map<string, string>;
  /** 傷病名（和名）→ 7桁コード群。研究DBの和名トークンの解決に使う（任意） */
  diseaseNameToCodes?: Map<string, string[]>;
  /** 既読（承認済み）の contextKey 集合。一致するアラートは抑制する */
  acknowledged?: Set<string>;
}

/** 文字列から先頭の区分トークン（例 "I005", "M015-2"）を抽出する。無ければ undefined */
function extractKubun(s: string): string | undefined {
  const m = s.match(/[A-Z]\d{3}(?:-\d+)?/);
  return m ? m[0] : undefined;
}

/** 年齢条件（"6歳未満"等）が患者年齢に該当しないと明確に分かるか。未指定/不明は false（提示する） */
function ageConditionExcluded(condition: string, age: number | undefined): boolean {
  if (age === undefined) return false;
  const m = condition.match(/(\d+)歳未満/);
  if (m && age >= Number(m[1])) return true; // 「6歳未満」なのに6歳以上 → 該当しない
  return false;
}

/**
 * レセプト内容を評価し、発火アラート配列を返す（純関数）。
 * 既読パターン（acknowledged）に一致するアラートは結果から除外する。
 */
export function evaluateAlerts(input: AlertInput, cfg: AlertConfig): Alert[] {
  const { rulesDb, codeToKubun } = cfg;
  const acknowledged = cfg.acknowledged ?? new Set<string>();
  const resolver: DiseaseResolver = { abbrToCodes: buildDiseaseAbbrToCodes(rulesDb), ...(cfg.diseaseNameToCodes !== undefined ? { nameToCodes: cfg.diseaseNameToCodes } : {}) };
  const diseaseSet = new Set(input.diseaseCodes);

  // 算定した区分 → その区分で算定された9桁コード
  const billedByKubun = new Map<string, string[]>();
  for (const code of input.procedureCodes) {
    const kubun = codeToKubun.get(code);
    if (kubun === undefined) continue;
    let arr = billedByKubun.get(kubun);
    if (arr === undefined) billedByKubun.set(kubun, (arr = []));
    arr.push(code);
  }
  const billedKubuns = new Set(billedByKubun.keys());
  const billedCodes = new Set(input.procedureCodes);

  const alerts: Alert[] = [];
  const push = (a: Alert): void => {
    if (!acknowledged.has(a.contextKey)) alerts.push(a);
  };

  // 区分（または procedure_codes）から、実際に算定されたコードを返す（無ければ空）
  const matchedCodes = (kubunField: string, procCodes?: string[]): string[] => {
    const out = new Set<string>();
    for (const c of procCodes ?? []) if (billedCodes.has(c)) out.add(c);
    for (const part of kubunField.split("/")) {
      const k = extractKubun(part);
      if (k !== undefined && billedKubuns.has(k)) for (const c of billedByKubun.get(k)!) out.add(c);
    }
    return [...out];
  };

  // 1) 病名↔処置の「不適応」のみ warning（高精度な負の信号だけを出す）。
  //   審査事例の「適応」は “その病名なら認める一例” にすぎず、“その病名が必須” を意味しない
  //   （例: 写真診断が上顎洞炎で認められる ≠ 写真診断には上顎洞炎が要る）。
  //   よって「対応病名なし（required欠落）」は誤検知の温床なので発火させない。不適応のみ扱う。
  //   同一(処置×病名)の不適応は、事例が複数あっても1件に集約する。
  const forbiddenSeen = new Set<string>();
  for (const dp of rulesDb.diagnosis_procedure) {
    const hits = matchedCodes(dp.procedure_kubun, dp.procedure_codes);
    if (hits.length === 0) continue;
    const forbidden = (dp.forbidden_diseases ?? []).flatMap((t) => resolveDiseaseCodes(t, resolver));
    const forbiddenHit = forbidden.find((c) => diseaseSet.has(c));
    if (forbiddenHit === undefined) continue;
    const code = hits[0]!; // 同じ区分で複数コードが当たっても病名×処置の指摘は1件でよい
    if (forbiddenSeen.has(`${code}#${forbiddenHit}`)) continue;
    forbiddenSeen.add(`${code}#${forbiddenHit}`);
    push({
      level: "warning",
      category: "diagnosis_procedure",
      ruleId: dp.id,
      title: "病名↔処置の不適応（審査裁量）",
      message: `${dp.procedure_name ?? code}: ${dp.note ?? "対象病名に対しては認められない傾向"}`,
      source: dp.source ?? "審査情報提供事例",
      procedureCode: code,
      diseaseCode: forbiddenHit,
      contextKey: makeContextKey(dp.id, forbiddenHit, code),
      requiresDentistReview: true,
    });
  }

  // 2) 施設基準 → error（届出状況が分かるときのみ）。施設基準あたり1件（処置ごとに乱発しない）
  if (input.notifiedStandards !== undefined) {
    const notified = new Set(input.notifiedStandards);
    for (const fs of rulesDb.facility_standard ?? []) {
      const f = fs as { id: string; besshi5_code?: string; gated_procedure_codes?: string[]; requirement_summary?: string; source?: string };
      if (f.besshi5_code === undefined || notified.has(f.besshi5_code)) continue;
      const hits = matchedCodes((f.gated_procedure_codes ?? []).join("/"), f.gated_procedure_codes);
      if (hits.length === 0) continue;
      const code = hits[0]!;
      push({
        level: "error",
        category: "facility_standard",
        ruleId: f.id,
        title: "施設基準 未届",
        message: `${f.besshi5_code} 未届で算定（${f.requirement_summary?.slice(0, 40) ?? ""}…）`,
        source: f.source ?? "告示・通知",
        procedureCode: code,
        contextKey: makeContextKey(f.id, undefined, code),
        requiresDentistReview: false,
      });
    }
  }

  // 3) 年齢/時間/部位 → proposal（取りこぼし提案）。提案あたり1件。
  //   初診料/再診料の年齢・時間外加算は自動算定（rules/additions）で既に付与するため、
  //   提案として二重に出さない（auto-add の対象区分 A000/A001/A002 × 年齢/時間 は除外）。
  const AUTO_ADDED_KUBUN = new Set(["A000", "A001", "A002"]);
  for (const at of rulesDb.age_time_site ?? []) {
    const kubunField = at.kubun ?? "";
    const hits = matchedCodes(kubunField, at.procedure_codes);
    if (hits.length === 0) continue;
    if (at.type === "その他") continue; // 点数の参照情報（R8点数等）はアラートにしない
    const baseKubun = extractKubun(kubunField);
    if (baseKubun !== undefined && AUTO_ADDED_KUBUN.has(baseKubun)) continue; // 初診/再診の年齢・時間外加算は自動算定が owns（提案で二重に出さない）
    if (at.condition !== undefined && ageConditionExcluded(at.condition, input.patientAge)) continue;
    const code = hits[0]!;
    push({
      level: "proposal",
      category: "age_time_site",
      ruleId: at.id,
      title: "取りこぼし提案",
      message: `${at.condition ?? ""} → ${at.value ?? ""}（該当すれば算定可）`,
      source: at.source ?? "告示・通知",
      procedureCode: code,
      contextKey: makeContextKey(at.id, undefined, code),
      requiresDentistReview: false,
    });
  }

  // 最終ガード: (ruleId × 病名) が同一のアラートは1件に集約（区分内の複数コードでの重複を消す）
  const seen = new Set<string>();
  return alerts.filter((a) => {
    const key = `${a.ruleId}#${a.diseaseCode ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
