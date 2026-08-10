// himiyosh-theme.spec.js — 新デザインの回帰テスト(Playwright)
// 実行例:
//   1) リポジトリ直下で python3 -m http.server 8000
//   2) BASE_URL を配置先に合わせて調整し、npx playwright test himiyosh-theme.spec.js
// メモ: Info リポジトリ本体は依存フリー方針のため、このスペックは
//       JoJo 系プロジェクトと同様の Playwright 環境での実行を想定した参考実装です。
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8000/himiyosh-portfolio-redesign.html";

test.describe("カラーモード(夜藍 ⇄ 白妙)", () => {
  test("OSがダーク設定なら既定は夜藍", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(BASE_URL);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await expect(page.locator(".mode-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  test("OSがライト設定なら初回描画から白妙", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(BASE_URL);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "shirotae");
    await expect(page.locator(".mode-toggle")).toHaveAttribute("aria-pressed", "true");
  });

  test("トグルでモードと meta theme-color が連動する", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(BASE_URL);
    await page.locator(".mode-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "shirotae");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f4f1e9");
    await page.locator(".mode-toggle").click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0a111c");
  });

  test("イースターエッグ: 3秒長押しで暁が現れる", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(BASE_URL);
    const btn = page.locator(".mode-toggle");
    await btn.hover();
    await page.mouse.down();
    await page.waitForTimeout(3300);
    await page.mouse.up();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "akatsuki");
    // 直後のクリック抑止が効いた上で、次のクリックで夜藍へ戻る
    await btn.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  });
});

test.describe("アクセシビリティ挙動", () => {
  test.use({ reducedMotion: "reduce" });
  test("reduced-motion では見出しが即時に確定表示される", async ({ page }) => {
    await page.goto(BASE_URL);
    const line = page.locator(".hero .decode").first();
    await expect(line).toHaveText(await line.getAttribute("data-text"));
  });
});

test.describe("連絡導線", () => {
  test("プロフィールリンクが4件そろい、いずれも新しいタブで開く", async ({ page }) => {
    await page.goto(BASE_URL);
    const links = page.locator(".contact-links a");
    await expect(links).toHaveCount(4);
    for (const service of ["GITHUB", "ZENN", "QIITA", "NOTE"]) {
      const row = page.locator(".contact-links a", { hasText: service });
      await expect(row).toHaveAttribute("target", "_blank");
      await expect(row).toHaveAttribute("rel", /noopener/);
    }
  });
});
