/** レセプト画面（月次）: 点検 → エラー解消 → UKE出力 → オンライン請求。 */
import { useState } from "react";
import { monthReceipts, receiptIssues } from "../data/mock.js";
import { useToast } from "../components/toast.js";
import { downloadUke, generateDemoUke, type UkeExportResult } from "../uke-export.js";

const AI_TEKIYO_DRAFT =
  "義歯不適合により疼痛著明、咀嚼困難を認めたため同月2回目の調整を実施。" +
  "右下臼歯部顎堤の骨吸収が顕著であり、リライニングでは対応困難と判断した。";

export function ReceiptsScreen({ onOpenChart }: { onOpenChart(): void }) {
  const [openId, setOpenId] = useState<string | null>("r2");
  const [tekiyoDraft, setTekiyoDraft] = useState(false);
  const [uke, setUke] = useState<UkeExportResult | null>(null);
  const toast = useToast();
  const totalPoints = monthReceipts.reduce((s, r) => s + r.points, 0);
  const totalErrors = monthReceipts.reduce((s, r) => s + r.errors, 0);
  const totalWarnings = monthReceipts.reduce((s, r) => s + r.warnings, 0);

  // コアの算定エンジン→UKE橋渡し→Shift_JIS直列化を実際に通してファイルを生成する
  const handleUkeExport = () => {
    if (totalErrors > 0) {
      toast("エラー（提出ブロック）が残っています。解消してから出力してください", "error");
      return;
    }
    try {
      const result = generateDemoUke();
      setUke(result);
      downloadUke(result.bytes);
      toast(`RECEIPTS.UKE を生成しました（${result.recordCount}レコード / ${result.byteLength}バイト・Shift_JIS）`);
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
              className="btn"
              onClick={handleUkeExport}
              title="算定エンジン→記録条件仕様（歯科用）準拠のレコード生成→Shift_JIS出力までを実行します"
            >
              UKEファイル出力
            </button>
            <button type="button" className="btn primary" disabled title="エラー0件で有効化（オンライン請求は Phase 3）">
              オンライン請求
            </button>
          </div>
        </div>
        {uke && (
          <div className="card-body" style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
              生成された RECEIPTS.UKE（{uke.recordCount}レコード / {uke.byteLength}バイト・Shift_JIS・末尾EOF付き）
            </div>
            <div className="tiny muted" style={{ marginBottom: 6 }}>
              算定エンジンが確定した点数（合計 {uke.totalPoints} 点）を、記録条件仕様（歯科用）令和8年6月版の
              レコード定義どおりに直列化しています。⚠️点数はサンプル値（公式マスタ取込後に実点数へ）。
            </div>
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
