/**
 * AI サービス層。
 *
 * UI はこのインターフェースだけに依存する。本番実装は dentia と同じ2段構成
 * （文字起こし: Whisper 等 / 下書き生成: Claude API）をサーバ経由で呼ぶ。
 * このリポジトリの段階では、UX 検証用のモック実装（固定シナリオ＋遅延）を提供する。
 * AI の出力はすべて「下書き・候補」であり、確定は歯科医師の操作で行う。
 */

export interface SoapDraft {
  S: string;
  O: string;
  A: string;
  P: string;
}

export interface ProcedureCandidate {
  /** デモ用コード。本番は診療行為マスタの公式コード */
  code: string;
  name: string;
  teeth: string[];
  confidence: number; // 0..1
}

export interface DxCandidate {
  name: string;
  teeth: string[];
  confidence: number;
}

export interface AiDraftResult {
  transcript: string;
  soap: SoapDraft;
  procedures: ProcedureCandidate[];
  diagnoses: DxCandidate[];
}

export interface AiService {
  transcribeAndDraft(onStage: (stage: "transcribing" | "drafting") => void): Promise<AiDraftResult>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** デモシナリオ: 初診・右上の冷水痛 → 16 う蝕（C2）の想定 */
export class MockAiService implements AiService {
  async transcribeAndDraft(onStage: (stage: "transcribing" | "drafting") => void): Promise<AiDraftResult> {
    onStage("transcribing");
    await wait(1600);
    onStage("drafting");
    await wait(1800);
    return {
      transcript:
        "（医師）今日はどうされましたか。（患者）1週間前から右上の奥歯が冷たいもので" +
        "しみるんです。甘いものでも少し。（医師）拝見しますね…右上6番、遠心に齲窩があります。" +
        "打診痛はなし、温熱痛もなしと。冷水痛は一過性ですね。レントゲン撮って確認しましょう。" +
        "…象牙質まで達していますが歯髄までは届いていなさそうです。今日は麻酔をして詰め物の処置をします。",
      soap: {
        S: "1週間前より右上臼歯部の冷水痛を自覚。甘味でも軽度の疼痛。自発痛なし。",
        O: "16 遠心面に齲窩を認める。打診痛(−)、温熱痛(−)、冷水痛(+)一過性。デンタルX線にて象牙質に及ぶ透過像、歯髄への波及は認めず。",
        A: "16 う蝕症第2度（C2）の所見。歯髄炎への移行は現時点で認められない。",
        P: "16 浸潤麻酔下にてう蝕除去、コンポジットレジン充填。次回経過確認。ブラッシング指導を併施。",
      },
      procedures: [
        { code: "DEMO-SHOSHIN", name: "初診料", teeth: [], confidence: 0.98 },
        { code: "DEMO-XRAY", name: "デンタルX線撮影・診断", teeth: ["16"], confidence: 0.95 },
        { code: "DEMO-MASUI", name: "浸潤麻酔", teeth: ["16"], confidence: 0.93 },
        { code: "DEMO-CR", name: "う蝕処置＋CR充填（光重合）", teeth: ["16"], confidence: 0.91 },
        { code: "DEMO-TBI", name: "ブラッシング指導（実地指導）", teeth: [], confidence: 0.72 },
      ],
      diagnoses: [{ name: "う蝕症第2度（C2）", teeth: ["16"], confidence: 0.94 }],
    };
  }
}
