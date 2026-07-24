const { readFile, stat } = require("node:fs/promises");
const { extname, relative, resolve, sep } = require("node:path");

const appScheme = "app";
const appHost = "drydock";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join("; ");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".ogg", "audio/ogg"],
  [".mp3", "audio/mpeg"]
]);

function runtimePathAllowed(pathname) {
  return pathname === "/"
    || pathname === "/index.html"
    || pathname === "/host-bridge.js"
    || pathname.startsWith("/src/")
    || pathname.startsWith("/assets/")
    || pathname.startsWith("/vendor/");
}

function createAppProtocolHandler(options = {}) {
  const gameRoot = options.gameRoot;

  if (!gameRoot) {
    throw new Error("gameRoot is required");
  }

  return (request) => serveAppRequest(request, { gameRoot });
}

async function serveAppRequest(request, options) {
  const url = new URL(request.url);

  if (url.protocol !== `${appScheme}:` || url.host !== appHost) {
    return textResponse(404, "not found");
  }

  if (request.method && request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(405, "method not allowed");
  }

  const pathname = decodeURIComponent(url.pathname || "/");

  if (!runtimePathAllowed(pathname)) {
    return textResponse(404, "not found");
  }

  try {
    const filePath = resolveSafeRuntimePath(options.gameRoot, pathname);
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      return textResponse(404, "not found");
    }

    const headers = securityHeaders({
      "Cache-Control": "no-store",
      "Content-Length": String(fileStat.size),
      "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream"
    });

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    return new Response(await readFile(filePath), { status: 200, headers });
  } catch (error) {
    if (error.code === "ENOENT") {
      return textResponse(404, "not found");
    }

    console.error(error);
    return textResponse(500, "internal server error");
  }
}

function resolveSafeRuntimePath(gameRoot, pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(gameRoot, `.${normalizedPath}`);
  const pathWithinGame = relative(gameRoot, filePath);

  if (
    pathWithinGame.startsWith("..")
    || pathWithinGame.includes(`..${sep}`)
    || pathWithinGame === ""
  ) {
    throw Object.assign(new Error("path escapes game root"), { code: "ENOENT" });
  }

  return filePath;
}

function textResponse(status, body) {
  return new Response(body, {
    status,
    headers: securityHeaders({
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    })
  });
}

function securityHeaders(headers = {}) {
  return {
    ...headers,
    "Content-Security-Policy": contentSecurityPolicy,
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff"
  };
}

module.exports = {
  appHost,
  appScheme,
  contentSecurityPolicy,
  createAppProtocolHandler,
  resolveSafeRuntimePath,
  runtimePathAllowed,
  serveAppRequest
};
