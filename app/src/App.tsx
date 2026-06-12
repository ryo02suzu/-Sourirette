import { useState } from "react";
import { TodayBoard } from "./screens/TodayBoard.js";
import { AppointmentsScreen } from "./screens/Appointments.js";
import { PatientsScreen } from "./screens/Patients.js";
import { ClinicalScreen } from "./screens/Clinical.js";
import { PerioScreen } from "./screens/Perio.js";
import { CheckoutScreen } from "./screens/Checkout.js";
import { ReceiptsScreen } from "./screens/Receipts.js";
import { AnalyticsScreen } from "./screens/Analytics.js";
import { SettingsScreen } from "./screens/Settings.js";
import { CtiPopup } from "./components/CtiPopup.js";

type Screen =
  | "home" | "appointments" | "patients" | "clinical" | "perio"
  | "checkout" | "receipts" | "analytics" | "settings";

const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: "home", label: "当日ボード", icon: "🏠" },
  { key: "appointments", label: "予約", icon: "🗓" },
  { key: "patients", label: "患者", icon: "👥" },
  { key: "clinical", label: "診療", icon: "🦷" },
  { key: "perio", label: "歯周検査", icon: "📈" },
  { key: "checkout", label: "会計", icon: "💴" },
  { key: "receipts", label: "レセプト", icon: "🧾" },
  { key: "analytics", label: "経営分析", icon: "📊" },
  { key: "settings", label: "設定・管理", icon: "⚙️" },
];

const TITLES: Record<Screen, string> = {
  home: "当日ボード",
  appointments: "予約管理（アポイントブック）",
  patients: "患者管理",
  clinical: "診療 — 田中 花子",
  perio: "歯周検査（P検）— 佐藤 美咲",
  checkout: "会計",
  receipts: "レセプト（2026年5月診療分）",
  analytics: "経営分析",
  settings: "設定・管理",
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("clinical");
  const [cti, setCti] = useState(false);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          Sourirette
          <small>DENTAL EMR + CLAIMS</small>
        </div>
        <nav>
          {NAV.map((n) => (
            <button
              type="button"
              key={n.key}
              className={`nav-item ${screen === n.key ? "active" : ""}`}
              onClick={() => setScreen(n.key)}
            >
              <span className="icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="user">
          <div className="avatar">鈴</div>
          <div>
            <div className="name">鈴木 智也</div>
            <div className="role">歯科医師・管理者</div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{TITLES[screen]}</h1>
          <span className="date">2026年6月12日（金）</span>
          <div className="right">
            <button type="button" className="btn sm" onClick={() => setCti(true)}>📞 CTIデモ</button>
            <span className="chip brand">すずき歯科クリニック</span>
            <span className="chip">デモ環境</span>
          </div>
        </header>
        <main className="content">
          {screen === "home" && <TodayBoard onOpenChart={() => setScreen("clinical")} />}
          {screen === "appointments" && <AppointmentsScreen />}
          {screen === "patients" && <PatientsScreen onOpenChart={() => setScreen("clinical")} />}
          {screen === "clinical" && <ClinicalScreen />}
          {screen === "perio" && <PerioScreen />}
          {screen === "checkout" && <CheckoutScreen />}
          {screen === "receipts" && <ReceiptsScreen />}
          {screen === "analytics" && <AnalyticsScreen />}
          {screen === "settings" && <SettingsScreen />}
        </main>
      </div>

      {cti && <CtiPopup onClose={() => setCti(false)} onOpenChart={() => { setCti(false); setScreen("patients"); }} />}
    </div>
  );
}
