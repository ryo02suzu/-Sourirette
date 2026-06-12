/** 設定・管理: 施設基準（算定エンジンに直結）・マスタ更新・監査ログ。 */
import { useToast } from "../components/toast.js";

const STANDARDS = [
  { code: "KOKANKYO", name: "口腔管理体制強化加算（口管強）", effect: "基本診療料への加算が算定に追加されます" },
  { code: "ANZEN", name: "歯科外来診療医療安全対策加算", effect: "（デモではルール未実装）" },
  { code: "GAIRAI-KAN", name: "歯科外来診療感染対策加算", effect: "（デモではルール未実装）" },
];

export function SettingsScreen({
  standards,
  onToggle,
}: {
  standards: string[];
  onToggle(code: string): void;
}) {
  const toast = useToast();

  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-head">
          <h2>施設基準の届出</h2>
          <span className="tiny" style={{ marginLeft: "auto" }}>切り替えると算定エンジンに即時反映されます</span>
        </div>
        <div className="card-body" style={{ paddingTop: 8 }}>
          {STANDARDS.map((s) => {
            const on = standards.includes(s.code);
            return (
              <div key={s.code} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.name}</div>
                  <div className="tiny">{s.effect}</div>
                </div>
                <span className={`chip ${on ? "ok" : ""}`}>{on ? "届出済み" : "未届出"}</span>
                <button
                  type="button"
                  className={`switch ${on ? "on" : ""}`}
                  role="switch"
                  aria-checked={on}
                  onClick={() => {
                    onToggle(s.code);
                    toast(
                      on
                        ? `「${s.name}」の届出を解除しました — 算定エンジンに反映`
                        : `「${s.name}」を届出済みにしました — 診療画面の算定に加算が追加されます`,
                      "info",
                    );
                  }}
                >
                  <span className="knob" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>マスタ更新</h2></div>
        <div className="card-body">
          <div className="pay-row"><span>診療行為マスタ</span><span className="v chip warn">デモ用サンプル</span></div>
          <div className="pay-row"><span>傷病名マスタ</span><span className="v chip warn">デモ用サンプル</span></div>
          <div className="tiny" style={{ marginTop: 10 }}>
            Phase 2 で支払基金の公式基本マスタ（毎月更新・適用期間付き）の自動取込に置き換わります。
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>監査ログ</h2></div>
        <div className="card-body">
          <div className="transcript-box" style={{ maxHeight: 140 }}>
            15:02 鈴木（歯科医師） 技工協議を記録 — 渡辺健 L-1024<br />
            14:32 鈴木（歯科医師） カルテ確定 — 田中花子 #000482<br />
            14:28 鈴木（歯科医師） AI下書きを反映 — 田中花子 #000482<br />
            14:05 山口（受付） オンライン資格確認 — 田中花子 #000482<br />
            13:58 山口（受付） 患者登録 — 田中花子 #000482
          </div>
          <div className="tiny" style={{ marginTop: 8 }}>全操作は追記専用の監査ログに記録されます（3省2ガイドライン対応）。</div>
        </div>
      </div>
    </div>
  );
}
