/** 予約管理（アポイントブック）: ユニット×時間グリッド、処置種別の色分け、現在時刻ライン。 */
import { useEffect, useState } from "react";
import { todayAppointments, allPatients, type Appointment } from "../data/mock.js";

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

/** 予約の患者名 → 患者ID（カルテ遷移用）。一覧に無い名前（空き枠等）は null */
function patientIdOf(name: string): string | null {
  return allPatients.find((p) => p.name === name)?.id ?? null;
}

export function AppointmentsScreen({ onOpenPatientChart }: { onOpenPatientChart?: (patientId: string) => void }) {
  const [active, setActive] = useState<Appointment | null>(null);
  // 現在時刻（端末のローカル時刻）。1分ごとに更新してラインを動かす
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);
  const bodyHeight = (CLOSE_HOUR - OPEN_HOUR) * 2 * SLOT_PX;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const inHours = nowMin >= OPEN_HOUR * 60 && nowMin <= CLOSE_HOUR * 60;
  const nowTop = ((nowMin - OPEN_HOUR * 60) / 30) * SLOT_PX;
  const nowLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const openChart = (name: string) => {
    const id = patientIdOf(name);
    if (id && onOpenPatientChart) onOpenPatientChart(id);
  };

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
          <div className="apo-timecol" style={{ height: bodyHeight + 40, position: "relative" }}>
            <div className="apo-unithead" />
            {hours.map((h) => (
              <div key={h} className="apo-hour" style={{ height: SLOT_PX * 2 }}>{h}:00</div>
            ))}
            {inHours && (
              <div className="apo-now-time" style={{ top: 40 + nowTop }}>{nowLabel}</div>
            )}
          </div>
          {UNITS.map((unit, ui) => (
            <div key={unit} className="apo-unitcol">
              <div className="apo-unithead">{unit}</div>
              <div className="apo-unitbody" style={{ height: bodyHeight }}>
                {hours.map((h) => <div key={h} className="apo-line" style={{ top: (h - OPEN_HOUR) * 2 * SLOT_PX }} />)}
                {/* 現在時刻ライン（Googleカレンダー風・赤）。先頭列に丸印 */}
                {inHours && (
                  <div className="apo-now-line" style={{ top: nowTop }}>
                    {ui === 0 && <span className="apo-now-dot" />}
                  </div>
                )}
                {todayAppointments
                  .filter((a) => a.unit === ui)
                  .map((a) => {
                    const top = ((toMinutes(a.start) - OPEN_HOUR * 60) / 30) * SLOT_PX;
                    const height = (a.minutes / 30) * SLOT_PX - 4;
                    const c = KIND_COLORS[a.kind];
                    const hasChart = patientIdOf(a.patient) !== null;
                    return (
                      <button
                        type="button"
                        key={a.id}
                        className={`apo-block ${active?.id === a.id ? "active" : ""}`}
                        style={{ top, height, background: c.bg, borderLeftColor: c.border }}
                        title={hasChart ? `${a.patient} のカルテを開く` : "予約の詳細"}
                        onClick={() => (hasChart ? openChart(a.patient) : setActive(active?.id === a.id ? null : a))}
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
          <div className="card-body" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">{active.note}</span>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <button
                type="button"
                className="btn sm primary"
                disabled={patientIdOf(active.patient) === null}
                title={patientIdOf(active.patient) === null ? "この予約に紐づく患者カルテがありません" : ""}
                onClick={() => openChart(active.patient)}
              >
                🦷 カルテを開く
              </button>
              <button type="button" className="btn sm">変更</button>
              <button type="button" className="btn sm danger-ghost">キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
