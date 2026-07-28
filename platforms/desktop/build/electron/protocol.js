const { readFile, stat } = require("node:fs/promises");
const {
  extname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep
} = require("node:path");

const appScheme = "app";
const appHost = "drydock";
const scriptHashPattern = /^sha256-[A-Za-z0-9+/]+={0,2}$/;

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

function createContentSecurityPolicy(scriptHashes = []) {
  const normalizedHashes = [...new Set(scriptHashes)].sort();
  if (!normalizedHashes.every((hash) => scriptHashPattern.test(hash))) {
    throw new Error("runtime policy contains an invalid script hash");
  }

  return [
    "default-src 'self'",
    [
      "script-src 'self'",
      ...normalizedHashes.map((hash) => `'${hash}'`)
    ].join(" "),
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
}

const contentSecurityPolicy = createContentSecurityPolicy();

function runtimePathAllowed(pathname, runtimePaths) {
  const normalized = normalizeRuntimePath(pathname);
  return (
    normalized !== null
    && Array.isArray(runtimePaths)
    && runtimePaths.includes(normalized)
  );
}

function createAppProtocolHandler(options = {}) {
  const {
    runtimePaths,
    runtimeRoot,
    scriptHashes = []
  } = options;

  if (!runtimeRoot) {
    throw new Error("runtimeRoot is required");
  }
  if (!Array.isArray(runtimePaths)) {
    throw new Error("runtimePaths is required");
  }

  const contentSecurityPolicy = createContentSecurityPolicy(scriptHashes);
  return (request) => serveAppRequest(request, {
    contentSecurityPolicy,
    runtimePaths,
    runtimeRoot
  });
}

async function serveAppRequest(request, options) {
  const url = new URL(request.url);

  if (url.protocol !== `${appScheme}:` || url.host !== appHost) {
    return textResponse(404, "not found", options);
  }

  if (request.method && request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(405, "method not allowed", options);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname || "/");
  } catch {
    return textResponse(404, "not found", options);
  }

  if (!runtimePathAllowed(pathname, options.runtimePaths)) {
    return textResponse(404, "not found", options);
  }

  try {
    const filePath = resolveSafeRuntimePath(options.runtimeRoot, pathname);
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      return textResponse(404, "not found", options);
    }

    const headers = securityHeaders({
      "Cache-Control": "no-store",
      "Content-Length": String(fileStat.size),
      "Content-Type": (
        contentTypes.get(extname(filePath))
        ?? "application/octet-stream"
      )
    }, options.contentSecurityPolicy);

    if (request.method === "HEAD") {
      return new Response(null, {
        headers,
        status: 200
      });
    }

    return new Response(await readFile(filePath), {
      headers,
      status: 200
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return textResponse(404, "not found", options);
    }

    console.error(error);
    return textResponse(500, "internal server error", options);
  }
}

function resolveSafeRuntimePath(runtimeRoot, pathname) {
  const normalizedPath = normalizeRuntimePath(pathname);
  if (!normalizedPath) {
    throw Object.assign(
      new Error("path escapes runtime root"),
      {
        code: "ENOENT"
      }
    );
  }

  const filePath = resolve(runtimeRoot, ...normalizedPath.split("/"));
  const pathWithinRuntime = relative(runtimeRoot, filePath);

  if (
    pathWithinRuntime === ""
    || pathWithinRuntime === ".."
    || pathWithinRuntime.startsWith(`..${sep}`)
    || isAbsolute(pathWithinRuntime)
  ) {
    throw Object.assign(
      new Error("path escapes runtime root"),
      {
        code: "ENOENT"
      }
    );
  }

  return filePath;
}

function normalizeRuntimePath(pathname) {
  if (
    typeof pathname !== "string"
    || pathname.includes("\\")
    || pathname.includes("\0")
  ) {
    return null;
  }

  const requested = pathname === "/" ? "/index.html" : pathname;
  if (requested.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const withIndex = requested.endsWith("/")
    ? `${requested}index.html`
    : requested;
  const normalized = posix.normalize(withIndex).replace(/^\/+/, "");

  if (
    normalized === ""
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
  ) {
    return null;
  }

  return normalized;
}

function textResponse(status, body, options = {}) {
  return new Response(body, {
    status,
    headers: securityHeaders({
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }, options.contentSecurityPolicy)
  });
}

function securityHeaders(headers = {}, policy = contentSecurityPolicy) {
  return {
    ...headers,
    "Content-Security-Policy": policy,
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff"
  };
}

module.exports = {
  appHost,
  appScheme,
  contentSecurityPolicy,
  createAppProtocolHandler,
  createContentSecurityPolicy,
  resolveSafeRuntimePath,
  runtimePathAllowed,
  serveAppRequest
};
