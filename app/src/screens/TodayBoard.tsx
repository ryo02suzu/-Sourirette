/**
 * 当日ボード: 本日の患者の流れ（予約 → 受付 → 診療中 → 会計待ち → 完了）。
 * カードをタップするとステータスが次へ進む（受付業務のワンタップ運用）。
 */
import { useState } from "react";
import { todayPatients, type BoardPatient, type FlowStatus } from "../data/mock.js";
import { useToast } from "../components/toast.js";

const COLUMNS: { key: FlowStatus; label: string; icon: string }[] = [
  { key: "reserved", label: "予約", icon: "🗓" },
  { key: "checked_in", label: "受付済", icon: "🪪" },
  { key: "in_chair", label: "診療中", icon: "🦷" },
  { key: "waiting_pay", label: "会計待ち", icon: "💴" },
];

const NEXT: Record<FlowStatus, { status: FlowStatus | "done"; message: string }> = {
  reserved: { status: "checked_in", message: "を受付しました" },
  checked_in: { status: "in_chair", message: "の診療を開始しました" },
  in_chair: { status: "waiting_pay", message: "を会計待ちへ移動しました" },
  waiting_pay: { status: "done", message: "の会計が完了しました" },
};

export function TodayBoard({ onOpenChart, onOpenCheckout }: { onOpenChart(): void; onOpenCheckout(): void }) {
  const toast = useToast();
  const [patients, setPatients] = useState<BoardPatient[]>(todayPatients);
  const [doneCount, setDoneCount] = useState(3); // 本日すでに完了した患者（デモ）

  const advance = (p: BoardPatient) => {
    const next = NEXT[p.status];
    if (next.status === "done") {
      setPatients((prev) => prev.filter((x) => x.id !== p.id));
      setDoneCount((c) => c + 1);
    } else {
      const status = next.status;
      setPatients((prev) => prev.map((x) => (x.id === p.id ? { ...x, status } : x)));
    }
    toast(`${p.name}さん${next.message}`);
  };

  const visited = patients.filter((p) => p.status !== "reserved").length + doneCount;

  return (
    <div>
      <div className="stat-row">
        <div className="stat"><div className="label">本日の予約</div><div className="value">14<small>名</small></div></div>
        <div className="stat"><div className="label">来院済み</div><div className="value">{visited}<small>名</small></div></div>
        <div className="stat"><div className="label">会計完了</div><div className="value">{doneCount}<small>名</small></div></div>
        <div className="stat"><div className="label">本日の点数（暫定）</div><div className="value">4,612<small>点</small></div></div>
      </div>

      <div className="board">
        {COLUMNS.map((col) => {
          const items = patients.filter((p) => p.status === col.key);
          return (
            <div className="board-col" key={col.key}>
              <h3>{col.icon} {col.label} <span className="count">{items.length}</span></h3>
              <div className="col-body">
                {items.length === 0 && <div className="empty-note">なし</div>}
                {items.map((p) => (
                  <div
                    className={`patient-card ${p.status === "in_chair" ? "in-chair" : ""} ${p.status === "waiting_pay" ? "waiting-pay" : ""}`}
                    key={p.id}
                    onClick={() => advance(p)}
                    title={`タップで「${COLUMNS.find((c) => c.key === NEXT[p.status].status)?.label ?? "完了"}」へ`}
                  >
                    <div className="time">{p.time}</div>
                    <div className="pname">{p.name}</div>
                    <div className="meta">{p.age}歳 ・ {p.chief}</div>
                    <div className="tags">
                      {p.onshikaku ? <span className="chip ok">オン資済</span> : <span className="chip warn">資格未確認</span>}
                      {p.tags.map((t) => <span className="chip" key={t}>{t}</span>)}
                      {p.status === "in_chair" && (
                        <button
                          type="button"
                          className="btn sm primary"
                          style={{ marginLeft: "auto" }}
                          onClick={(e) => { e.stopPropagation(); onOpenChart(); }}
                        >
                          カルテ
                        </button>
                      )}
                      {p.status === "waiting_pay" && (
                        <button
                          type="button"
                          className="btn sm primary"
                          style={{ marginLeft: "auto" }}
                          onClick={(e) => { e.stopPropagation(); onOpenCheckout(); }}
                        >
                          会計へ
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="tiny" style={{ marginTop: 12 }}>💡 カードをタップするとステータスが次へ進みます（会計待ち→タップで完了）。</div>
    </div>
  );
}
