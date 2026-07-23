export const HOST_PROTOCOL_VERSION = 1;

export const HostErrorCode = Object.freeze({
  Unsupported: "unsupported",
  NotAuthenticated: "notAuthenticated",
  NetworkUnavailable: "networkUnavailable",
  PermissionDenied: "permissionDenied",
  Conflict: "conflict",
  UnavailableOffline: "unavailableOffline",
  InvalidArgument: "invalidArgument"
});

export const DEFAULT_CAPABILITIES = Object.freeze({
  storage: "none",
  achievements: false,
  telemetry: false,
  purchases: false,
  identity: false
});

const STORAGE_MODES = new Set(["none", "local", "cloud"]);

export function ok(value = null) {
  return { ok: true, value };
}

export function fail(code, message, details = undefined) {
  const result = { ok: false, code };

  if (message) {
    result.message = message;
  }

  if (details !== undefined) {
    result.details = details;
  }

  return result;
}

export function unsupported(feature) {
  return fail(
    HostErrorCode.Unsupported,
    `${feature} is not supported by this host`,
    { feature }
  );
}

export function isHostResult(value) {
  if (!value || typeof value !== "object" || typeof value.ok !== "boolean") {
    return false;
  }

  if (value.ok) {
    return Object.hasOwn(value, "value");
  }

  return typeof value.code === "string";
}

export function normalizeCapabilities(capabilities = {}) {
  const normalized = {
    ...DEFAULT_CAPABILITIES,
    ...capabilities
  };

  if (!STORAGE_MODES.has(normalized.storage)) {
    throw new TypeError(`unsupported storage capability: ${normalized.storage}`);
  }

  for (const key of ["achievements", "telemetry", "purchases", "identity"]) {
    normalized[key] = Boolean(normalized[key]);
  }

  return Object.freeze(normalized);
}

export function createMemoryStorageAdapter(initialValues = undefined) {
  const values = new Map();

  if (initialValues) {
    for (const [key, value] of Object.entries(initialValues)) {
      values.set(key, cloneValue(value));
    }
  }

  return {
    async save(key, value) {
      assertStorageKey(key);
      values.set(key, cloneValue(value));
      return ok(null);
    },

    async load(key) {
      assertStorageKey(key);

      if (!values.has(key)) {
        return ok(null);
      }

      return ok(cloneValue(values.get(key)));
    },

    async remove(key) {
      assertStorageKey(key);
      values.delete(key);
      return ok(null);
    },

    async list() {
      return ok([...values.keys()].sort());
    }
  };
}

export function createDevHost(options = {}) {
  const capabilities = normalizeCapabilities({
    storage: "local",
    ...options.capabilities
  });
  const storageAdapter = capabilities.storage === "none"
    ? null
    : options.storage ?? createMemoryStorageAdapter();

  return {
    protocolVersion: HOST_PROTOCOL_VERSION,

    async capabilities() {
      return { ...capabilities };
    },

    storage: createStorageFacade(storageAdapter),

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

export async function assertHostConformance(host) {
  if (!host || typeof host !== "object") {
    throw new TypeError("host must be an object");
  }

  if (host.protocolVersion !== HOST_PROTOCOL_VERSION) {
    throw new TypeError("host protocol version mismatch");
  }

  if (typeof host.capabilities !== "function") {
    throw new TypeError("host.capabilities must be a function");
  }

  const capabilities = normalizeCapabilities(await host.capabilities());

  await assertStorageConformance(host, capabilities.storage);
  await assertUnsupportedWhenFalse(
    capabilities.achievements,
    () => host.achievements?.unlock?.("__drydock_conformance__"),
    "achievements"
  );
  await assertUnsupportedWhenFalse(
    capabilities.telemetry,
    () => host.telemetry?.record?.("__drydock_conformance__"),
    "telemetry"
  );
  await assertUnsupportedWhenFalse(
    capabilities.purchases,
    () => host.purchases?.restore?.(),
    "purchases"
  );
  await assertUnsupportedWhenFalse(
    capabilities.identity,
    () => host.identity?.currentUser?.(),
    "identity"
  );
}

function createStorageFacade(storageAdapter) {
  if (!storageAdapter) {
    return {
      async save(key) {
        assertStorageKey(key);
        return unsupported("storage");
      },

      async load(key) {
        assertStorageKey(key);
        return unsupported("storage");
      },

      async remove(key) {
        assertStorageKey(key);
        return unsupported("storage");
      },

      async list() {
        return unsupported("storage");
      }
    };
  }

  return storageAdapter;
}

async function assertStorageConformance(host, storageMode) {
  if (!host.storage || typeof host.storage !== "object") {
    throw new TypeError("host.storage must be an object");
  }

  for (const method of ["save", "load", "remove", "list"]) {
    if (typeof host.storage[method] !== "function") {
      throw new TypeError(`host.storage.${method} must be a function`);
    }
  }

  const key = "__drydock_conformance__";

  if (storageMode === "none") {
    const result = await host.storage.save(key, true);
    assertUnsupportedResult(result, "storage");
    return;
  }

  const saveResult = await host.storage.save(key, { value: true });
  assertHostResult(saveResult, "storage.save");

  const loadResult = await host.storage.load(key);
  assertHostResult(loadResult, "storage.load");

  const listResult = await host.storage.list();
  assertHostResult(listResult, "storage.list");

  const removeResult = await host.storage.remove(key);
  assertHostResult(removeResult, "storage.remove");
}

async function assertUnsupportedWhenFalse(isSupported, call, feature) {
  if (isSupported) {
    return;
  }

  if (typeof call !== "function") {
    throw new TypeError(`${feature} API must be present`);
  }

  const result = await call();
  assertUnsupportedResult(result, feature);
}

function assertHostResult(result, label) {
  if (!isHostResult(result)) {
    throw new TypeError(`${label} must return a HostResult`);
  }
}

function assertUnsupportedResult(result, feature) {
  assertHostResult(result, feature);

  if (result.ok || result.code !== HostErrorCode.Unsupported) {
    throw new TypeError(`${feature} must return unsupported when capability is false`);
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
  return structuredClone(value);
}
