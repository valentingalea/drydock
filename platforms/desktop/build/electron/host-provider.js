const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { dirname, resolve } = require("node:path");

const HOST_PROTOCOL_VERSION = 1;
const IPC_CHANNEL = "drydock:host";

const HostErrorCode = Object.freeze({
  Unsupported: "unsupported",
  PermissionDenied: "permissionDenied",
  InvalidArgument: "invalidArgument"
});

const ELECTRON_HOST_CAPABILITIES = Object.freeze({
  storage: "local",
  achievements: false,
  telemetry: false,
  purchases: false,
  identity: false
});

function createElectronHostProvider(options = {}) {
  const storageFile = resolve(
    options.storageFile
      ?? resolve(options.userDataPath ?? process.cwd(), "drydock-storage.json")
  );

  return {
    protocolVersion: HOST_PROTOCOL_VERSION,

    async capabilities() {
      return { ...ELECTRON_HOST_CAPABILITIES };
    },

    storage: createFileStorageAdapter(storageFile),

    achievements: {
      async unlock(id) {
        assertNonEmptyString(id, "achievement id");
        return unsupported("achievements");
      }
    },

    telemetry: {
      async record(event) {
        assertNonEmptyString(event, "telemetry event");
        return unsupported("telemetry");
      }
    },

    purchases: {
      async purchase(sku) {
        assertNonEmptyString(sku, "sku");
        return unsupported("purchases");
      },

      async restore() {
        return unsupported("purchases");
      },

      async entitlements() {
        return unsupported("purchases");
      }
    },

    identity: {
      async currentUser() {
        return unsupported("identity");
      }
    }
  };
}

function createFileStorageAdapter(storageFile) {
  return {
    async save(key, value) {
      assertStorageKey(key);

      const data = await readStorageFile(storageFile);
      data[key] = cloneValue(value);
      await writeStorageFile(storageFile, data);
      return ok(null);
    },

    async load(key) {
      assertStorageKey(key);

      const data = await readStorageFile(storageFile);
      return ok(Object.hasOwn(data, key) ? cloneValue(data[key]) : null);
    },

    async remove(key) {
      assertStorageKey(key);

      const data = await readStorageFile(storageFile);
      delete data[key];
      await writeStorageFile(storageFile, data);
      return ok(null);
    },

    async list() {
      const data = await readStorageFile(storageFile);
      return ok(Object.keys(data).sort());
    }
  };
}

async function registerHostIpc(ipcMain, hostProvider) {
  ipcMain.handle(IPC_CHANNEL, async (event, request) => {
    const frameUrl = event.senderFrame?.url ?? "";

    if (!isTrustedFrameUrl(frameUrl)) {
      return fail(HostErrorCode.PermissionDenied, "host bridge is only available to app://drydock");
    }

    return invokeHost(hostProvider, request);
  });
}

async function invokeHost(hostProvider, request) {
  if (!isInvokeRequest(request)) {
    return fail(HostErrorCode.InvalidArgument, "invalid host bridge IPC request");
  }

  const { service, method, args } = request;

  try {
    if (service === "host" && method === "capabilities") {
      assertArity(args, 0, "host.capabilities");
      return hostProvider.capabilities();
    }

    if (service === "storage") {
      return invokeStorage(hostProvider.storage, method, args);
    }

    if (service === "achievements" && method === "unlock") {
      assertArity(args, 1, "achievements.unlock");
      return hostProvider.achievements.unlock(args[0]);
    }

    if (service === "telemetry" && method === "record") {
      assertArity(args, 1, "telemetry.record");
      return hostProvider.telemetry.record(args[0]);
    }

    if (service === "purchases" && method === "purchase") {
      assertArity(args, 1, "purchases.purchase");
      return hostProvider.purchases.purchase(args[0]);
    }

    if (service === "purchases" && method === "restore") {
      assertArity(args, 0, "purchases.restore");
      return hostProvider.purchases.restore();
    }

    if (service === "purchases" && method === "entitlements") {
      assertArity(args, 0, "purchases.entitlements");
      return hostProvider.purchases.entitlements();
    }

    if (service === "identity" && method === "currentUser") {
      assertArity(args, 0, "identity.currentUser");
      return hostProvider.identity.currentUser();
    }

    return fail(HostErrorCode.InvalidArgument, `unknown host bridge method: ${service}.${method}`);
  } catch (error) {
    if (error instanceof TypeError) {
      return fail(HostErrorCode.InvalidArgument, error.message);
    }

    throw error;
  }
}

function invokeStorage(storage, method, args) {
  if (method === "save") {
    assertArity(args, 2, "storage.save");
    return storage.save(args[0], args[1]);
  }

  if (method === "load") {
    assertArity(args, 1, "storage.load");
    return storage.load(args[0]);
  }

  if (method === "remove") {
    assertArity(args, 1, "storage.remove");
    return storage.remove(args[0]);
  }

  if (method === "list") {
    assertArity(args, 0, "storage.list");
    return storage.list();
  }

  return fail(HostErrorCode.InvalidArgument, `unknown host bridge method: storage.${method}`);
}

function isTrustedFrameUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "app:" && url.host === "drydock";
  } catch {
    return false;
  }
}

function isInvokeRequest(value) {
  return value
    && typeof value === "object"
    && typeof value.service === "string"
    && typeof value.method === "string"
    && Array.isArray(value.args);
}

async function readStorageFile(storageFile) {
  try {
    const data = JSON.parse(await readFile(storageFile, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {};
    }

    return data;
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeStorageFile(storageFile, data) {
  await mkdir(dirname(storageFile), { recursive: true });
  await writeFile(storageFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function assertArity(args, expected, label) {
  if (args.length !== expected) {
    throw new TypeError(`${label} expected ${expected} arguments`);
  }
}

function assertStorageKey(key) {
  assertNonEmptyString(key, "storage key");
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function ok(value = null) {
  return { ok: true, value };
}

function fail(code, message, details = undefined) {
  const result = { ok: false, code };

  if (message) {
    result.message = message;
  }

  if (details !== undefined) {
    result.details = details;
  }

  return result;
}

function unsupported(feature) {
  return fail(
    HostErrorCode.Unsupported,
    `${feature} is not supported by this host`,
    { feature }
  );
}

module.exports = {
  ELECTRON_HOST_CAPABILITIES,
  HOST_PROTOCOL_VERSION,
  HostErrorCode,
  IPC_CHANNEL,
  createElectronHostProvider,
  createFileStorageAdapter,
  fail,
  invokeHost,
  isTrustedFrameUrl,
  ok,
  registerHostIpc,
  unsupported
};
