/** 経営分析: 売上推移・保険/自費比率・✦キャンセル予測・✦リコールAI文案。 */
import { useState } from "react";
import { cancelRisks, monthlyRevenue, recallTargets } from "../data/mock.js";

function RevenueChart() {
  const W = 640, H = 220, PAD = 34;
  const max = Math.max(...monthlyRevenue.map((m) => m.hoken + m.jihi));
  const barW = (W - PAD * 2) / monthlyRevenue.length - 10;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="月別売上推移">
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <g key={r}>
          <line x1={PAD} x2={W - 8} y1={H - 28 - (H - 60) * r} y2={H - 28 - (H - 60) * r} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={PAD - 6} y={H - 25 - (H - 60) * r} textAnchor="end" fontSize={9.5} fill="var(--ink-3)">{Math.round((max * r) / 10) * 10}</text>
        </g>
      ))}
      {monthlyRevenue.map((m, i) => {
        const x = PAD + i * ((W - PAD * 2) / monthlyRevenue.length) + 5;
        const hh = ((H - 60) * m.hoken) / max;
        const jh = ((H - 60) * m.jihi) / max;
        const isCurrent = i === monthlyRevenue.length - 1;
        return (
          <g key={m.month} opacity={isCurrent ? 0.65 : 1}>
            <rect x={x} y={H - 28 - hh} width={barW} height={hh} rx={3} fill="#2a9d8f" />
            <rect x={x} y={H - 28 - hh - jh} width={barW} height={jh} rx={3} fill="#7c5cf0" />
            <text x={x + barW / 2} y={H - 13} textAnchor="middle" fontSize={10} fill="var(--ink-2)">{m.month}月</text>
            {isCurrent && <text x={x + barW / 2} y={H - 34 - hh - jh} textAnchor="middle" fontSize={9} fill="var(--ink-3)">途中</text>}
          </g>
        );
      })}
      <g transform={`translate(${PAD}, 12)`} fontSize={10.5}>
        <rect width={10} height={10} rx={2} fill="#2a9d8f" /><text x={14} y={9} fill="var(--ink-2)">保険</text>
        <rect x={50} width={10} height={10} rx={2} fill="#7c5cf0" /><text x={64} y={9} fill="var(--ink-2)">自費</text>
        <text x={110} y={9} fill="var(--ink-3)">（万円）</text>
      </g>
    </svg>
  );
}

const AI_RECALL_DRAFT = `中村様、すずき歯科クリニックです🦷
前回の検診から6ヶ月以上が経ちました。経過観察中の歯（右下6）の状態確認も兼ねて、
そろそろ定期検診はいかがでしょうか？
ご都合の良い時間をこちらから選べます → [予約リンク]
※このメッセージはAIが下書きし、スタッフが確認のうえ送信しています`;

export function AnalyticsScreen() {
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const total = monthlyRevenue.reduce((s, m) => s + m.hoken + m.jihi, 0);
  const jihiRate = Math.round((monthlyRevenue.reduce((s, m) => s + m.jihi, 0) / total) * 100);

  return (
    <div>
      <div className="stat-row">
        <div className="stat"><div className="label">直近12ヶ月 売上</div><div className="value">{total.toLocaleString()}<small>万円</small></div></div>
        <div className="stat"><div className="label">自費率</div><div className="value">{jihiRate}<small>%</small></div></div>
        <div className="stat"><div className="label">リコール率（3ヶ月）</div><div className="value">68<small>%</small></div></div>
        <div className="stat"><div className="label">キャンセル率（当月）</div><div className="value">6.2<small>%</small></div></div>
      </div>

      <div className="clinical" style={{ gridTemplateColumns: "minmax(480px, 6fr) minmax(340px, 4fr)" }}>
        <div className="card">
          <div className="card-head"><h2>月別売上推移（保険・自費）</h2></div>
          <div className="card-body"><RevenueChart /></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card ai-panel">
            <div className="card-head"><h2><span className="ai-mark">✦</span> キャンセル予測</h2><span className="chip ai" style={{ marginLeft: "auto" }}>デモ予測</span></div>
            <div className="card-body" style={{ paddingTop: 10 }}>
              {cancelRisks.map((c) => (
                <div className="candidate" key={c.slot} style={{ alignItems: "center" }}>
                  <div className="c-main">
                    <div className="c-name">{c.slot}</div>
                    <div className="c-meta">{c.reason}</div>
                  </div>
                  <span className="conf" style={{ color: c.risk > 0.6 ? "var(--error)" : "var(--warn)" }}>
                    {Math.round(c.risk * 100)}%
                  </span>
                </div>
              ))}
              <div className="ai-note">✦ リスクの高い枠へ事前確認メッセージの自動送信を提案します</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>リコール対象（{recallTargets.length}名）</h2></div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {recallTargets.map((r) => (
                <div key={r.name} style={{ borderBottom: "1px solid var(--line)", padding: "9px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{r.name}</strong>
                    <span className={`chip ${r.due.includes("超過") ? "warn" : ""}`} style={{ fontSize: 10.5 }}>{r.due}</span>
                    <button type="button" className="btn sm ghost-ai" style={{ marginLeft: "auto" }} onClick={() => setDraftFor(draftFor === r.name ? null : r.name)}>
                      ✦ 文案生成
                    </button>
                  </div>
                  <div className="tiny">{r.note}</div>
                  {draftFor === r.name && (
                    <div className="ai-draft-box" style={{ padding: "10px 12px", marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>
                      {AI_RECALL_DRAFT}
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button type="button" className="btn sm primary">確認して送信（LINE）</button>
                        <button type="button" className="btn sm">編集</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
