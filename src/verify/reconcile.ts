/**
 * 突合（reconcile）: 既存レセコンの実UKE と 当エンジンの再計算結果を、診療行為コード単位で
 * 突き合わせて不一致を構造化する（P0-2）。
 *
 * 比較粒度: 診療行為コードごとの {点数, 回数}・合計点数・診療実日数。
 * 「元UKEにあるが当エンジンが出さない」=欠落（未実装の算定が濃厚）、
 * 「当エンジンが出すが元に無い」=過剰、「点数/回数が違う」=ロジック差。
 *
 * これは1点・1回まで合わせるための診断ツール。判定の正解は実レセ側（提出済み）。
 */
import type { UkeRecord } from "../receipt/uke.js";
import { parseFile } from "../receipt/uke.js";
import { processReceipt, type ProcessReceiptResult } from "../receipt/process.js";
import type { OfficialEngine } from "../billing/official-engine.js";
import { ukeToInputs } from "./uke-to-input.js";

interface CodeAgg { points: number; count: number }

/** SSレコード群を 診療行為コード→{点数,回数} に集約（同一コードは回数合算） */
function aggregateSs(records: readonly UkeRecord[]): Map<string, CodeAgg> {
  const m = new Map<string, CodeAgg>();
  for (const ss of records.filter((r) => r.identifier === "SS")) {
    const code = String(ss.fields[2] ?? "");
    if (!/^\d{9}$/.test(code)) continue;
    const points = Number(ss.fields[75] ?? 0) || 0;
    const count = Number(ss.fields[76] ?? 0) || 0;
    const cur = m.get(code) ?? { points: 0, count: 0 };
    cur.points = points; // 単価
    cur.count += count;
    m.set(code, cur);
  }
  return m;
}

export type DiffKind = "missing" | "extra" | "points" | "count";

export interface CodeDiff {
  code: string;
  kind: DiffKind;
  expected?: CodeAgg;
  actual?: CodeAgg;
}

export interface ReceiptReconcile {
  receiptType: string;
  matched: boolean;
  expectedTotal: number;
  actualTotal: number;
  totalDiff: number;
  diffs: CodeDiff[];
  /** 当エンジンの算定エラー（未対応コード等の手掛かり） */
  engineIssues: { severity: string; message: string; procedureCode?: string }[];
  error?: string;
}

export interface ReconcileSummary {
  receipts: number;
  fullyMatched: number;
  matchRate: number; // 0..1（点・回数まで一致したレセプトの割合）
  byType: Record<string, { total: number; matched: number }>;
  totalPointDiffAbs: number;
}

export interface ReconcileResult {
  perReceipt: ReceiptReconcile[];
  summary: ReconcileSummary;
}

/** 1ファイル分のUKEレコードを突合する */
export function reconcileRecords(original: readonly UkeRecord[], loaded: OfficialEngine): ReceiptReconcile[] {
  const reconstructed = ukeToInputs(original, loaded.codeToKubun);
  // 元レコードをレセプト単位に分け、復元結果と対応づける（順序一致を前提）
  const origGroups: UkeRecord[][] = [];
  let cur: UkeRecord[] | undefined;
  for (const r of original) {
    if (r.identifier === "UK" || r.identifier === "GO") continue;
    if (r.identifier === "IR") origGroups.push((cur = [r]));
    else if (cur) cur.push(r);
  }

  const out: ReceiptReconcile[] = [];
  reconstructed.forEach((rec, i) => {
    const expectedAgg = aggregateSs(origGroups[i] ?? []);
    let result: ProcessReceiptResult;
    try {
      result = processReceipt(loaded, { ...rec.input, facility: rec.facility });
    } catch (e) {
      out.push({ receiptType: rec.expected.receiptType, matched: false, expectedTotal: rec.expected.totalPoints, actualTotal: 0, totalDiff: rec.expected.totalPoints, diffs: [], engineIssues: [], error: e instanceof Error ? e.message : String(e) });
      return;
    }
    const actualRecords = parseFile(result.recordsText);
    const actualAgg = aggregateSs(actualRecords);

    const diffs: CodeDiff[] = [];
    for (const [code, exp] of expectedAgg) {
      const act = actualAgg.get(code);
      if (act === undefined) diffs.push({ code, kind: "missing", expected: exp });
      else if (act.points !== exp.points) diffs.push({ code, kind: "points", expected: exp, actual: act });
      else if (act.count !== exp.count) diffs.push({ code, kind: "count", expected: exp, actual: act });
    }
    for (const [code, act] of actualAgg) {
      if (!expectedAgg.has(code)) diffs.push({ code, kind: "extra", actual: act });
    }

    out.push({
      receiptType: rec.expected.receiptType,
      matched: diffs.length === 0 && result.totalPoints === rec.expected.totalPoints,
      expectedTotal: rec.expected.totalPoints,
      actualTotal: result.totalPoints,
      totalDiff: result.totalPoints - rec.expected.totalPoints,
      diffs,
      engineIssues: result.algorithmIssues.map((x) => ({ severity: x.severity, message: x.message, ...(x.procedureCode ? { procedureCode: x.procedureCode } : {}) })),
    });
  });
  return out;
}

