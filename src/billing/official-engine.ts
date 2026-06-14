/**
 * 公式データから算定エンジンを組み上げる「工場」。
 *
 * これまで個別に実装した取込（実点数マスタ・電子点数表の回数/背反/包括・別表Ⅰ摘要欄）を
 * 1つの組立点にまとめる。本番（サーバ/アプリ）・CLI・シミュレータはここを通して
 * 「公式データで構成された算定エンジン」を得る。
 *
 * 入力は復号済みデータ（Shift_JIS は Uint8Array、別表ⅠはUTF-8文字列）で受け取り、
 * src/billing 内に fs 依存を持ち込まない（ブラウザでも動く）。ファイル読込は呼び出し側。
 *
 * ⚠️ 構成されるルールはすべて公式データ由来だが、本番算定への有効化（ブロッキング）は
 *    確認試験・実運用の検証後とする方針（status-checklist の鉄則）。
 */
import { CalculationEngine, type CalculationContext, type CalculationIssue, type ClaimLine, type Rule } from "./engine.js";
import { decodeSjis, parseDentalProcedureMaster, buildMasterFromRows } from "./master-loader.js";
import type { InMemoryMaster } from "./master.js";
import { createDataDrivenRules } from "./rule-tables.js";
import { createSiteDiagnosisRule } from "./rules/site-diagnosis.js";
import { buildAdditionIndex, createAdditionRule } from "./rules/additions.js";
import { buildChargeHintsByKubun, buildDiagnosisRequirements, parseRulesDb, type AgeTimeSiteEntry, type RulesDb } from "./rules-db-loader.js";
import { evaluateAlerts } from "../alerts/engine.js";
import type { Alert, AlertInput } from "../alerts/types.js";
import {
  createInclusionGroupRule,
  haihanToMutualExclusions,
  parseHaihan,
  parseHojoMasterGroups,
  parseHokatsuChildren,
  parseSanteiKaisu,
  santeiKaisuToFrequencyLimits,
} from "./tensuhyo-loader.js";
import {
  buildCodeToKubun,
  buildKubunToCodes,
  indexByKubun,
  parseBetsu1,
  requiredCommentsFor,
  type Betsu1Entry,
} from "./betsu1-loader.js";
import { buildDiseaseIndex, buildDiseaseNameIndex, decodeDiseaseMaster, isKnownDiseaseCode, parseDiseaseMaster, type DiseaseRow } from "./disease-loader.js";

/** 復号前の公式データソース（Shift_JIS は Uint8Array、別表ⅠはUTF-8） */
export interface OfficialDataSources {
  /** 歯科診療行為マスタ（h_ALL*.csv, Shift_JIS） */
  procedureMaster: Uint8Array;
  /** 電子点数表 04 算定回数（Shift_JIS） */
  santeiKaisu: Uint8Array;
  /** 電子点数表 03-1 背反（同日, Shift_JIS） */
  haihanSameDay: Uint8Array;
  /** 電子点数表 03-2 背反（同月, Shift_JIS） */
  haihanSameMonth: Uint8Array;
  /** 電子点数表 01 補助マスター（包括の親, Shift_JIS） */
  hojoMaster: Uint8Array;
  /** 電子点数表 02 包括（子, Shift_JIS） */
  hokatsu: Uint8Array;
  /** 別表Ⅰ（歯科）摘要欄コメント（UTF-8 CSV） */
  betsu1Csv: string;
  /**
   * 傷病名マスタ（Shift_JIS）。複数指定するとコードの和集合で検証する。
   * 歯科の傷病名は歯科傷病名マスタ(hb)と全傷病名マスタ(b)に分かれて存在するため
   * （例: 慢性歯周炎=hbのみ / 欠損歯=bのみ）、両方を渡さないと誤検知する。
   */
  diseaseMasters?: Uint8Array[];
  /** 算定ルール調査DB（santei-rules-R8.json）。指定すると病名適応（不適応＝warning）を有効化 */
  rulesDbJson?: string;
  /** 適用判定の基準日（既定は当日） */
  asOf?: string;
}

