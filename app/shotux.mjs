import { chromium } from "playwright";
import { preview } from "vite";
const server = await preview({ preview: { port: 4177 } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:4177");
await page.waitForTimeout(700);

// === ストーリー: AI下書き → P検 → 転記 → 警告解消 → 確定 ===
// 1) AI下書きを反映
await page.click(".rec-btn");
await page.waitForTimeout(900);
await page.click(".rec-btn");
await page.waitForSelector(".candidate", { timeout: 15000 });
await page.click("button:has-text('SOAP下書きをカルテに反映')");
while ((await page.locator(".candidate button:has-text('追加')").count()) > 0) {
  await page.locator(".candidate button:has-text('追加')").first().click();
  await page.waitForTimeout(120);
}
// 2) P検へ移動して音声入力 → 転記
await page.click(".nav-item:has-text('歯周検査')");
await page.click("button:has-text('音声入力')");
await page.waitForTimeout(8600);
await page.click("button:has-text('検査結果をカルテへ転記')");
await page.waitForTimeout(600);
// → 診療画面に自動遷移、トースト表示中
await page.screenshot({ path: "../shots/15-perio-transfer.png" });
// 3) 警告が消えているはずの算定プレビュー
await page.locator(".card:has(.claim-table)").first().screenshot({ path: "../shots/16-billing-clean.png" });
// 4) 確定 → トースト
await page.click("button:has-text('カルテを確定する')");
await page.waitForSelector(".hash-chip");
await page.waitForTimeout(300);
await page.screenshot({ path: "../shots/17-finalized-toast.png" });

// === ⌘K コマンドパレット ===
await page.keyboard.press("ControlOrMeta+k");
await page.waitForSelector(".palette");
await page.fill(".palette-inputrow input", "鈴木");
await page.waitForTimeout(250);
await page.screenshot({ path: "../shots/18-palette.png" });
await page.keyboard.press("Enter"); // 鈴木一郎の患者ページへ
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/19-palette-result.png" });

// === 当日ボードのステータス進行 ===
await page.click(".nav-item:has-text('当日ボード')");
await page.waitForTimeout(300);
await page.locator(".board-col").nth(1).locator(".patient-card").first().click(); // 受付済→診療中
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/20-board-advance.png" });

await browser.close();
await server.close();
process.exit(0);
