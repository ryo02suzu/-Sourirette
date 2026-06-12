import { useState } from "react";
import { TodayBoard } from "./screens/TodayBoard.js";
import { ClinicalScreen } from "./screens/Clinical.js";
import { CheckoutScreen } from "./screens/Checkout.js";
import { ReceiptsScreen } from "./screens/Receipts.js";
import { SettingsScreen } from "./screens/Settings.js";

type Screen = "home" | "clinical" | "checkout" | "receipts" | "settings";

const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: "home", label: "当日ボード", icon: "🏠" },
  { key: "clinical", label: "診療", icon: "🦷" },
  { key: "checkout", label: "会計", icon: "💴" },
  { key: "receipts", label: "レセプト", icon: "🧾" },
  { key: "settings", label: "設定・管理", icon: "⚙️" },
];

const TITLES: Record<Screen, string> = {
  home: "当日ボード",
  clinical: "診療 — 田中 花子",
  checkout: "会計",
  receipts: "レセプト（2026年5月診療分）",
  settings: "設定・管理",
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("clinical");

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
            <span className="chip brand">すずき歯科クリニック</span>
            <span className="chip">デモ環境</span>
          </div>
        </header>
        <main className="content">
          {screen === "home" && <TodayBoard onOpenChart={() => setScreen("clinical")} />}
          {screen === "clinical" && <ClinicalScreen />}
          {screen === "checkout" && <CheckoutScreen />}
          {screen === "receipts" && <ReceiptsScreen />}
          {screen === "settings" && <SettingsScreen />}
        </main>
      </div>
    </div>
  );
}
