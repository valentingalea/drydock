import {
  HOST_PROTOCOL_VERSION,
  createDevHost,
  createMemoryStorageAdapter,
  fail,
  ok
} from "./vendor/drydock-host-bridge/index.js";

// Drydock-owned web runtime; product code connects through its own adapter.
let hostPromise;

export { HOST_PROTOCOL_VERSION };

export async function connectHost() {
  if (!hostPromise) {
    hostPromise = Promise.resolve(getInjectedHost() ?? createDevHost({
      storage: createBrowserStorageAdapter()
    }));
  }

  return hostPromise;
}

function getInjectedHost() {
  const host = globalThis.drydockHost;

  if (!isHostLike(host)) {
    return null;
  }

  return host;
}

function isHostLike(host) {
  return host
    && typeof host === "object"
    && host.protocolVersion === HOST_PROTOCOL_VERSION
    && typeof host.capabilities === "function"
    && host.storage
    && typeof host.storage.save === "function"
    && typeof host.storage.load === "function"
    && typeof host.storage.remove === "function"
    && typeof host.storage.list === "function";
}

function createBrowserStorageAdapter() {
  if (typeof globalThis.window === "undefined") {
    return createMemoryStorageAdapter();
  }

  const localStorage = globalThis.window.localStorage;

  if (!isStorageLike(localStorage)) {
    return createMemoryStorageAdapter();
  }

  const prefix = "drydock:";

  return {
    async save(key, value) {
      assertKey(key);

      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
        return ok(null);
      } catch (error) {
        return fail("storageWriteFailed", error.message);
      }
    },

    async load(key) {
      assertKey(key);

      const text = localStorage.getItem(prefix + key);

      if (text === null) {
        return ok(null);
      }

      try {
        return ok(JSON.parse(text));
      } catch (error) {
        return fail("storageReadFailed", error.message);
      }
    },

    async remove(key) {
      assertKey(key);
      localStorage.removeItem(prefix + key);
      return ok(null);
    },

    async list() {
      const keys = [];

      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);

        if (key?.startsWith(prefix)) {
          keys.push(key.slice(prefix.length));
        }
      }

      return ok(keys.sort());
    }
  };
}

function isStorageLike(value) {
  return value
    && typeof value.getItem === "function"
    && typeof value.setItem === "function"
    && typeof value.removeItem === "function"
    && typeof value.key === "function"
    && typeof value.length === "number";
}

function assertKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("storage key must be a non-empty string");
  }
}

globalThis.DrydockHost = Object.freeze({
  connect: connectHost,
  protocolVersion: HOST_PROTOCOL_VERSION
});
