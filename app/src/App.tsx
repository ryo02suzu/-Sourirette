import { useEffect, useMemo, useState } from "react";
import { TodayBoard } from "./screens/TodayBoard.js";
import { AppointmentsScreen } from "./screens/Appointments.js";
import { PatientsScreen } from "./screens/Patients.js";
import { ClinicalScreen } from "./screens/Clinical.js";
import { PerioScreen } from "./screens/Perio.js";
import { CheckoutScreen } from "./screens/Checkout.js";
import { ReceiptsScreen } from "./screens/Receipts.js";
import { AnalyticsScreen } from "./screens/Analytics.js";
import { SettingsScreen } from "./screens/Settings.js";
import { HomeVisitScreen } from "./screens/HomeVisit.js";
import { DocumentsScreen } from "./screens/Documents.js";
import { LabScreen } from "./screens/Lab.js";
import { CtiPopup } from "./components/CtiPopup.js";
import { ToastProvider } from "./components/toast.js";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette.js";
import { allPatients } from "./data/mock.js";

type Screen =
  | "home" | "appointments" | "patients" | "clinical" | "perio"
  | "homevisit" | "documents" | "lab"
  | "checkout" | "receipts" | "analytics" | "settings";

const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: "home", label: "当日ボード", icon: "🏠" },
  { key: "appointments", label: "予約", icon: "🗓" },
  { key: "patients", label: "患者", icon: "👥" },
  { key: "clinical", label: "診療", icon: "🦷" },
  { key: "perio", label: "歯周検査", icon: "📈" },
  { key: "homevisit", label: "訪問診療", icon: "🚗" },
  { key: "documents", label: "文書発行", icon: "📄" },
  { key: "lab", label: "技工", icon: "⚒️" },
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
  perio: "歯周検査（P検）— 田中 花子",
  homevisit: "訪問診療（医療・介護同時算定）",
  documents: "文書発行",
  lab: "技工（クラウド技工指示書）",
  checkout: "会計",
  receipts: "レセプト（2026年5月診療分）",
  analytics: "経営分析",
  settings: "設定・管理",
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("clinical");
  const [cti, setCti] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** P検 → 診療画面への転記（nonce で1回ずつ適用） */
  const [perioImport, setPerioImport] = useState<{ text: string; nonce: number } | null>(null);
  /** コマンドパレットから患者を開く */
  const [focusPatient, setFocusPatient] = useState<{ id: string; nonce: number } | null>(null);
  /** 届出済みの施設基準（設定画面 ⇄ 算定エンジン連動） */
  const [facilityStandards, setFacilityStandards] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      ...NAV.map((n) => ({
        group: "画面へ移動",
        label: n.label,
        icon: n.icon,
        run: () => setScreen(n.key),
      })),
      ...allPatients.map((p) => ({
        group: "患者を開く",
        label: `${p.name}`,
        icon: "👤",
        hint: `${p.kana} ・ ${p.chartNo}`,
        run: () => {
          setFocusPatient({ id: p.id, nonce: Date.now() });
          setScreen("patients");
        },
      })),
    ],
    [],
  );

  const show = (k: Screen): React.CSSProperties => (screen === k ? {} : { display: "none" });

  return (
    <ToastProvider>
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
          <button type="button" className="nav-item" onClick={() => setPaletteOpen(true)}>
            <span className="icon">🔍</span>検索 <kbd className="kbd-dark">⌘K</kbd>
          </button>
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
          {/* 全画面をマウントしたまま表示切替（入力途中の状態を失わない） */}
          <main className="content">
            <div style={show("home")}><TodayBoard onOpenChart={() => setScreen("clinical")} onOpenCheckout={() => setScreen("checkout")} /></div>
            <div style={show("appointments")}><AppointmentsScreen /></div>
            <div style={show("patients")}><PatientsScreen onOpenChart={() => setScreen("clinical")} focus={focusPatient} /></div>
            <div style={show("clinical")}><ClinicalScreen perioImport={perioImport} facilityStandards={facilityStandards} /></div>
            <div style={show("perio")}>
              <PerioScreen
                onTransfer={(text) => {
                  setPerioImport({ text, nonce: Date.now() });
                  setScreen("clinical");
                }}
              />
            </div>
            <div style={show("homevisit")}><HomeVisitScreen /></div>
            <div style={show("documents")}><DocumentsScreen /></div>
            <div style={show("lab")}><LabScreen /></div>
            <div style={show("checkout")}><CheckoutScreen /></div>
            <div style={show("receipts")}><ReceiptsScreen onOpenChart={() => setScreen("clinical")} /></div>
            <div style={show("analytics")}><AnalyticsScreen /></div>
            <div style={show("settings")}>
              <SettingsScreen
                standards={facilityStandards}
                onToggle={(code) =>
                  setFacilityStandards((prev) =>
                    prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
                  )
                }
              />
            </div>
          </main>
        </div>

        {cti && <CtiPopup onClose={() => setCti(false)} onOpenChart={() => { setCti(false); setScreen("patients"); }} />}
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      </div>
    </ToastProvider>
  );
}
