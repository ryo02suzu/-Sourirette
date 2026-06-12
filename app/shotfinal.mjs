import { chromium } from "playwright";
import { preview } from "vite";
const server = await preview({ preview: { port: 4178 } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:4178");
await page.waitForTimeout(700);

// 歯面入力: 16を選択 → 歯面パネル → M咬合面トグル
await page.locator(".tooth-g").nth(2).click(); // 16
await page.waitForTimeout(300);
await page.click("button:has-text('M 近心')");
await page.click("button:has-text('O 咬合面')");
await page.waitForTimeout(300);
await page.locator(".card:has(.odon-wrap)").screenshot({ path: "../shots/21-surfaces.png" });

// 設定: 口管強を届出 → 診療画面の算定に加算が出る
await page.click(".nav-item:has-text('設定・管理')");
await page.waitForTimeout(300);
await page.locator(".switch").first().click();
await page.waitForTimeout(400);
await page.click(".nav-item:has-text('診療')");
await page.waitForTimeout(400);
await page.locator(".card:has(.claim-table)").first().screenshot({ path: "../shots/22-facility-bonus.png" });

// 訪問診療
await page.click(".nav-item:has-text('訪問診療')");
await page.waitForTimeout(400);
await page.click("button:has-text('✦ ケアマネ報告書')");
await page.waitForTimeout(300);
await page.screenshot({ path: "../shots/23-homevisit.png" });

// 文書発行
await page.click(".nav-item:has-text('文書発行')");
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/24-documents.png" });

// 技工（チャット送信 → トースト）
await page.click(".nav-item:has-text('技工')");
await page.waitForTimeout(400);
await page.fill(".card-body .search-box", "メタルの色調は問題ないので、このまま完成お願いします。セットは6/20予定です。");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
await page.screenshot({ path: "../shots/25-lab.png" });

// アンドゥ: 診療で処置削除 → 元に戻すトースト
await page.click(".nav-item:has-text('診療')");
await page.waitForTimeout(300);
await page.click("button:has-text('＋ デンタルX線撮影・診断')");
await page.waitForTimeout(200);
await page.locator(".claim-table .danger-ghost").first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/26-undo.png" });

await browser.close();
await server.close();
process.exit(0);
