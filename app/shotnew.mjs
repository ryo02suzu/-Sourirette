import { chromium } from "playwright";
import { preview } from "vite";
const server = await preview({ preview: { port: 4176 } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:4176");
await page.waitForTimeout(700);

// 処方監査: アモキシシリン追加 → 禁忌エラー
await page.click("button:has-text('＋ 投薬（アモキシシリン）')");
await page.waitForTimeout(400);
await page.locator(".card:has(.claim-table)").first().screenshot({ path: "../shots/08-rx-audit.png" });

// P検: 音声入力デモを走らせてから撮影
await page.click(".nav-item:has-text('歯周検査')");
await page.waitForTimeout(400);
await page.click("button:has-text('音声入力')");
await page.waitForTimeout(8600); // スクリプト完走待ち
await page.screenshot({ path: "../shots/09-perio.png" });

// 予約
await page.click(".nav-item:has-text('予約')");
await page.waitForTimeout(400);
await page.locator(".apo-block").first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: "../shots/10-appointments.png" });

// 患者
await page.click(".nav-item:has-text('患者')");
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/11-patients.png" });

// 経営分析（リコール文案を開く）
await page.click(".nav-item:has-text('経営分析')");
await page.waitForTimeout(400);
await page.locator("button:has-text('✦ 文案生成')").first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: "../shots/12-analytics.png" });

// CTI ポップアップ
await page.click("button:has-text('CTIデモ')");
await page.waitForTimeout(400);
await page.screenshot({ path: "../shots/13-cti.png" });

// 会計（領収書プレビュー）
await page.click("button:has-text('×')"); // CTI閉じる
await page.click(".nav-item:has-text('会計')");
await page.waitForTimeout(300);
await page.click("button:has-text('領収書・診療明細書を発行')");
await page.waitForTimeout(300);
await page.screenshot({ path: "../shots/14-checkout-preview.png" });

await browser.close();
await server.close();
process.exit(0);
