#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CompositionError,
  createRuntimeComposition,
  openRuntimeFile as openComposedRuntimeFile
} from "../../../../tools/composition.js";
import {
  DEV_HOST_CAPABILITIES
} from "../../../../contracts/host-bridge/src/index.js";
import { verifyProjectComponents } from "../../../../tools/components.js";
import { loadProject } from "../../../../tools/project.js";

const defaultPort = 8090;
const defaultHost = "127.0.0.1";

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

export function getProjectEntrypoint(composition) {
  return composition.entrypoint;
}

export async function runtimePathAllowed(composition, pathname) {
  try {
    const file = await openComposedRuntimeFile(composition, pathname);
    if (!file) {
      return false;
    }
    await file.handle.close();
    return true;
  } catch (error) {
    if (error instanceof CompositionError) {
      return false;
    }
    throw error;
  }
}

export function createServer(composition, {
  openRuntimeFile = openComposedRuntimeFile
} = {}) {
  if (!composition) {
    throw new TypeError("composition is required");
  }

  return createHttpServer(async (request, response) => {
    let file = null;

    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        respond(response, 405, "method not allowed");
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(302, {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Location: encodeRuntimePath(composition.entrypoint)
        });
        response.end();
        return;
      }
      file = await openRuntimeFile(composition, url.pathname);

      if (!file) {
        respond(response, 404, "not found");
        return;
      }

      const headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Content-Length": file.size,
        "Content-Type": (
          contentTypes.get(extname(file.target))
          ?? "application/octet-stream"
        )
      };

      if (request.method === "HEAD") {
        await file.handle.close();
        file = null;
        response.writeHead(200, headers);
        response.end();
        return;
      }

      const stream = file.handle.createReadStream({
        autoClose: true
      });
      file = null;
      stream.once("error", (error) => {
        console.error(error);
        response.destroy(error);
      });
      response.once("close", () => {
        stream.destroy();
      });
      response.writeHead(200, headers);
      stream.pipe(response);
    } catch (error) {
      if (file) {
        await file.handle.close().catch(() => {});
      }
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof CompositionError) {
        respond(response, 404, "not found");
        return;
      }

      console.error(error);
      respond(response, 500, "internal server error");
    }
  });
}

function encodeRuntimePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function startLiveWeb({
  args,
  context,
  host = defaultHost,
  stdout = process.stdout
}) {
  const port = parsePort(args);
  const project = await loadProject(context);
  assertRequiredHostCapabilities(
    project.descriptor.host.requiredCapabilities
  );
  const verified = await verifyProjectComponents(project, {
    profile: "development"
  });
  const composition = await createRuntimeComposition(verified);
  const server = createServer(composition);

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  stdout.write(`Drydock live origin: http://${host}:${address.port}/\n`);
  stdout.write(`Project entrypoint: ${composition.entrypoint}\n`);
  stdout.write("Public access should go through a configured reverse proxy.\n");

  return {
    composition,
    server
  };
}

export function assertRequiredHostCapabilities(requiredCapabilities) {
  const unsupported = requiredCapabilities.filter((capability) => (
    capability === "storage"
      ? DEV_HOST_CAPABILITIES.storage === "none"
      : DEV_HOST_CAPABILITIES[capability] !== true
  ));

  if (unsupported.length > 0) {
    throw new Error(
      "web iteration host does not provide required capabilities: "
      + unsupported.join(", ")
    );
  }
}

export function parsePort(argv) {
  let port = defaultPort;
  let seen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--port") {
      throw new Error(`unknown web iteration argument: ${argument}`);
    }
    if (seen) {
      throw new Error("--port may be provided only once");
    }

    const value = Number(argv[index + 1]);
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      throw new Error("--port must be an integer from 0 to 65535");
    }

    port = value;
    seen = true;
    index += 1;
  }

  return port;
}

function respond(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { runCli } = await import("../../../../tools/drydock.js");
  process.exitCode = await runCli(
    [
      "iterate",
      "web",
      ...process.argv.slice(2)
    ],
    {
      invocationCwd: process.cwd()
    }
  );
}