/** 複数ファイル横断のサマリを作る */
export function summarize(perReceipt: ReceiptReconcile[]): ReconcileSummary {
  const byType: Record<string, { total: number; matched: number }> = {};
  let matched = 0;
  let totalPointDiffAbs = 0;
  for (const r of perReceipt) {
    const t = (byType[r.receiptType] ??= { total: 0, matched: 0 });
    t.total++;
    if (r.matched) { matched++; t.matched++; }
    totalPointDiffAbs += Math.abs(r.totalDiff);
  }
  return {
    receipts: perReceipt.length,
    fullyMatched: matched,
    matchRate: perReceipt.length === 0 ? 1 : matched / perReceipt.length,
    byType,
    totalPointDiffAbs,
  };
}

/** 人間可読レポート */
export function formatReport(result: ReconcileResult): string {
  const s = result.summary;
  const lines: string[] = [];
  lines.push("════════ 突合レポート（reconcile） ════════");
  lines.push(`レセプト ${s.receipts} 件 / 完全一致 ${s.fullyMatched} 件 / 一致率 ${(s.matchRate * 100).toFixed(1)}%`);
  lines.push(`合計点数の差分（絶対値合計）: ${s.totalPointDiffAbs} 点`);
  lines.push("種別別: " + Object.entries(s.byType).map(([t, v]) => `${t} ${v.matched}/${v.total}`).join(" / "));
  const mismatched = result.perReceipt.filter((r) => !r.matched);
  if (mismatched.length > 0) {
    lines.push(`\n── 不一致 ${mismatched.length} 件 ──`);
    mismatched.slice(0, 50).forEach((r, i) => {
      lines.push(`#${i + 1} 種別${r.receiptType} 期待${r.expectedTotal}点→当エンジン${r.actualTotal}点（差${r.totalDiff}）${r.error ? " ERROR:" + r.error : ""}`);
      for (const d of r.diffs.slice(0, 20)) {
        if (d.kind === "missing") lines.push(`   欠落 ${d.code}: 元=${d.expected!.points}点×${d.expected!.count}（当エンジンが出さない＝未実装の疑い）`);
        else if (d.kind === "extra") lines.push(`   過剰 ${d.code}: 当=${d.actual!.points}点×${d.actual!.count}（元に無い）`);
        else if (d.kind === "points") lines.push(`   点数差 ${d.code}: 元${d.expected!.points}→当${d.actual!.points}`);
        else lines.push(`   回数差 ${d.code}: 元${d.expected!.count}→当${d.actual!.count}`);
      }
    });
  } else {
    lines.push("\n✓ 全レセプトが点・回数・合計まで一致しました。");
  }
  lines.push("══════════════════════════════════════");
  return lines.join("\n");
}
