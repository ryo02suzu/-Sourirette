// スクリーンショット撮影スクリプト（開発用・コミット対象外）
import { chromium } from "playwright";
import { preview } from "vite";

const server = await preview({ preview: { port: 4173 } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:4173");
await page.waitForTimeout(800);

// 1. 診療画面（初期状態）
await page.screenshot({ path: "../shots/01-clinical.png" });

// 2. AIフロー: 録音 → 停止 → 生成 → 候補表示
await page.click(".rec-btn");
await page.waitForTimeout(1200);
await page.click(".rec-btn");
await page.waitForSelector(".candidate", { timeout: 15000 });
await page.waitForTimeout(300);
await page.screenshot({ path: "../shots/02-ai-review.png" });

// 3. SOAP反映 + 候補をすべて追加 → 算定エンジンが警告を出す状態
await page.click("button:has-text('SOAP下書きをカルテに反映')");
// 追加を押すとボタンが「✓」に変わるため、残りがなくなるまで先頭をクリック
while ((await page.locator(".candidate button:has-text('追加')").count()) > 0) {
  await page.locator(".candidate button:has-text('追加')").first().click();
  await page.waitForTimeout(150);
}
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/03-applied.png" });
await page.locator(".card:has(.claim-table)").first().screenshot({ path: "../shots/03b-billing.png" });

// 3c. カルテ確定（追記専用・ハッシュ付与）
await page.click("button:has-text('カルテを確定する')");
await page.waitForSelector(".hash-chip");
await page.locator(".card:has(.soap-field)").first().screenshot({ path: "../shots/03c-finalized.png" });

// 4. 当日ボード
await page.click(".nav-item:has-text('当日ボード')");
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/04-board.png" });

// 5. レセプト
await page.click(".nav-item:has-text('レセプト')");
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/05-receipts.png" });

// 6. 会計
await page.click(".nav-item:has-text('会計')");
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/06-checkout.png" });

await browser.close();
await server.close();
process.exit(0);
