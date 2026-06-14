/**
 * ローカル算定サーバ（本番形のバックエンド MVP）。
 *
 * 公式エンジン工場で実点数・公式ルール付きエンジンを1度だけ構成し、HTTPで公開する。
 * 医院はこれを起動し、カルテ入力（受診・処置・傷病名）を投げると、実点数の算定・UKE生成・
 * 提出前点検・摘要欄候補が返る。Node標準のみ（ランタイム依存ゼロ）。
 *
 * 起動: npm run serve  （既定 http://localhost:8787）
 * エンドポイント:
 *   GET  /api/health   稼働確認＋取込件数
 *   POST /api/receipt  ProcessReceiptInput(JSON) → ProcessReceiptResult(JSON)
 *
 * ⚠️ これは医院がローカルで動かして「算定→UKE生成→自己点検」を実際に使うための仕組み。
 *    実提出（オンライン請求）には確認試験・閉域網・証明書が別途必要（コード外）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { loadOfficialEngine, type OfficialDataSources } from "./billing/official-engine.js";
import { processReceipt, type ProcessReceiptInput } from "./receipt/process.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const buf = (rel: string) => new Uint8Array(readFileSync(join(ROOT, rel)));

function loadEngine() {
  const sources: OfficialDataSources = {
    procedureMaster: buf("data/masters/h_ALL20260611.csv"),
    santeiKaisu: buf("data/tensuhyo/04_santei_kaisu.csv"),
    haihanSameDay: buf("data/tensuhyo/03-1_haihan.csv"),
    haihanSameMonth: buf("data/tensuhyo/03-2_haihan.csv"),
    hojoMaster: buf("data/tensuhyo/01_hojo_master.csv"),
    hokatsu: buf("data/tensuhyo/02_hokatsu.csv"),
    betsu1Csv: readFileSync(join(ROOT, "data/masters/betsu1_shika_20260601.csv"), "utf-8"),
    diseaseMasters: [buf("data/masters/b_20260601.txt"), buf("data/masters/hb_20260601.txt")],
  };
  return loadOfficialEngine(sources);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function startServer(port = Number(process.env.PORT) || 8787): ReturnType<typeof createServer> {
  process.stdout.write("公式エンジンを構成中…\n");
  const loaded = loadEngine();
  process.stdout.write(`構成完了: ${JSON.stringify(loaded.counts)}\n`);

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, {});
    const url = req.url ?? "/";
    try {
      if (req.method === "GET" && url === "/api/health") {
        return send(res, 200, { ok: true, counts: loaded.counts });
      }
      if (req.method === "POST" && url === "/api/receipt") {
        const input = JSON.parse(await readBody(req)) as ProcessReceiptInput;
        return send(res, 200, processReceipt(loaded, input));
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  server.listen(port, () => process.stdout.write(`算定サーバ起動: http://localhost:${port}\n`));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
