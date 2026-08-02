const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed Electron preloads may only import a limited set of built-in modules.
// Keep these public protocol primitives in sync with host-provider.js.
const HOST_PROTOCOL_VERSION = 1;
const IPC_CHANNEL = "drydock:host";

function invoke(service, method, args = []) {
  return ipcRenderer.invoke(IPC_CHANNEL, { service, method, args });
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

const drydockHost = Object.freeze({
  protocolVersion: HOST_PROTOCOL_VERSION,

  capabilities() {
    return invoke("host", "capabilities");
  },

  storage: Object.freeze({
    save(key, value) {
      assertNonEmptyString(key, "storage key");
      return invoke("storage", "save", [key, value]);
    },

    load(key) {
      assertNonEmptyString(key, "storage key");
      return invoke("storage", "load", [key]);
    },

    remove(key) {
      assertNonEmptyString(key, "storage key");
      return invoke("storage", "remove", [key]);
    },

    list() {
      return invoke("storage", "list");
    }
  }),

  achievements: Object.freeze({
    unlock(id) {
      assertNonEmptyString(id, "achievement id");
      return invoke("achievements", "unlock", [id]);
    }
  }),

  telemetry: Object.freeze({
    record(event) {
      assertNonEmptyString(event, "telemetry event");
      return invoke("telemetry", "record", [event]);
    }
  }),

  purchases: Object.freeze({
    purchase(sku) {
      assertNonEmptyString(sku, "sku");
      return invoke("purchases", "purchase", [sku]);
    },

    restore() {
      return invoke("purchases", "restore");
    },

    entitlements() {
      return invoke("purchases", "entitlements");
    }
  }),

  identity: Object.freeze({
    currentUser() {
      return invoke("identity", "currentUser");
    }
  })
});

contextBridge.exposeInMainWorld("drydockHost", drydockHost);
