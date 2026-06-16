/** 患者管理: 検索一覧 → 患者サマリ（申し送り付箋・来院履歴・リコール）。 */
import { useEffect, useMemo, useState } from "react";
import { allPatients, visitHistory } from "../data/mock.js";

export function PatientsScreen({
  onOpenChart,
  focus,
}: {
  onOpenChart(id?: string): void;
  focus?: { id: string; nonce: number } | null;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>("p2");

  // コマンドパレット（⌘K）から患者が選ばれたら該当患者を開く
  useEffect(() => {
    if (focus) {
      setActiveId(focus.id);
      setQuery("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return allPatients;
    return allPatients.filter(
      (p) => p.name.includes(q) || p.kana.includes(q) || p.chartNo.includes(q),
    );
  }, [query]);

  const active = allPatients.find((p) => p.id === activeId) ?? null;
  const history = active ? visitHistory[active.id] ?? [] : [];

  return (
    <div className="clinical" style={{ gridTemplateColumns: "minmax(420px, 5fr) minmax(360px, 4fr)" }}>
      <div className="card">
        <div className="card-head">
          <h2>患者一覧（{filtered.length}名）</h2>
          <input
            className="search-box"
            placeholder="氏名・カナ・カルテ番号で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <table className="rece-table">
          <thead>
            <tr><th>カルテNo</th><th>氏名</th><th>年齢</th><th>最終来院</th><th>リコール</th><th /></tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className={`clickable ${activeId === p.id ? "row-active" : ""}`} onClick={() => setActiveId(p.id)}>
                <td className="tiny">{p.chartNo}</td>
                <td style={{ fontWeight: 600 }}>{p.name}<div className="tiny">{p.kana}</div></td>
                <td>{p.age}</td>
                <td className="tiny">{p.lastVisit}</td>
                <td>
                  {p.recallDue === null ? <span className="tiny">—</span> :
                    p.recallDue.includes("超過") || p.recallDue < "2026-06-12"
                      ? <span className="chip warn">{p.recallDue}</span>
                      : <span className="tiny">{p.recallDue}</span>}
                </td>
                <td>{p.tags.map((t) => <span className="chip" key={t} style={{ marginRight: 4 }}>{t}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h2>{active.name}（{active.age}歳・{active.sex === "F" ? "女性" : "男性"}）</h2>
              <button type="button" className="btn sm primary" style={{ marginLeft: "auto" }} onClick={() => onOpenChart(active.id)}>カルテを開く</button>
            </div>
            <div className="card-body">
              <div className="pay-row"><span>カルテ番号</span><span className="v">{active.chartNo}</span></div>
              <div className="pay-row"><span>保険</span><span className="v" style={{ fontSize: 13 }}>{active.insurance}</span></div>
              <div className="pay-row"><span>最終来院</span><span className="v" style={{ fontSize: 13 }}>{active.lastVisit}</span></div>
              <div className="pay-row"><span>次回リコール</span><span className="v" style={{ fontSize: 13 }}>{active.recallDue ?? "未設定"}</span></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>申し送り（院内付箋）</h2><button type="button" className="btn sm" style={{ marginLeft: "auto" }}>＋</button></div>
            <div className="card-body">
              {active.notes.length === 0 && <div className="empty-note">申し送りはありません</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {active.notes.map((n) => (
                  <div className="sticky-note" key={n}>📌 {n}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>来院履歴</h2></div>
            <div className="card-body">
              {history.length === 0 && <div className="empty-note">履歴データなし（デモ）</div>}
              <div className="timeline">
                {history.map((h) => (
                  <div className="timeline-item" key={h.date}>
                    <div className="timeline-dot" />
                    <div>
                      <div className="tiny">{h.date}</div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{h.summary}</div>
                      <div className="tiny">{h.points} 点</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
