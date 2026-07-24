import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("downloads Caddy template exposes only the current package and checksum", async () => {
  const caddy = await readFile(join(import.meta.dirname, "../caddy.path.example"), "utf8");

  assert.match(caddy, /handle_path \/drydock-downloads\/\*/);
  assert.match(caddy, /root \* \/var\/www\/drydock-downloads/);
  assert.match(caddy, /\/drydock-placeholder-1\.4\.0-windows-x64\.zip/);
  assert.match(caddy, /\/drydock-placeholder-1\.4\.0-windows-x64\.zip\.sha256/);
  assert.match(caddy, /respond 404/);
  assert.doesNotMatch(caddy, /browse/);
  assert.doesNotMatch(caddy, /drydock-artifact\.json/);
});
