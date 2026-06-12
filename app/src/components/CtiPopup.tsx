/** CTI（電話着信連動）ポップアップ。着信と同時に患者情報を表示するデモ。 */
export function CtiPopup({ onClose, onOpenChart }: { onClose(): void; onOpenChart(): void }) {
  return (
    <div className="cti-popup">
      <div className="cti-head">
        <span className="cti-ring">📞</span>
        <div>
          <div className="tiny" style={{ color: "#9fd6cf" }}>着信中 ・ 090-XXXX-XXXX</div>
          <div className="cti-name">鈴木 一郎（67歳・男性）</div>
        </div>
        <button type="button" className="cti-close" onClick={onClose} aria-label="閉じる">×</button>
      </div>
      <div className="cti-body">
        <div className="pay-row"><span>前回来院</span><span className="v" style={{ fontSize: 12.5 }}>5/28 義歯調整</span></div>
        <div className="pay-row"><span>次回予約</span><span className="v" style={{ fontSize: 12.5 }}>本日 10:30（チェア1）</span></div>
        <div className="pay-row"><span>家族</span><span className="v" style={{ fontSize: 12.5 }}>鈴木 花（妻・当院通院中）</span></div>
        <div className="pay-row"><span>申し送り</span><span className="v" style={{ fontSize: 12.5 }}>📌 義歯調整中</span></div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn sm primary" style={{ flex: 1 }} onClick={onOpenChart}>カルテを開く</button>
          <button type="button" className="btn sm" style={{ flex: 1 }}>予約変更</button>
        </div>
      </div>
    </div>
  );
}
