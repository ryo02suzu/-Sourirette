/** 設定・管理（骨格）: 施設基準・マスタ更新・監査ログ。3省2ガイドライン対応の入口。 */
export function SettingsScreen() {
  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-head"><h2>施設基準の届出</h2><span className="tiny" style={{ marginLeft: "auto" }}>算定エンジンの分岐に反映されます</span></div>
        <div className="card-body">
          <div className="dx-list">
            <div className="dx-item"><span className="dx-name">口腔管理体制強化加算（口管強）</span><span className="dx-date">未届出</span></div>
            <div className="dx-item"><span className="dx-name">歯科外来診療医療安全対策加算</span><span className="dx-date">未届出</span></div>
          </div>
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
