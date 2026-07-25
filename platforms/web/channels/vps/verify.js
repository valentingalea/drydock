#!/usr/bin/env node

const defaultTimeoutMs = 5000;

const runtimeAllowedPaths = [
  "/",
  "/index.html",
  "/host-bridge.js",
  "/vendor/drydock-host-bridge/index.js",
  "/engine/mock-game/",
  "/engine/mock-game/index.html",
  "/engine/mock-game/src/bootstrap.js",
  "/engine/mock-game/src/boot-guard.js",
  "/engine/mock-game/src/game.js",
  "/engine/mock-game/src/platform-host.js",
  "/engine/mock-game/style/mock.css",
  "/engine/src/core/app-state.js",
  "/engine/src/core/clock.js",
  "/engine/src/core/scope.js",
  "/engine/src/dev/debug-panel.js",
  "/engine/src/dev/fps.js",
  "/engine/src/ui/status-line.js",
  "/engine/style/debug.css",
  "/engine/style/hud.css",
  "/engine/lib/three.module.js"
];

const deniedPaths = [
  "/package.json",
  "/.git/config",
  "/engine/.git",
  "/engine/AGENTS.md",
  "/engine/package.json",
  "/engine/test/unit/scope.test.js",
  "/drydock-artifact.json",
  "/.drydock-channel"
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2), process.env);
  await verifyVps(options);
}

export async function verifyVps(options = {}) {
  const routes = [];

  if (options.liveUrl) {
    routes.push({ name: "live", baseUrl: options.liveUrl });
  }

  if (options.releaseUrl) {
    routes.push({ name: "release", baseUrl: options.releaseUrl });
  }

  if (routes.length === 0) {
    throw new Error(
      "usage: node verify.js --live-url https://example.com/drydock/ --release-url https://example.com/drydock-release/"
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const results = [];

  for (const route of routes) {
    results.push(...await verifyRoute({ ...route, fetchImpl, timeoutMs }));
  }

  for (const result of results) {
    console.log(`${result.name} ${result.status} ${result.url}`);
  }

  console.log(`verified ${routes.length} VPS route${routes.length === 1 ? "" : "s"}`);
  return results;
}

export async function verifyRoute({ name, baseUrl, fetchImpl = fetch, timeoutMs = defaultTimeoutMs }) {
  const checks = [
    ...runtimeAllowedPaths.map((path) => ({ path, expectedStatus: 200 })),
    ...deniedPaths.map((path) => ({ path, expectedStatus: 404 }))
  ];
  const results = [];

  for (const check of checks) {
    const url = resolveRouteUrl(baseUrl, check.path);
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (response.status !== check.expectedStatus) {
      throw new Error(
        `${name} route check failed for ${url}: expected ${check.expectedStatus}, got ${response.status}`
      );
    }

    results.push({ name, path: check.path, status: response.status, url });
  }

  return results;
}

export function parseArgs(argv, env = {}) {
  const options = {
    liveUrl: env.DRYDOCK_LIVE_URL,
    releaseUrl: env.DRYDOCK_RELEASE_URL
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    } else if (arg === "--live-url") {
      options.liveUrl = requireValue(argv, ++i, arg);
    } else if (arg === "--release-url") {
      options.releaseUrl = requireValue(argv, ++i, arg);
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parseTimeout(requireValue(argv, ++i, arg));
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
  }

  return options;
}

export function resolveRouteUrl(baseUrl, path) {
  const base = new URL(baseUrl);
  const baseHref = base.href.endsWith("/") ? base.href : `${base.href}/`;

  if (path === "/") {
    return baseHref;
  }

  return new URL(path.replace(/^\/+/, ""), baseHref).href;
}

function parseTimeout(value) {
  const timeoutMs = Number.parseInt(value, 10);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    throw new Error("--timeout-ms must be an integer from 100 to 60000");
  }

  return timeoutMs;
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}
