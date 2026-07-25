const { readFile, stat } = require("node:fs/promises");
const { extname, relative, resolve, sep } = require("node:path");

const appScheme = "app";
const appHost = "drydock";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'sha256-DV2rnjt8VaGp9BWYzkk/F9naieRwafKYVsxAf3g4gsQ='",
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
    || pathname.startsWith("/product/")
    || pathname.startsWith("/vendor/drydock-host-bridge/");
}

function createAppProtocolHandler(options = {}) {
  const runtimeRoot = options.runtimeRoot;

  if (!runtimeRoot) {
    throw new Error("runtimeRoot is required");
  }

  return (request) => serveAppRequest(request, { runtimeRoot });
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
    const filePath = resolveSafeRuntimePath(options.runtimeRoot, pathname);
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

function resolveSafeRuntimePath(runtimeRoot, pathname) {
  const normalizedPath = pathname === "/"
    ? "/index.html"
    : pathname.endsWith("/")
      ? `${pathname}index.html`
      : pathname;
  const filePath = resolve(runtimeRoot, `.${normalizedPath}`);
  const pathWithinRuntime = relative(runtimeRoot, filePath);

  if (
    pathWithinRuntime.startsWith("..")
    || pathWithinRuntime.includes(`..${sep}`)
    || pathWithinRuntime === ""
  ) {
    throw Object.assign(new Error("path escapes runtime root"), { code: "ENOENT" });
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
