---
name: playwright-web-smoke
description: Use when diagnosing blank pages, broken web previews, Caddy/live iteration routes, or browser-only failures. Loads a URL with Playwright, captures console/page/request errors, screenshots, DOM/rendering facts, and compares local origins against public routes before changing deployment config.
---

# Playwright Web Smoke

Use this skill to turn "blank page" reports into concrete browser evidence.

## Workflow

1. Identify the URL under test. For Drydock, test the localhost origin first
   (`http://127.0.0.1:8090/`) before testing any public Caddy route.
2. Run the bundled smoke script:

   ```sh
   node tools/skills/playwright-web-smoke/scripts/smoke.mjs http://127.0.0.1:8090/
   ```

3. Read the terminal summary first: navigation status, page errors, console errors,
   failed requests, HTTP >=400 responses, and rendering facts.
4. Inspect the screenshot path printed by the script when visual confirmation matters.
5. If localhost fails, fix the app/runtime before touching Caddy.
6. If localhost passes but the public URL fails, compare request URLs and response
   statuses. For path-mounted Caddy routes, verify the app uses relative imports.

## Script Options

```sh
node tools/skills/playwright-web-smoke/scripts/smoke.mjs <url> \
  --screenshot artifacts/smoke/page.png \
  --json artifacts/smoke/page.json \
  --timeout 10000
```

Defaults:

- screenshot: `artifacts/smoke/playwright-web-smoke/<host>-<timestamp>.png`
- JSON: omitted unless `--json` is provided
- timeout: `10000`

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium` if Playwright cannot find a browser.

## Interpretation

- `pageErrors` usually mean app JavaScript failed after navigation.
- `console` entries with type `error` often identify import, CSP, WebGL, or runtime issues.
- `failedRequests` and `badResponses` distinguish missing assets from app logic bugs.
- A public URL failing while localhost passes points at Caddy path handling, allowlists,
  base URLs, HTTPS-only behavior, or domain routing.
- A localhost blank page with page errors is an app bug. Fix that first.

Do not use this skill to mutate `/etc/caddy/Caddyfile`; gather evidence first, then make
the smallest config change separately.