export interface OfficialEngine {
  engine: CalculationEngine;
  master: InMemoryMaster;
  /** 9桁コード → 区分（告示番号） */
  codeToKubun: Map<string, string>;
  /** 区分 → 別表Ⅰ 摘要欄コメント候補 */
  betsu1Index: Map<string, Betsu1Entry[]>;
  /** 傷病名コード → 傷病名行（傷病名マスタ未指定時は空） */
  diseaseIndex: Map<string, DiseaseRow>;
  /** 傷病名（和名）→ 7桁コード群（研究DBの和名トークン解決用） */
  diseaseNameToCodes: Map<string, string[]>;
  /** 区分 → 算定可能な加算/通則ヒント（算定もれ提示用） */
  chargeHintsByKubun: Map<string, AgeTimeSiteEntry[]>;
  /** 算定ルール調査DB（アラートエンジン用。未指定時は undefined） */
  rulesDb?: RulesDb;
  counts: { frequencyLimits: number; mutualExclusions: number; inclusionGroups: number; betsu1Entries: number; diseases: number; diagnosisRules: number };
}

/** コード接頭辞 → 診療識別（別表20）の簡易割当（UKE の SS 用） */
function categoryOf(code: string): string {
  if (code.startsWith("3010")) return "11"; // 初・再診
  if (code.startsWith("302")) return "13"; // 医学管理
  if (code.startsWith("305")) return "31"; // Ｘ線検査
  if (code.startsWith("309")) return "41"; // 処置・手術
  return "80";
}

/** 入力された診療行為を実マスタ点数で算定行に変換する汎用ルール */
function pricingRule(validFrom: string): Rule {
  return {
    id: `official-pricing/${validFrom}`,
    validFrom,
    evaluate(ctx: CalculationContext) {
      const lines: ClaimLine[] = [];
      const issues: CalculationIssue[] = [];
      for (const p of ctx.procedures) {
        const row = ctx.master.findProcedure(p.procedureCode, ctx.visit.visitDate);
        if (!row) {
          // マスタに無いコードは黙って落とさず指摘する（タイプミス・過少請求の防止）
          issues.push({ severity: "error", ruleId: `official-pricing/${validFrom}`, procedureCode: p.procedureCode, message: `診療行為コード ${p.procedureCode} がマスタに存在しません（診療日 ${ctx.visit.visitDate}）` });
          continue;
        }
        const line: ClaimLine = { procedureCode: p.procedureCode, name: row.name, points: row.points, quantity: p.quantity, category: categoryOf(p.procedureCode) };
        if (p.teeth && p.teeth.length > 0) line.teeth = p.teeth;
        lines.push(line);
      }
      return { lines, issues };
    },
  };
}

