import { connectHost } from "../../../host-bridge.js";

/**
 * Drydock implementation of Line Engine's mock-game platform-host extension point.
 *
 * This file is served and packaged at engine/mock-game/src/platform-host.js, so the
 * relative import above resolves to the composed runtime's root host bridge.
 */
export async function connectPlatformHost() {
  return connectHost();
}
