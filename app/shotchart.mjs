import { chromium } from "playwright";
import { preview } from "vite";
const server = await preview({ preview: { port: 4175 } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:4175");
await page.waitForTimeout(700);
// 歯式カードのクローズアップ（ホバー時ツールチップも）
await page.locator(".tooth-g").nth(2).hover(); // 16 う蝕
await page.waitForTimeout(300);
await page.locator(".card:has(.odon-wrap)").screenshot({ path: "../shots/07-toothchart.png" });
// 歯を2本選択した状態
await page.locator(".tooth-g").nth(4).click();
await page.locator(".tooth-g").nth(5).click();
await page.waitForTimeout(250);
await page.locator(".card:has(.odon-wrap)").screenshot({ path: "../shots/07b-toothchart-selected.png" });
await page.screenshot({ path: "../shots/01-clinical.png" });
await browser.close();
await server.close();
process.exit(0);
