#!/usr/bin/env node
import http from "http";
import net from "net";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const shots = path.join(__dirname, "shots");
fs.mkdirSync(shots, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let rel = urlPath === "/" ? "/index.html" : urlPath;
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function proxyAvailable() {
  return new Promise((resolve) => {
    const sock = net.connect(8791, "127.0.0.1", () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
}

async function launchBrowser() {
  const common = { channel: "chrome", headless: true };
  if (await proxyAvailable()) {
    return chromium.launch({
      ...common,
      proxy: { server: "http://127.0.0.1:8791", bypass: "127.0.0.1,localhost" }
    });
  }
  return chromium.launch(common);
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
  throw new Error(msg);
}

async function overflow(page, width) {
  await page.setViewportSize({ width, height: 800 });
  const info = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth
  }));
  const extra = Math.max(info.scrollWidth, info.bodyScroll) - info.clientWidth;
  if (extra > 1) fail("horizontal overflow at " + width + "px: +" + extra + " " + JSON.stringify(info));
}

async function main() {
  const { server, port } = await startServer();
  const url = "http://127.0.0.1:" + port + "/index.html";
  const browser = await launchBrowser();
  const results = [];

  async function shotPage(name, width, theme, extra) {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.addInitScript((t) => {
      localStorage.setItem("subzero-theme", t);
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await page.setViewportSize({ width, height: width <= 400 ? 844 : 900 });
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.evaluate(async () => {
      await Promise.all(
        [...document.images].map((img) => {
          if (img.complete) return;
          return new Promise((res) => {
            img.addEventListener("load", res, { once: true });
            img.addEventListener("error", res, { once: true });
          });
        })
      );
    });
    await page.waitForTimeout(200);
    if (extra) await extra(page);
    const file = path.join(shots, name);
    if (extra && extra.clip) {
      await page.locator(extra.clip).screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
    results.push(file);
    await page.close();
    return file;
  }

  try {
    await shotPage("desktop-1440-light.png", 1440, "light");
    await shotPage("desktop-1440-dark.png", 1440, "dark");
    await shotPage("mobile-390-light.png", 390, "light");
    await shotPage("mobile-390-dark.png", 390, "dark");

    const bookingExtra = async (page) => {
      await page.fill("#b-name", "Alex Rivera");
      await page.fill("#b-phone", "0491570156");
      await page.click("#time-pills button[data-value='Midday']");
      await page.click("#book-form button[type='submit']");
      await page.waitForSelector("#book-saved:not(.is-hidden)");
      await page.locator("#book").scrollIntoViewIfNeeded();
    };
    bookingExtra.clip = "#book";
    await shotPage("booking-success.png", 1440, "light", bookingExtra);

    const breakdownExtra = async (page) => {
      await page.locator("#quote").scrollIntoViewIfNeeded();
      const visible = await page.isVisible("#fault-block");
      if (!visible) fail("fault block hidden on Breakdown");
    };
    breakdownExtra.clip = "#quote";
    await shotPage("fault-breakdown.png", 1440, "light", breakdownExtra);

    const coolExtra = async (page) => {
      await page.locator("#quote").scrollIntoViewIfNeeded();
      await page.click('#job-type button[data-value="Cool-room or freezer room"]');
      await page.waitForSelector("#room-block:not(.is-hidden)");
      const hiddenFault = await page.locator("#fault-block").evaluate((el) => el.classList.contains("is-hidden"));
      if (!hiddenFault) fail("fault block still visible on cool-room");
    };
    coolExtra.clip = "#quote";
    await shotPage("fault-coolroom.png", 1440, "light", coolExtra);

    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.addInitScript(() => localStorage.setItem("subzero-theme", "light"));
    await page.goto(url, { waitUntil: "load", timeout: 60000 });

    await overflow(page, 390);
    await overflow(page, 320);

    await page.setViewportSize({ width: 390, height: 844 });
    const bar = await page.evaluate(() => {
      const el = document.querySelector(".sticky-call");
      const cs = getComputedStyle(el);
      const links = [...el.querySelectorAll("a")].map((a) => a.getBoundingClientRect());
      return {
        display: cs.display,
        flexWrap: cs.flexWrap,
        text: el.innerText.replace(/\s+/g, " ").trim(),
        height: el.getBoundingClientRect().height,
        tops: links.map((r) => Math.round(r.top)),
        widths: links.map((r) => r.width)
      };
    });
    if (bar.display === "none") fail("Call|Quote bar not shown at 390");
    if (bar.flexWrap !== "nowrap") fail("Call|Quote bar wraps: " + bar.flexWrap);
    if (new Set(bar.tops).size !== 1) fail("Call|Quote bar not a single line: " + JSON.stringify(bar));
    if (bar.height > 64) fail("Call|Quote bar too tall: " + bar.height);
    if (!/Call/i.test(bar.text) || !/Quote/i.test(bar.text)) fail("Call|Quote labels missing: " + bar.text);

    const before = await page.getAttribute("html", "data-theme");
    await page.click('[aria-label="Switch light/dark"]');
    const after = await page.getAttribute("html", "data-theme");
    if (!before || before === after) fail("theme toggle did not switch (" + before + " -> " + after + ")");
    const stored = await page.evaluate(() => localStorage.getItem("subzero-theme"));
    if (stored !== after) fail("theme not remembered in localStorage");
    await page.click('[aria-label="Switch light/dark"]');
    const back = await page.getAttribute("html", "data-theme");
    if (back !== before) fail("theme toggle did not switch back");

    const weekend = await page.evaluate(() => {
      const chips = [...document.querySelectorAll("#day-chips .chip")];
      return {
        count: chips.length,
        weekends: chips
          .filter((c) => /Sat|Sun/.test(c.textContent))
          .map((c) => ({ text: c.textContent.replace(/\s+/g, " ").trim(), disabled: c.disabled }))
      };
    });
    if (weekend.count !== 14) fail("expected 14 date chips, got " + weekend.count);
    if (!weekend.weekends.length) fail("no Sat/Sun chips to assert");
    if (weekend.weekends.some((w) => !w.disabled)) fail("weekend chip enabled: " + JSON.stringify(weekend.weekends));

    const srcs = await page.$$eval("img", (imgs) => imgs.map((i) => i.getAttribute("src")));
    const empty = srcs.filter((s) => !s);
    if (empty.length) fail("img missing src");
    const dup = srcs.filter((s, i) => srcs.indexOf(s) !== i);
    if (dup.length) fail("duplicate img src: " + dup.join(", "));

    const text = await page.innerText("body");
    const banned = [
      /placeholder/i,
      /\bTODO\b/i,
      /wireframe/i,
      /\bbrief\b/i,
      /L-0/i,
      /invented/i,
      /\bsample\b/i,
      /\bdemo\b/i,
      /template/i,
      /\bconcept\b/i,
      /illustrative/i,
      /\bAI\b/,
      /\bbot\b/i,
      /pricing/i,
      /\$\s*\d/,
      /stay on this page/i,
      /email us/i,
      /we[’']ll email/i,
      /calendar/i
    ];
    const hits = banned.filter((re) => re.test(text)).map((re) => String(re));
    if (hits.length) fail("banned visible text: " + hits.join(", "));

    const robots = await page.getAttribute('meta[name="robots"]', "content");
    if (robots !== "noindex,nofollow") fail("robots meta: " + robots);

    const md5 = results.map((file) => {
      const sum = crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
      return sum + "  " + path.relative(root, file);
    });
    fs.writeFileSync(path.join(shots, "MD5SUMS"), md5.join("\n") + "\n");
    console.log("PASS");
    console.log(md5.join("\n"));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
