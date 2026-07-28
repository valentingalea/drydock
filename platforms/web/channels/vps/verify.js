#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const defaultTimeoutMs = 5000;

const deniedPaths = [
  "/package.json",
  "/.git/config",
  "/shipping/drydock-project.json",
  "/drydock-artifact.json",
  "/.drydock-channel"
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2), process.env);
  if (!options.artifact) {
    throw new Error("VPS verification requires --artifact");
  }
  options.manifest = JSON.parse(
    await readFile(resolveArtifactPath(options.artifact, process.env), "utf8")
  );
  await verifyVps(options);
}

export async function verifyVps(options = {}) {
  const releaseRuntimePaths = (
    options.runtimePaths
    ?? (
      options.manifest
        ? runtimePathsFromManifest(options.manifest)
        : null
    )
  );
  const liveRuntimePaths = (
    options.runtimePaths
    ?? (
      options.manifest
        ? liveRuntimePathsFromManifest(options.manifest)
        : null
    )
  );
  if (
    !Array.isArray(releaseRuntimePaths)
    || releaseRuntimePaths.length === 0
    || !Array.isArray(liveRuntimePaths)
    || liveRuntimePaths.length === 0
  ) {
    throw new Error("VPS verification requires artifact-derived runtime paths");
  }

  const routes = [];

  if (options.liveUrl) {
    routes.push({
      name: "live",
      baseUrl: options.liveUrl,
      runtimePaths: liveRuntimePaths
    });
  }

  if (options.releaseUrl) {
    routes.push({
      name: "release",
      baseUrl: options.releaseUrl,
      runtimePaths: releaseRuntimePaths
    });
  }

  if (routes.length === 0) {
    throw new Error(
      "usage: node verify.js --artifact PATH --live-url https://game.example/live/ --release-url https://game.example/releases/"
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const results = [];

  for (const route of routes) {
    results.push(...await verifyRoute({
      ...route,
      fetchImpl,
      timeoutMs
    }));
  }

  for (const result of results) {
    console.log(`${result.name} ${result.status} ${result.url}`);
  }

  console.log(`verified ${routes.length} VPS route${routes.length === 1 ? "" : "s"}`);
  return results;
}

export async function verifyRoute({
  name,
  baseUrl,
  fetchImpl = fetch,
  runtimePaths,
  timeoutMs = defaultTimeoutMs
}) {
  const checks = [
    ...runtimePaths.map((path) => ({ path, expectedStatus: 200 })),
    ...deniedPaths.map((path) => ({ path, expectedStatus: 404 }))
  ];
  const results = [];

  for (const check of checks) {
    const url = resolveRouteUrl(baseUrl, check.path);
    const response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const { status } = response;
    await response.body?.cancel();

    if (status !== check.expectedStatus) {
      throw new Error(
        `${name} route check failed for ${url}: expected ${check.expectedStatus}, got ${status}`
      );
    }

    results.push({ name, path: check.path, status, url });
  }

  return results;
}

export function runtimePathsFromManifest(manifest) {
  const paths = new Set([
    "/"
  ]);

  for (const checksum of manifest.checksums ?? []) {
    const path = `/${checksum.path}`;
    paths.add(path);
    if (checksum.path.endsWith("/index.html")) {
      paths.add(`/${checksum.path.slice(0, -"index.html".length)}`);
    }
  }

  return [...paths].sort();
}

export function liveRuntimePathsFromManifest(manifest) {
  const paths = runtimePathsFromManifest(manifest);
  const entrypoint = manifest.extensions?.drydock?.entrypoint;

  if (entrypoint && entrypoint !== "index.html") {
    return paths.filter((path) => path !== "/index.html");
  }
  return paths;
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
    } else if (arg === "--artifact") {
      options.artifact = requireValue(argv, ++i, arg);
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

  const encodedPath = path
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(encodedPath, baseHref).href;
}

export function resolveArtifactPath(value, env = {}, cwd = process.cwd()) {
  const invocationCwd = env.INIT_CWD || cwd;
  return resolve(invocationCwd, value);
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
