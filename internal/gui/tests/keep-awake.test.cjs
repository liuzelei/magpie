// Run with Node's test runner and Playwright on the module path; see README.md.
// The desktop and browser use the same Prevent sleep menu. The choice
// changes mode and scope together and preserves the setting across reloads.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const { reach, watchSettingsReads, settingsDrawn } = require("./reader.cjs");

const assets = path.resolve(__dirname, "../assets");
const words = {
  en: ["Off", "Stay awake during gateway tasks", "Screen on during gateway tasks", "Screen on while Magpie runs"],
  zh: ["关闭", "网关任务时防休眠", "网关任务时常亮", "Magpie 运行时常亮"],
  "zh-TW": ["關閉", "閘道任務時防休眠", "閘道任務時常亮", "Magpie 執行時常亮"],
  ja: ["オフ", "ゲートウェイの処理中はスリープしない", "ゲートウェイの処理中は画面をオン", "Magpie の実行中は画面をオン"],
  de: ["Aus", "Bei Gateway-Aufgaben wach", "Bildschirm an bei Gateway-Aufgaben", "Bildschirm an, solange Magpie läuft"],
};

function serve(lang, web, posted, st) {
  const settings = () => ({ lang, theme: "light", searchVendors: [], searchAPIs: [], ...st });
  return async (r) => {
    const url = new URL(r.request().url());
    const json = (data, status = 200) => r.fulfill({ status, json: data });
    if (url.pathname === "/boot.js") return r.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:${web}};` });
    if (url.pathname === "/wails/runtime.js") return r.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings: settings() });
    if (url.pathname === "/api/settings") {
      if (r.request().method() === "POST") {
        const b = JSON.parse(r.request().postData());
        posted.push(b);
        Object.assign(st, b);
      }
      return json(settings());
    }
    if (url.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true, url: "http://127.0.0.1:3999" } });
    if (url.pathname === "/api/groups") return json({ models: [], groups: [], pools: [] });
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname === "/api/usage/quotas") return json([]);
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    await r.fulfill({ body: await fs.readFile(file), contentType });
  };
}

async function open(engine, lang, web, posted, st, t, width = 900) {
  const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width, height: 700 } })).newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", serve(lang, web, posted, st));
  await watchSettingsReads(page);
  await page.goto("http://magpie.test/?view=settings&tab=general");
  await settingsDrawn(page); // rows found are the ones that stay (#1659)
  await page.locator("#setPage-general .row.pref").first().waitFor();
  return { page, errors };
}

async function choose(page, name) {
  await page.locator("#keepAwakePick").click();
  await page.locator(".proto-menu").getByText(name, { exact: true }).click();
  await page.waitForFunction(() => prefsBusy === 0);
  assert.equal(await page.locator("#keepAwakePick").innerText(), name);
}

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  test(`${engine}: continuous display is a direct choice when the gateway is paused`, async (t) => {
    const posted = [], st = { keepAwake: true, keepAwakeDisplay: true, gatewayPaused: true };
    const { page, errors } = await open(engine, "zh", false, posted, st, t, 440);
    const pick = page.locator("#keepAwakePick");
    assert.equal(await pick.innerText(), "网关任务时常亮");
    assert.equal(await page.locator("#keepAwakeScopeRow").count(), 0);
    await reach(page, pick);
    await choose(page, "Magpie 运行时常亮");
    assert.equal(posted.at(-1).keepAwake, true);
    assert.equal(posted.at(-1).keepAwakeDisplay, true);
    assert.equal(posted.at(-1).keepAwakeAlways, true);
    await page.reload();
    await settingsDrawn(page);
    assert.equal(await pick.innerText(), "Magpie 运行时常亮");
    await reach(page, pick);
    await choose(page, "网关任务时防休眠");
    assert.equal(posted.at(-1).keepAwakeAlways, false);
    assert.equal(posted.at(-1).keepAwakeDisplay, false);
    assert.deepEqual(errors, []);
  });

  for (const [lang, options] of Object.entries(words)) for (const width of [900, 440]) {
    test(`${engine} ${lang} ${width}px: Prevent sleep modes fit and save from one menu`, async (t) => {
      const posted = [], st = {};
      const { page, errors } = await open(engine, lang, false, posted, st, t, width);
      const pick = page.locator("#keepAwakePick");
      const [off, system, display, continuous] = options;
      assert.equal(await pick.innerText(), off);
      // Scroll like the reader, keeping the button clear of the sticky heading.
      await page.mouse.move(width / 2, 350);
      const atEnd = () => page.evaluate(() => {
        const view = document.querySelector("#view-settings");
        return view.scrollTop + view.clientHeight >= view.scrollHeight - 1;
      });
      for (let i = 0; i < 20 && !(await atEnd()); i++) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(150);
      }
      const scroll = () => page.locator("#view-settings").evaluate((view) => view.scrollTop);
      const before = await scroll();
      const keys = ["keepAwake", "keepAwakeDisplay", "keepAwakeAlways"];
      for (const [name, want] of [
        [system, [true, false, false]],
        [display, [true, true, false]],
        [continuous, [true, true, true]],
        [off, [false, false, false]],
      ]) {
        await choose(page, name);
        assert.deepEqual(keys.map((k) => posted.at(-1)[k]), want);
        assert(await pick.locator("span").evaluate((label) => label.scrollWidth <= label.clientWidth + 1), name + " was clipped");
        assert.equal(await scroll(), before, "picking a mode moved the page");
      }
      assert.deepEqual(errors, []);
    });
  }

  test(`${engine}: a browser shows a saved continuous system-only preference`, async (t) => {
    const { page, errors } = await open(engine, "en", true, [], { keepAwake: true, keepAwakeAlways: true }, t);
    assert.equal(await page.locator("#keepAwakePick").innerText(), "Stay awake while Magpie runs");
    assert.deepEqual(errors, []);
  });
}
