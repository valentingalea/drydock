#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { extname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  loadPayload,
  resolvePayloadRequest
} from "../../../../tools/scripts/payload.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const payload = await loadPayload(repoRoot);
const defaultPort = 8090;
const host = "127.0.0.1";
const execFileAsync = promisify(execFile);

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

export function getPayloadEntrypoint() {
  return payload.entrypoint;
}

export function runtimePathAllowed(pathname) {
  return resolvePayloadRequest(payload, pathname) !== null;
}

export function createServer() {
  return createHttpServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        respond(response, 405, "method not allowed");
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);

      if (!runtimePathAllowed(pathname)) {
        respond(response, 404, "not found");
        return;
      }

      const filePath = resolvePayloadRequest(payload, pathname);

      if (!filePath) {
        respond(response, 404, "not found");
        return;
      }

      const fileStat = await stat(filePath);

      if (!fileStat.isFile()) {
        respond(response, 404, "not found");
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Content-Length": fileStat.size,
        "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream"
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (error.code === "ENOENT") {
        respond(response, 404, "not found");
        return;
      }

      console.error(error);
      respond(response, 500, "internal server error");
    }
  });
}

export function parsePort(argv) {
  const portIndex = argv.indexOf("--port");

  if (portIndex === -1) {
    return defaultPort;
  }

  const value = Number.parseInt(argv[portIndex + 1], 10);

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }

  return value;
}

function respond(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await verifySubmoduleForStart();
  const port = parsePort(process.argv.slice(2));
  const server = createServer();

  server.listen(port, host, () => {
    console.log(`Drydock live origin: http://${host}:${port}/`);
    console.log(`Payload entrypoint: ${payload.entrypoint}`);
    console.log("Public access should go through Caddy; do not bind this origin publicly.");
  });
}

async function verifySubmoduleForStart() {
  const verifier = resolve(repoRoot, "engine/tools/verify-submodule.sh");
  const { stdout, stderr } = await execFileAsync(verifier, ["--start"]);

  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
}
