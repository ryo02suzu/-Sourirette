/** 当日ボード: 本日の患者の流れ（予約 → 受付 → 診療中 → 会計待ち）をひと目で。 */
import { todayPatients, type FlowStatus } from "../data/mock.js";

const COLUMNS: { key: FlowStatus; label: string; icon: string }[] = [
  { key: "reserved", label: "予約", icon: "🗓" },
  { key: "checked_in", label: "受付済", icon: "🪪" },
  { key: "in_chair", label: "診療中", icon: "🦷" },
  { key: "waiting_pay", label: "会計待ち", icon: "💴" },
];

export function TodayBoard({ onOpenChart }: { onOpenChart(): void }) {
  return (
    <div>
      <div className="stat-row">
        <div className="stat"><div className="label">本日の予約</div><div className="value">14<small>名</small></div></div>
        <div className="stat"><div className="label">来院済み</div><div className="value">4<small>名</small></div></div>
        <div className="stat"><div className="label">オン資確認済</div><div className="value">3<small>/4</small></div></div>
        <div className="stat"><div className="label">本日の点数（暫定）</div><div className="value">4,612<small>点</small></div></div>
      </div>

      <div className="board">
        {COLUMNS.map((col) => {
          const items = todayPatients.filter((p) => p.status === col.key);
          return (
            <div className="board-col" key={col.key}>
              <h3>{col.icon} {col.label} <span className="count">{items.length}</span></h3>
              <div className="col-body">
                {items.length === 0 && <div className="empty-note">なし</div>}
                {items.map((p) => (
                  <div
                    className={`patient-card ${p.status === "in_chair" ? "in-chair" : ""} ${p.status === "waiting_pay" ? "waiting-pay" : ""}`}
                    key={p.id}
                    onClick={p.status === "in_chair" ? onOpenChart : undefined}
                    title={p.status === "in_chair" ? "カルテを開く" : undefined}
                  >
                    <div className="time">{p.time}</div>
                    <div className="pname">{p.name}</div>
                    <div className="meta">{p.age}歳 ・ {p.chief}</div>
                    <div className="tags">
                      {p.onshikaku ? <span className="chip ok">オン資済</span> : <span className="chip warn">資格未確認</span>}
                      {p.tags.map((t) => <span className="chip" key={t}>{t}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
