export declare const HOST_PROTOCOL_VERSION = 1;

export declare const HostErrorCode: Readonly<{
  Unsupported: "unsupported";
  NotAuthenticated: "notAuthenticated";
  NetworkUnavailable: "networkUnavailable";
  PermissionDenied: "permissionDenied";
  Conflict: "conflict";
  UnavailableOffline: "unavailableOffline";
  InvalidArgument: "invalidArgument";
}>;

export type StorageCapability = "none" | "local" | "cloud";

export type HostCapabilities = {
  storage: StorageCapability;
  achievements: boolean;
  telemetry: boolean;
  purchases: boolean;
  identity: boolean;
};

export type HostOk<T> = {
  ok: true;
  value: T;
};

export type HostFailure = {
  ok: false;
  code: string;
  message?: string;
  details?: unknown;
};

export type HostResult<T> = HostOk<T> | HostFailure;

export type StorageApi = {
  save(key: string, value: unknown): Promise<HostResult<null>>;
  load(key: string): Promise<HostResult<unknown | null>>;
  remove(key: string): Promise<HostResult<null>>;
  list(): Promise<HostResult<string[]>>;
};

export type Host = {
  protocolVersion: typeof HOST_PROTOCOL_VERSION;
  capabilities(): Promise<HostCapabilities>;
  storage: StorageApi;
  achievements: {
    unlock(id: string): Promise<HostResult<null>>;
  };
  telemetry: {
    record(event: string): Promise<HostResult<null>>;
  };
  purchases: {
    purchase(sku: string): Promise<HostResult<unknown>>;
    restore(): Promise<HostResult<unknown>>;
    entitlements(): Promise<HostResult<unknown>>;
  };
  identity: {
    currentUser(): Promise<HostResult<unknown>>;
  };
};

export declare const DEFAULT_CAPABILITIES: Readonly<HostCapabilities>;

export declare function ok<T = null>(value?: T): HostOk<T>;
export declare function fail(
  code: string,
  message?: string,
  details?: unknown
): HostFailure;
export declare function unsupported(feature: string): HostFailure;
export declare function isHostResult(value: unknown): value is HostResult<unknown>;
export declare function normalizeCapabilities(
  capabilities?: Partial<HostCapabilities>
): HostCapabilities;
export declare function createMemoryStorageAdapter(
  initialValues?: Record<string, unknown>
): StorageApi;
export declare function createDevHost(options?: {
  capabilities?: Partial<HostCapabilities>;
  storage?: StorageApi;
}): Host;
export declare function assertHostConformance(host: Host): Promise<void>;
