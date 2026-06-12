/** レセプト画面（月次）: 点検 → エラー解消 → UKE出力 → オンライン請求。 */
import { useState } from "react";
import { monthReceipts, receiptIssues } from "../data/mock.js";

export function ReceiptsScreen() {
  const [openId, setOpenId] = useState<string | null>("r2");
  const totalPoints = monthReceipts.reduce((s, r) => s + r.points, 0);
  const totalErrors = monthReceipts.reduce((s, r) => s + r.errors, 0);
  const totalWarnings = monthReceipts.reduce((s, r) => s + r.warnings, 0);

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
              disabled
              title="記録条件仕様（歯科用）の取込後に有効化されます（Phase 3）"
            >
              UKEファイル出力
            </button>
            <button type="button" className="btn primary" disabled title="エラー0件で有効化（オンライン請求は Phase 3）">
              オンライン請求
            </button>
          </div>
        </div>
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
                <button type="button" className="btn sm">カルテへ</button>
              </div>
            ))}
            <div className="ai-note" style={{ marginTop: 10 }}>
              ✦ 将来: AI が返戻理由を解析し、修正候補を提案します（Phase 3）
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
