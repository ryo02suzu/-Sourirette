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
import type { RulesDb } from "../billing/rules-db-loader.js";
import { buildDiseaseAbbrToCodes } from "../billing/rules-db-loader.js";
import type { Alert, AlertInput } from "./types.js";
import { makeContextKey } from "./types.js";

export interface AlertConfig {
  rulesDb: RulesDb;
  /** 9桁診療行為コード → 区分（告示番号）。区分単位のルール照合に使う */
  codeToKubun: Map<string, string>;
  /** 既読（承認済み）の contextKey 集合。一致するアラートは抑制する */
  acknowledged?: Set<string>;
}

/** 文字列から先頭の区分トークン（例 "I005", "M015-2"）を抽出する。無ければ undefined */
function extractKubun(s: string): string | undefined {
  const m = s.match(/[A-Z]\d{3}(?:-\d+)?/);
  return m ? m[0] : undefined;
}

/** "Pul/5220063" や "Pul" を関連7桁コード群に解決する */
function resolveDiseaseCodes(token: string, abbrToCodes: Map<string, string[]>): string[] {
  const [abbr, code] = token.split("/");
  const out = new Set<string>();
  if (abbr !== undefined) for (const c of abbrToCodes.get(abbr) ?? []) out.add(c);
  if (code !== undefined && /^\d{7}$/.test(code)) out.add(code);
  return [...out];
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
  const abbrToCodes = buildDiseaseAbbrToCodes(rulesDb);
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

  // 1) 病名↔処置の適応 → warning
  for (const dp of rulesDb.diagnosis_procedure) {
    const hits = matchedCodes(dp.procedure_kubun, dp.procedure_codes);
    if (hits.length === 0) continue;
    const forbidden = (dp.forbidden_diseases ?? []).flatMap((t) => resolveDiseaseCodes(t, abbrToCodes));
    const required = (dp.required_diseases ?? []).flatMap((t) => resolveDiseaseCodes(t, abbrToCodes));
    const forbiddenHit = forbidden.find((c) => diseaseSet.has(c));
    const requiredOk = required.length === 0 || required.some((c) => diseaseSet.has(c));
    for (const code of hits) {
      if (forbiddenHit !== undefined) {
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
      if (required.length > 0 && !requiredOk) {
        push({
          level: "warning",
          category: "diagnosis_procedure",
          ruleId: dp.id,
          title: "対応病名なし（審査裁量）",
          message: `${dp.procedure_name ?? code}: 通常この処置に必要な傷病名（${required.join("/")}）が見当たりません`,
          source: dp.source ?? "審査情報提供事例",
          procedureCode: code,
          contextKey: makeContextKey(dp.id, undefined, code),
          requiresDentistReview: true,
        });
      }
    }
  }

  // 2) 施設基準 → error（届出状況が分かるときのみ）
  if (input.notifiedStandards !== undefined) {
    const notified = new Set(input.notifiedStandards);
    for (const fs of rulesDb.facility_standard ?? []) {
      const f = fs as { id: string; besshi5_code?: string; gated_procedure_codes?: string[]; requirement_summary?: string; source?: string };
      if (f.besshi5_code === undefined || notified.has(f.besshi5_code)) continue;
      const hits = matchedCodes((f.gated_procedure_codes ?? []).join("/"), f.gated_procedure_codes);
      for (const code of hits) {
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
  }

  // 3) 年齢/時間/部位 → proposal（取りこぼし提案）
  for (const at of rulesDb.age_time_site ?? []) {
    const kubunField = at.kubun ?? "";
    const hits = matchedCodes(kubunField, at.procedure_codes);
    if (hits.length === 0) continue;
    if (at.type === "その他") continue; // 点数の参照情報（R8点数等）はアラートにしない
    if (at.condition !== undefined && ageConditionExcluded(at.condition, input.patientAge)) continue;
    for (const code of hits) {
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
  }

  return alerts;
}