/** 公式データ一式から、算定エンジンと付随データ（区分対応・別表Ⅰ索引）を組み上げる */
export function loadOfficialEngine(src: OfficialDataSources, validFrom = "2024-04-01"): OfficialEngine {
  const asOf = src.asOf ?? new Date().toISOString().slice(0, 10);
  const masterText = decodeSjis(src.procedureMaster);
  const masterRows = parseDentalProcedureMaster(masterText);
  const master = buildMasterFromRows(masterRows);
  const additionIndex = buildAdditionIndex(masterRows);

  const frequencyLimits = santeiKaisuToFrequencyLimits(parseSanteiKaisu(decodeSjis(src.santeiKaisu)), asOf);
  const mutualExclusions = [
    ...haihanToMutualExclusions(parseHaihan(decodeSjis(src.haihanSameDay)), "same-day", asOf),
    ...haihanToMutualExclusions(parseHaihan(decodeSjis(src.haihanSameMonth)), "same-month", asOf),
  ];
  const parentsByGroup = parseHojoMasterGroups(decodeSjis(src.hojoMaster), asOf);
  const childrenByGroup = parseHokatsuChildren(decodeSjis(src.hokatsu), asOf);
  const inclusionRule = createInclusionGroupRule(parentsByGroup, childrenByGroup, validFrom);
  const inclusionGroups = [...parentsByGroup.keys()].filter((g) => childrenByGroup.has(g)).length;

  const codeToKubun = buildCodeToKubun(masterText);
  const betsu1Entries = parseBetsu1(src.betsu1Csv);
  const betsu1Index = indexByKubun(betsu1Entries);
  const diseaseRows = (src.diseaseMasters ?? []).flatMap((m) => parseDiseaseMaster(decodeDiseaseMaster(m)));
  const diseaseIndex = buildDiseaseIndex(diseaseRows);
  const diseaseNameToCodes = buildDiseaseNameIndex(diseaseRows);

  // 算定ルール調査DB（病名適応の不適応＝warning）を区分→9桁コードに展開して有効化
  const rulesDb = src.rulesDbJson !== undefined ? parseRulesDb(src.rulesDbJson) : undefined;
  const diagnosisRequirements = rulesDb !== undefined
    ? buildDiagnosisRequirements(rulesDb, buildKubunToCodes(masterText), diseaseNameToCodes)
    : [];
  const chargeHintsByKubun = rulesDb !== undefined ? buildChargeHintsByKubun(rulesDb) : new Map<string, AgeTimeSiteEntry[]>();

  const engine = new CalculationEngine([
    pricingRule(validFrom),
    createAdditionRule(additionIndex, codeToKubun, validFrom), // 年齢/時間外加算の自動算定（取りこぼし防止）
    ...createDataDrivenRules({ frequencyLimits, mutualExclusions, diagnosisRequirements }, validFrom),
    inclusionRule,
    createSiteDiagnosisRule(validFrom), // 部位×病名 歯式突合（処置の歯が傷病名部位にあるか）
  ]);

  return {
    engine,
    master,
    codeToKubun,
    betsu1Index,
    diseaseIndex,
    diseaseNameToCodes,
    chargeHintsByKubun,
    ...(rulesDb !== undefined ? { rulesDb } : {}),
    counts: { frequencyLimits: frequencyLimits.length, mutualExclusions: mutualExclusions.length, inclusionGroups, betsu1Entries: betsu1Entries.length, diseases: diseaseIndex.size, diagnosisRules: diagnosisRequirements.length },
  };
}

/** 構成済みエンジンに対し、ある診療行為の摘要欄コメント候補（別表Ⅰ）を引く */
export function commentCandidates(loaded: OfficialEngine, procedureCode: string): Betsu1Entry[] {
  return requiredCommentsFor(procedureCode, loaded.codeToKubun, loaded.betsu1Index);
}

/** 傷病名コードが傷病名マスタに存在するか（傷病名マスタ未指定時は常に true） */
export function isValidDisease(loaded: OfficialEngine, code: string): boolean {
  if (loaded.diseaseIndex.size === 0) return true;
  return isKnownDiseaseCode(code, loaded.diseaseIndex);
}

/** 算定支援アラートを評価する（公式エンジンの調査DB＋区分対応を使う）。調査DB未指定なら空 */
export function computeAlerts(loaded: OfficialEngine, input: AlertInput, acknowledged?: Set<string>): Alert[] {
  if (loaded.rulesDb === undefined) return [];
  return evaluateAlerts(input, { rulesDb: loaded.rulesDb, codeToKubun: loaded.codeToKubun, diseaseNameToCodes: loaded.diseaseNameToCodes, ...(acknowledged !== undefined ? { acknowledged } : {}) });
}

/**
 * 算定もれ提示: 算定した診療行為コード群に対し、該当すれば算定できる加算/通則のヒントを返す。
 * 「この処置なら6歳未満で乳幼児加算40点／時間外85点も算定できる」等。最終判断は医院（要確認）。
 */
export function missedChargeHints(loaded: OfficialEngine, procedureCodes: readonly string[]): { procedureCode: string; type: string; condition: string; value: string; source: string }[] {
  const out: { procedureCode: string; type: string; condition: string; value: string; source: string }[] = [];
  const seen = new Set<string>();
  for (const code of procedureCodes) {
    const kubun = loaded.codeToKubun.get(code);
    if (kubun === undefined) continue;
    for (const h of loaded.chargeHintsByKubun.get(kubun) ?? []) {
      const key = `${code}#${h.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ procedureCode: code, type: h.type, condition: h.condition ?? "", value: h.value ?? "", source: h.source ?? "" });
    }
  }
  return out;
}
