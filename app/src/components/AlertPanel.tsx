/**
 * 算定支援アラート一覧パネル。
 *
 * 設計（仕様準拠）: ブロックしない・すべて上書き可・歯科医師に委ねる。
 *   - 🔴error 確認必須 / 🟡warning 確認推奨 / 💡proposal 取りこぼし提案
 *   - レベル別に色分け、根拠(source)を必ず併記（指図でなく参考情報）
 *   - 各行に「承認(既読化)」＝次回から非表示 / 「無視(今回のみ)」
 *   - 1件ずつポップアップせず、レセプト単位で一覧に集約（総量制御）
 */
import { useState } from "react";
import { acknowledgeAlert, type ServerAlert } from "../services/algorithm-api.js";

const LEVEL: Record<ServerAlert["level"], { icon: string; label: string; color: string; order: number }> = {
  error: { icon: "🔴", label: "確認必須", color: "var(--error)", order: 0 },
  warning: { icon: "🟡", label: "確認推奨", color: "var(--warn)", order: 1 },
  proposal: { icon: "💡", label: "取りこぼし提案", color: "var(--muted, #888)", order: 2 },
};

export function AlertPanel({ alerts, onAcknowledged }: { alerts: ServerAlert[]; onAcknowledged?(): void }) {
  // 今回のみ無視したアラート（contextKey）
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = alerts
    .filter((a) => !dismissed.has(a.contextKey))
    .sort((x, y) => LEVEL[x.level].order - LEVEL[y.level].order);

  if (alerts.length === 0) return null;

  const counts = { error: 0, warning: 0, proposal: 0 } as Record<ServerAlert["level"], number>;
  for (const a of visible) counts[a.level]++;

  const ack = (a: ServerAlert) => {
    acknowledgeAlert(a.contextKey); // localStorageに既読保存（次回リクエストで抑制）
    setDismissed((d) => new Set(d).add(a.contextKey));
    onAcknowledged?.();
  };
  const ignore = (a: ServerAlert) => setDismissed((d) => new Set(d).add(a.contextKey));

  return (
    <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
        算定支援アラート（ブロックしません・最終判断は歯科医師）
        <span className="tiny" style={{ marginLeft: 8, color: "var(--error)" }}>🔴{counts.error}</span>
        <span className="tiny" style={{ marginLeft: 6, color: "var(--warn)" }}>🟡{counts.warning}</span>
        <span className="tiny" style={{ marginLeft: 6 }}>💡{counts.proposal}</span>
      </div>
      {visible.length === 0 ? (
        <div className="empty-note tiny">すべて確認済みです。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {visible.map((a) => (
            <div
              key={a.contextKey}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--surface)",
                borderLeft: `3px solid ${LEVEL[a.level].color}`,
              }}
            >
              <span title={LEVEL[a.level].label}>{LEVEL[a.level].icon}</span>
              <div style={{ flex: 1 }}>
                <div className="tiny" style={{ fontWeight: 700 }}>
                  {a.title}
                  <span className="tiny" style={{ marginLeft: 6, color: "var(--muted, #888)", fontWeight: 400 }}>根拠: {a.source}</span>
                </div>
                <div className="tiny" style={{ color: "var(--text)" }}>{a.message}</div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button type="button" className="btn sm" title="承認＝このパターンは次回から非表示" onClick={() => ack(a)}>承認</button>
                <button type="button" className="btn sm ghost" title="今回のみ非表示" onClick={() => ignore(a)}>無視</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
