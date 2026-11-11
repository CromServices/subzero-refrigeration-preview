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

async function galleryFilled(page, width) {
  await page.setViewportSize({ width, height: width <= 400 ? 844 : 900 });
  await page.locator(".masonry").scrollIntoViewIfNeeded();
  const report = await page.evaluate(() => {
    const root = document.querySelector(".masonry");
    const cs = getComputedStyle(root);
    const gap = parseFloat(cs.columnGap || cs.gap) || 0;
    const box = root.getBoundingClientRect();
    const items = [...root.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    });
    const rows = [];
    items.forEach((it) => {
      let row = rows.find((r) => Math.abs(r.top - it.top) < 3);
      if (!row) {
        row = { top: it.top, items: [] };
        rows.push(row);
      }
      row.items.push(it);
    });
    rows.sort((a, b) => a.top - b.top);
    const issues = [];
    rows.forEach((row, i) => {
      row.items.sort((a, b) => a.left - b.left);
      if (Math.abs(row.items[0].left - box.left) > 2) {
        issues.push("row " + i + " does not start at the left edge");
      }
      const last = row.items[row.items.length - 1];
      if (Math.abs(last.right - box.right) > 2) {
        issues.push("row " + i + " does not end at the right edge");
      }
      for (let n = 1; n < row.items.length; n++) {
        const space = row.items[n].left - row.items[n - 1].right;
        if (space > gap + 2) issues.push("row " + i + " empty column gap " + space);
      }
    });
    return { width: box.width, rows: rows.map((r) => r.items.length), issues };
  });
  if (report.issues.length) fail("gallery empty cells at " + width + "px: " + JSON.stringify(report));
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
    for (const w of [1440, 1024, 768, 390, 320]) await galleryFilled(page, w);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const chrome = await page.evaluate(() => {
      const header = document.querySelector("header.site");
      const logo = document.querySelector("header.site .logo");
      const nav = document.querySelector("nav.main");
      const theme = document.querySelector(".theme-toggle");
      const eyebrow = document.querySelector(".hero .eyebrow");
      const hero = document.querySelector(".hero");
      const call = document.querySelector(".sticky-call a.call");
      const quote = document.querySelector(".sticky-call a.quote");
      const hb = header.getBoundingClientRect();
      const lb = logo.getBoundingClientRect();
      const nb = nav.getBoundingClientRect();
      const tb = theme.getBoundingClientRect();
      const eb = eyebrow.getBoundingClientRect();
      const links = [...nav.querySelectorAll("a")].filter((a) => getComputedStyle(a).display !== "none");
      const linkTops = links.map((a) => Math.round(a.getBoundingClientRect().top));
      const csCall = getComputedStyle(call);
      const csQuote = getComputedStyle(quote);
      const rgb = (s) => s.replace(/\s/g, "");
      return {
        headerSticky: getComputedStyle(header).position,
        logoTop: Math.round(lb.top),
        themeTop: Math.round(tb.top),
        logoLeft: lb.left,
        themeRight: tb.right,
        navTop: Math.round(nb.top),
        navLeft: nb.left,
        headerBottom: hb.bottom,
        eyebrowTop: eb.top,
        heroMin: getComputedStyle(hero).minHeight,
        copyJustify: getComputedStyle(document.querySelector(".hero-copy")).justifyContent,
        linkTops,
        linkCount: links.length,
        callBg: rgb(csCall.backgroundColor),
        callColor: rgb(csCall.color),
        quoteBg: rgb(csQuote.backgroundColor),
        quoteColor: rgb(csQuote.color),
        quoteBorder: csQuote.borderTopWidth,
        callW: call.getBoundingClientRect().width,
        quoteW: quote.getBoundingClientRect().width
      };
    });
    if (chrome.headerSticky !== "sticky") fail("header not sticky at 390");
    if (Math.abs(chrome.logoTop - chrome.themeTop) > 8) fail("logo and theme not on row 1: " + JSON.stringify(chrome));
    if (chrome.navTop <= chrome.logoTop + 8) fail("nav not on row 2 below logo: " + JSON.stringify(chrome));
    if (new Set(chrome.linkTops).size !== 1) fail("nav links not one line: " + JSON.stringify(chrome.linkTops));
    if (chrome.linkCount !== 4) fail("expected 4 compact nav links, got " + chrome.linkCount);
    const heroGap = chrome.eyebrowTop - chrome.headerBottom;
    if (heroGap < 24 || heroGap > 44) fail("hero gap under header should be ~32px, got " + heroGap);
    if (chrome.copyJustify === "center") fail("hero still vertically centred on mobile");
    if (!/rgb\(0,\s*129,\s*159\)/.test(chrome.callBg) && chrome.callBg !== "rgb(0,129,159)") fail("Call is not cyan: " + chrome.callBg);
    if (chrome.quoteBg !== "rgb(255,255,255)") fail("Quote is not white: " + chrome.quoteBg);
    if (parseFloat(chrome.quoteBorder) < 1) fail("Quote missing 1px border");
    if (Math.abs(chrome.callW - chrome.quoteW) > 2) fail("Call and Quote not equal width: " + chrome.callW + " " + chrome.quoteW);

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

    async function stickyAt(width) {
      await page.setViewportSize({ width, height: width <= 400 ? 844 : 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => window.scrollTo(0, 1500));
      await page.waitForTimeout(80);
      const info = await page.evaluate(() => {
        const header = document.querySelector("header.site");
        const bar = document.querySelector(".sticky-call");
        const hr = header.getBoundingClientRect();
        const br = bar.getBoundingClientRect();
        return {
          top: hr.top,
          bottom: hr.bottom,
          barDisplay: getComputedStyle(bar).display,
          barTop: br.top,
          vh: window.innerHeight,
          y: window.scrollY
        };
      });
      if (info.y < 1500) fail("did not scroll 1500px at " + width + ": " + info.y);
      if (info.top !== 0) fail("header top is " + info.top + " after scroll at " + width + " (expected 0)");
      if (info.barDisplay !== "none" && info.bottom > info.barTop - 0.5) {
        fail("header covers sticky-call bar at " + width + ": " + JSON.stringify(info));
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await stickyAt(1440);
    await stickyAt(390);

    function iconState() {
      return page.evaluate(() => {
        const theme = document.documentElement.getAttribute("data-theme");
        const moon = getComputedStyle(document.querySelector(".icon-moon"));
        const sun = getComputedStyle(document.querySelector(".icon-sun"));
        return {
          theme,
          moonOp: Number(moon.opacity),
          sunOp: Number(sun.opacity),
          moonDisplay: moon.display,
          sunDisplay: sun.display
        };
      });
    }
    const before = await page.getAttribute("html", "data-theme");
    const iconsBefore = await iconState();
    if (iconsBefore.moonDisplay === "none" || iconsBefore.sunDisplay === "none") {
      fail("toggle still uses display:none swap: " + JSON.stringify(iconsBefore));
    }
    if (before === "light") {
      if (!(iconsBefore.moonOp > 0.9 && iconsBefore.sunOp < 0.1)) fail("light mode should show moon: " + JSON.stringify(iconsBefore));
    } else if (!(iconsBefore.sunOp > 0.9 && iconsBefore.moonOp < 0.1)) {
      fail("dark mode should show sun: " + JSON.stringify(iconsBefore));
    }
    await page.click('[aria-label="Switch light/dark"]');
    const after = await page.getAttribute("html", "data-theme");
    if (!before || before === after) fail("theme toggle did not switch (" + before + " -> " + after + ")");
    const iconsAfter = await iconState();
    if (after === "light") {
      if (!(iconsAfter.moonOp > 0.9 && iconsAfter.sunOp < 0.1)) fail("after click, light should show moon: " + JSON.stringify(iconsAfter));
    } else if (!(iconsAfter.sunOp > 0.9 && iconsAfter.moonOp < 0.1)) {
      fail("after click, dark should show sun: " + JSON.stringify(iconsAfter));
    }
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
