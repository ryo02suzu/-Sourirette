/**
 * 技工: クラウド技工指示書＋技工士チャット。
 * チャットでの協議はそのまま診療録に記録され、歯科技工士連携加算の算定要件
 * （協議の記録義務）を運用で満たす設計。
 */
import { useState } from "react";
import { useToast } from "../components/toast.js";

interface LabOrder {
  id: string;
  patient: string;
  item: string;
  lab: string;
  ordered: string;
  due: string;
  status: "製作中" | "出荷済" | "納品済";
  ios: boolean;
}

const ORDERS: LabOrder[] = [
  { id: "L-1024", patient: "渡辺 健", item: "47 全部鋳造冠（FMC）", lab: "スマイル技工所", ordered: "6/05", due: "6/19", status: "製作中", ios: true },
  { id: "L-1023", patient: "鈴木 一郎", item: "上顎 局部床義歯（修理）", lab: "スマイル技工所", ordered: "6/02", due: "6/13", status: "出荷済", ios: false },
  { id: "L-1019", patient: "小林 真由", item: "26 CAD/CAM冠", lab: "デジタルラボ東京", ordered: "5/28", due: "6/10", status: "納品済", ios: true },
];

interface ChatMsg { from: "clinic" | "lab"; name: string; text: string; time: string }

const INITIAL_CHAT: ChatMsg[] = [
  { from: "clinic", name: "鈴木（歯科医師）", text: "47 FMCの指示書を送付しました。IOSスキャンデータ添付済みです。マージンは歯肉縁下0.5mmでお願いします。", time: "6/05 18:42" },
  { from: "lab", name: "佐々木（歯科技工士）", text: "データ確認しました。遠心の印象が一部不明瞭ですが、スキャンの再撮影は必要でしょうか？マージンラインは追えそうです。", time: "6/06 09:15" },
  { from: "clinic", name: "鈴木（歯科医師）", text: "追えるようであればそのまま進めてください。咬合は対合とのクリアランスが薄いので、咬合面は金属厚み確保を優先で。", time: "6/06 12:30" },
];

export function LabScreen() {
  const toast = useToast();
  const [activeId, setActiveId] = useState("L-1024");
  const [chat, setChat] = useState<ChatMsg[]>(INITIAL_CHAT);
  const [draft, setDraft] = useState("");
  const active = ORDERS.find((o) => o.id === activeId)!;

  const send = () => {
    if (!draft.trim()) return;
    setChat((prev) => [...prev, { from: "clinic", name: "鈴木（歯科医師）", text: draft.trim(), time: "6/12 15:02" }]);
    setDraft("");
    toast("協議内容を診療録に記録しました（歯科技工士連携加算の要件）");
  };

  return (
    <div className="clinical" style={{ gridTemplateColumns: "minmax(380px, 5fr) minmax(360px, 4fr)" }}>
      <div className="card">
        <div className="card-head"><h2>技工指示書</h2><button type="button" className="btn sm primary" style={{ marginLeft: "auto" }}>＋ 新規指示書</button></div>
        <table className="rece-table">
          <thead><tr><th>No</th><th>患者 / 補綴物</th><th>技工所</th><th>納期</th><th>状態</th></tr></thead>
          <tbody>
            {ORDERS.map((o) => (
              <tr key={o.id} className={`clickable ${activeId === o.id ? "row-active" : ""}`} onClick={() => setActiveId(o.id)}>
                <td className="tiny">{o.id}</td>
                <td><strong>{o.patient}</strong><div className="tiny">{o.item}{o.ios && " ・ 📐IOS添付"}</div></td>
                <td className="tiny">{o.lab}</td>
                <td className="tiny">{o.due}</td>
                <td>
                  <span className={`chip ${o.status === "納品済" ? "ok" : o.status === "出荷済" ? "brand" : "warn"}`}>{o.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="tiny">
            💡 納期2日前にアラート。セット予約（{active.patient}: 6/20 14:00）と納期（{active.due}）の整合は自動チェックされます。
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>技工士との協議 — {active.id}</h2>
          <span className="chip ok" style={{ marginLeft: "auto" }} title="やり取りは自動で診療録に記録されます">記録＝加算要件OK</span>
        </div>
        <div className="card-body">
          <div className="chat-thread">
            {chat.map((m, i) => (
              <div key={i} className={`chat-msg ${m.from}`}>
                <div className="chat-meta">{m.name} ・ {m.time}</div>
                <div className="chat-bubble">{m.text}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              className="search-box"
              style={{ flex: 1, width: "auto", marginLeft: 0 }}
              placeholder="技工士へのメッセージ（送信と同時に診療録へ記録）"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button type="button" className="btn primary" onClick={send}>送信</button>
          </div>
        </div>
      </div>
    </div>
  );
}
