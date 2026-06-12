/** 予約管理（アポイントブック）: ユニット×時間グリッド、処置種別の色分け。 */
import { useState } from "react";
import { todayAppointments, type Appointment } from "../data/mock.js";

const OPEN_HOUR = 9, CLOSE_HOUR = 18, SLOT_PX = 44; // 30分 = 44px
const UNITS = ["チェア 1", "チェア 2", "チェア 3（訪問兼用）"];

const KIND_COLORS: Record<Appointment["kind"], { bg: string; border: string }> = {
  初診: { bg: "#e3f3f1", border: "#0c7569" },
  再診: { bg: "#e3edf7", border: "#3b7bb8" },
  SPT: { bg: "#e9f5ea", border: "#2e9e4f" },
  自費: { bg: "#f4f1fe", border: "#7c5cf0" },
  訪問: { bg: "#fdf3e3", border: "#b54708" },
  急患: { bg: "#fef0ef", border: "#d92d20" },
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function AppointmentsScreen() {
  const [active, setActive] = useState<Appointment | null>(null);
  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);
  const bodyHeight = (CLOSE_HOUR - OPEN_HOUR) * 2 * SLOT_PX;

  return (
    <div>
      <div className="apo-toolbar">
        <button type="button" className="btn">◀ 前日</button>
        <span className="apo-date">2026年6月12日（金）</span>
        <button type="button" className="btn">翌日 ▶</button>
        <div style={{ marginLeft: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(Object.keys(KIND_COLORS) as Appointment["kind"][]).map((k) => (
            <span key={k} className="key tiny" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: KIND_COLORS[k].bg, border: `1.5px solid ${KIND_COLORS[k].border}` }} />
              {k}
            </span>
          ))}
        </div>
        <button type="button" className="btn primary" style={{ marginLeft: "auto" }}>＋ 予約を追加</button>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="apo-grid">
          <div className="apo-timecol" style={{ height: bodyHeight + 40 }}>
            <div className="apo-unithead" />
            {hours.map((h) => (
              <div key={h} className="apo-hour" style={{ height: SLOT_PX * 2 }}>{h}:00</div>
            ))}
          </div>
          {UNITS.map((unit, ui) => (
            <div key={unit} className="apo-unitcol">
              <div className="apo-unithead">{unit}</div>
              <div className="apo-unitbody" style={{ height: bodyHeight }}>
                {hours.map((h) => <div key={h} className="apo-line" style={{ top: (h - OPEN_HOUR) * 2 * SLOT_PX }} />)}
                {todayAppointments
                  .filter((a) => a.unit === ui)
                  .map((a) => {
                    const top = ((toMinutes(a.start) - OPEN_HOUR * 60) / 30) * SLOT_PX;
                    const height = (a.minutes / 30) * SLOT_PX - 4;
                    const c = KIND_COLORS[a.kind];
                    return (
                      <button
                        type="button"
                        key={a.id}
                        className={`apo-block ${active?.id === a.id ? "active" : ""}`}
                        style={{ top, height, background: c.bg, borderLeftColor: c.border }}
                        onClick={() => setActive(active?.id === a.id ? null : a)}
                      >
                        <span className="apo-time">{a.start} ・ {a.minutes}分</span>
                        <span className="apo-name">{a.patient}</span>
                        <span className="apo-note">{a.kind}{a.note ? ` — ${a.note}` : ""}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {active && (
        <div className="card" style={{ marginTop: 14, maxWidth: 560 }}>
          <div className="card-head">
            <h2>{active.start} {active.patient}</h2>
            <span className="chip" style={{ marginLeft: "auto" }}>{active.kind}</span>
          </div>
          <div className="card-body" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className="muted">{active.note}</span>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <button type="button" className="btn sm">カルテを開く</button>
              <button type="button" className="btn sm">変更</button>
              <button type="button" className="btn sm danger-ghost">キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
