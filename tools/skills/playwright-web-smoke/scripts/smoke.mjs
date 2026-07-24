#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));

if (!args.url) {
  console.error("usage: node tools/skills/playwright-web-smoke/scripts/smoke.mjs <url> [--screenshot path] [--json path] [--timeout ms]");
  process.exit(2);
}

const url = new URL(args.url);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const screenshotPath = resolve(
  process.cwd(),
  args.screenshot ?? `artifacts/smoke/playwright-web-smoke/${url.hostname}-${timestamp}.png`
);
const jsonPath = args.json ? resolve(process.cwd(), args.json) : null;
const timeout = args.timeout ?? 10000;

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1
  });

  page.on("console", (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
      location: message.location()
    });
  });

  page.on("pageerror", (error) => {
    pageErrors.push({
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  });

  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? "unknown"
    });
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      badResponses.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText()
      });
    }
  });

  const navigation = await page.goto(url.href, {
    waitUntil: "domcontentloaded",
    timeout
  });

  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
  await page.waitForTimeout(500);

  const facts = await page.evaluate(() => {
    const body = document.body;
    const bodyRect = body?.getBoundingClientRect();
    const visibleText = (body?.innerText ?? "").replace(/\s+/g, " ").trim();
    const canvases = [...document.querySelectorAll("canvas")].map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        id: canvas.id,
        width: canvas.width,
        height: canvas.height,
        clientWidth: Math.round(rect.width),
        clientHeight: Math.round(rect.height)
      };
    });

    return {
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      bodyTextSample: visibleText.slice(0, 240),
      bodyTextLength: visibleText.length,
      bodyClientWidth: Math.round(bodyRect?.width ?? 0),
      bodyClientHeight: Math.round(bodyRect?.height ?? 0),
      canvasCount: canvases.length,
      canvases
    };
  });

  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const result = {
    ok: pageErrors.length === 0
      && failedRequests.length === 0
      && badResponses.length === 0
      && (navigation?.status() ?? 0) < 400,
    url: url.href,
    navigation: {
      status: navigation?.status() ?? null,
      url: navigation?.url() ?? null
    },
    screenshot: screenshotPath,
    facts,
    console: consoleMessages,
    pageErrors,
    failedRequests,
    badResponses
  };

  printSummary(result);

  if (jsonPath) {
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`json: ${jsonPath}`);
  }

  process.exitCode = result.ok ? 0 : 1;
} finally {
  await browser.close();
}

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    } else if (arg === "--screenshot") {
      parsed.screenshot = requireValue(argv, ++i, arg);
    } else if (arg === "--json") {
      parsed.json = requireValue(argv, ++i, arg);
    } else if (arg === "--timeout") {
      parsed.timeout = Number.parseInt(requireValue(argv, ++i, arg), 10);

      if (!Number.isInteger(parsed.timeout) || parsed.timeout < 1) {
        throw new Error("--timeout must be a positive integer");
      }
    } else if (!parsed.url) {
      parsed.url = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function printSummary(result) {
  console.log(`url: ${result.url}`);
  console.log(`status: ${result.navigation.status}`);
  console.log(`title: ${result.facts.title}`);
  console.log(`readyState: ${result.facts.readyState}`);
  console.log(`body: ${result.facts.bodyClientWidth}x${result.facts.bodyClientHeight}, text=${result.facts.bodyTextLength}, canvases=${result.facts.canvasCount}`);
  console.log(`screenshot: ${result.screenshot}`);
  console.log(`pageErrors: ${result.pageErrors.length}`);
  console.log(`consoleErrors: ${result.console.filter((entry) => entry.type === "error").length}`);
  console.log(`failedRequests: ${result.failedRequests.length}`);
  console.log(`badResponses: ${result.badResponses.length}`);

  for (const error of result.pageErrors) {
    console.log(`PAGEERROR ${error.name}: ${error.message}`);
  }

  for (const entry of result.console.filter((message) => message.type === "error")) {
    console.log(`CONSOLE ${entry.type}: ${entry.text}`);
  }

  for (const request of result.failedRequests) {
    console.log(`REQUESTFAILED ${request.method} ${request.url}: ${request.failure}`);
  }

  for (const response of result.badResponses) {
    console.log(`BADRESPONSE ${response.status} ${response.url}`);
  }

  if (result.facts.bodyTextSample) {
    console.log(`text: ${result.facts.bodyTextSample}`);
  }
}
