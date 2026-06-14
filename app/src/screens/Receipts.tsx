/** レセプト画面（月次）: 点検 → エラー解消 → UKE出力 → オンライン請求。 */
import { useState } from "react";
import { monthReceipts, receiptIssues } from "../data/mock.js";
import { useToast } from "../components/toast.js";
import { downloadUke, generateDemoUke } from "../uke-export.js";
import {
  checkHealth,
  DEMO_ENCOUNTER,
  downloadUkeBase64,
  generateReceipt,
  type ServerCommentCandidate,
  type ServerValidationIssue,
} from "../services/algorithm-api.js";

const AI_TEKIYO_DRAFT =
  "義歯不適合により疼痛著明、咀嚼困難を認めたため同月2回目の調整を実施。" +
  "右下臼歯部顎堤の骨吸収が顕著であり、リライニングでは対応困難と判断した。";

/** 画面表示用に正規化した UKE 結果（サーバ実点数 / ブラウザ・デモ 共通） */
interface DisplayUke {
  source: string;
  text: string;
  recordCount: number;
  byteLength: number;
  totalPoints: number;
  visitDays: number;
  validation: ServerValidationIssue[];
  submittable: boolean;
  commentCandidates?: ServerCommentCandidate[];
}

export function ReceiptsScreen({ onOpenChart }: { onOpenChart(): void }) {
  const [openId, setOpenId] = useState<string | null>("r2");
  const [tekiyoDraft, setTekiyoDraft] = useState(false);
  const [uke, setUke] = useState<DisplayUke | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const totalPoints = monthReceipts.reduce((s, r) => s + r.points, 0);
  const totalErrors = monthReceipts.reduce((s, r) => s + r.errors, 0);
  const totalWarnings = monthReceipts.reduce((s, r) => s + r.warnings, 0);

  // 算定サーバ（実点数）で算定→UKE生成。未起動ならブラウザのデモ点数にフォールバック。
  const handleServerExport = async () => {
    if (totalErrors > 0) {
      toast("エラー（提出ブロック）が残っています。解消してから出力してください", "error");
      return;
    }
    setBusy(true);
    try {
      const health = await checkHealth();
      if (!health.ok) {
        toast("算定サーバ未起動。`npm run serve` で起動すると実点数で算定します。今回はデモ点数で出力します", "info");
        return handleDemoExport();
      }
      const r = await generateReceipt(DEMO_ENCOUNTER);
      setUke({
        source: "算定サーバ（公式マスタの実点数）",
        text: r.recordsText,
        recordCount: r.recordCount,
        byteLength: r.byteLength,
        totalPoints: r.totalPoints,
        visitDays: r.visitDays,
        validation: r.validation,
        submittable: r.submittable,
        commentCandidates: r.commentCandidates,
      });
      downloadUkeBase64(r.ukeBase64);
      toast(
        r.submittable
          ? `実点数で RECEIPTS.UKE を生成（${r.totalPoints}点・${r.recordCount}レコード）。提出前自己点検OK`
          : `UKEを生成しましたが受付不能の指摘があります（提出前に修正が必要）`,
        r.submittable ? "success" : "error",
      );
    } catch (e) {
      toast(`サーバ算定に失敗: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // ブラウザ内のコアエンジン（⚠サンプル点数）でUKE生成
  const handleDemoExport = () => {
    try {
      const result = generateDemoUke();
      setUke({
        source: "ブラウザ・デモ（⚠サンプル点数）",
        text: result.text,
        recordCount: result.recordCount,
        byteLength: result.byteLength,
        totalPoints: result.totalPoints,
        visitDays: result.visitDays,
        validation: result.validation,
        submittable: result.submittable,
      });
      downloadUke(result.bytes);
      toast(`デモ点数で RECEIPTS.UKE を生成（${result.recordCount}レコード）`, result.submittable ? "success" : "error");
    } catch (e) {
      toast(`UKE生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  return (
    <div>
      <div className="stat-row">
        <div className="stat"><div className="label">2026年5月診療分</div><div className="value">{monthReceipts.length}<small>件</small></div></div>
        <div className="stat"><div className="label">合計点数</div><div className="value">{totalPoints.toLocaleString()}<small>点</small></div></div>
        <div className="stat"><div className="label" style={{ color: "var(--error)" }}>エラー（提出ブロック）</div><div className="value" style={{ color: "var(--error)" }}>{totalErrors}</div></div>
        <div className="stat"><div className="label" style={{ color: "var(--warn)" }}>警告（要確認）</div><div className="value" style={{ color: "var(--warn)" }}>{totalWarnings}</div></div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>レセプト一覧</h2>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button type="button" className="btn">一括チェックを再実行</button>
            <button
              type="button"
              className="btn primary"
              onClick={handleServerExport}
              disabled={busy}
              title="算定サーバ（npm run serve）で公式マスタの実点数で算定→記録条件仕様準拠のUKE生成→自己点検"
            >
              {busy ? "算定中…" : "実点数で算定・UKE出力"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleDemoExport}
              title="ブラウザ内のコアエンジン（⚠サンプル点数）でUKE生成"
            >
              デモ点数で出力
            </button>
          </div>
        </div>
        {uke && (
          <div className="card-body" style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
              生成された RECEIPTS.UKE（{uke.recordCount}レコード / {uke.byteLength}バイト・Shift_JIS・末尾EOF付き）
              <span className="chip" style={{ marginLeft: 8 }}>{uke.source}</span>
            </div>
            <div className="tiny muted" style={{ marginBottom: 6 }}>
              算定エンジンが確定した点数（合計 {uke.totalPoints} 点・診療実日数 {uke.visitDays} 日）を、月内の複数受診を
              1枚に集約し（同一診療行為は算定日情報にマージ）、記録条件仕様（歯科用）令和8年6月版の
              レコード定義どおりに直列化しています。
            </div>
            {uke.commentCandidates && uke.commentCandidates.length > 0 && (
              <div className="tiny muted" style={{ marginBottom: 6 }}>
                ✦ 別表Ⅰ 摘要欄コメント候補 {uke.commentCandidates.length} 件（記載要否は条件を確認）:{" "}
                {[...new Set(uke.commentCandidates.map((c) => c.displayText.slice(0, 16)))].slice(0, 3).join(" / ")}…
              </div>
            )}
            <div
              className="tiny"
              style={{ marginBottom: 8, color: uke.submittable ? "var(--ok, #2a7)" : "var(--error)", fontWeight: 700 }}
            >
              {uke.submittable
                ? `✓ 提出前自己点検（受付・事務点検ASP相当）に通りました（受付不能の指摘なし）`
                : `⚠ 自己点検で受付不能の指摘があります`}
            </div>
            {uke.validation.length > 0 && (
              <ul className="tiny" style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                {uke.validation.map((v, i) => (
                  <li key={i} style={{ color: v.severity === "reject" ? "var(--error)" : "var(--warn)" }}>
                    [{v.code}] {v.message}
                    {v.receiptNo ? `（レセプト${v.receiptNo}）` : ""}
                  </li>
                ))}
              </ul>
            )}
            <pre
              style={{
                margin: 0,
                padding: "10px 12px",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                fontSize: 11.5,
                lineHeight: 1.6,
                overflowX: "auto",
                whiteSpace: "pre",
              }}
            >
              {uke.text}
            </pre>
          </div>
        )}

        <table className="rece-table">
          <thead>
            <tr><th>患者</th><th>保険</th><th style={{ textAlign: "right" }}>点数</th><th>点検結果</th><th /></tr>
          </thead>
          <tbody>
            {monthReceipts.map((r) => (
              <tr className="clickable" key={r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <td style={{ fontWeight: 600 }}>{r.patient}</td>
                <td>{r.insurance}</td>
                <td className="num">{r.points.toLocaleString()}</td>
                <td>
                  {r.errors === 0 && r.warnings === 0 && <span className="chip ok">✓ OK</span>}
                  {r.errors > 0 && <span className="chip error">エラー {r.errors}</span>}{" "}
                  {r.warnings > 0 && <span className="chip warn">警告 {r.warnings}</span>}
                </td>
                <td className="tiny" style={{ textAlign: "right" }}>{openId === r.id ? "▲ 閉じる" : "▼ 詳細"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {openId && (
          <div className="card-body" style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <div className="muted" style={{ fontWeight: 700, marginBottom: 4 }}>
              {monthReceipts.find((r) => r.id === openId)?.patient} の点検結果
            </div>
            {(receiptIssues[openId] ?? []).length === 0 && (
              <div className="empty-note">指摘事項はありません。提出可能です。</div>
            )}
            {(receiptIssues[openId] ?? []).map((issue, i) => (
              <div className={`issue ${issue.severity}`} key={i}>
                <span className="badge">{issue.severity === "error" ? "エラー" : "警告"}</span>
                <span style={{ flex: 1 }}>{issue.message}</span>
                {issue.message.includes("摘要欄") && (
                  <button type="button" className="btn sm ghost-ai" onClick={() => setTekiyoDraft(!tekiyoDraft)}>✦ 摘要文案</button>
                )}
                <button type="button" className="btn sm" onClick={onOpenChart}>カルテへ</button>
              </div>
            ))}
            {tekiyoDraft && openId === "r3" && (
              <div className="ai-draft-box" style={{ padding: "12px 14px", marginTop: 10, fontSize: 12.5 }}>
                <div className="ai-note" style={{ marginBottom: 6 }}>✦ カルテ記載から生成した摘要欄の下書き（確認・編集のうえ反映）</div>
                {AI_TEKIYO_DRAFT}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn sm primary">摘要欄に反映</button>
                  <button type="button" className="btn sm">編集</button>
                </div>
              </div>
            )}
            <div className="ai-note" style={{ marginTop: 10 }}>
              ✦ 将来: AI が返戻理由を解析し、修正候補を提案します（Phase 3）
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
