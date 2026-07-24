#!/usr/bin/env node
import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function usage() {
  console.error("usage: node tools/scripts/validate-release.js <release.yaml|release.json>");
}

async function readRelease(path) {
  const text = await readFile(path, "utf8");
  const ext = extname(path).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    return YAML.parse(text);
  }

  return JSON.parse(text);
}

function formatErrors(errors) {
  return errors
    .map((error) => {
      const location = error.instancePath || "/";
      return `${location} ${error.message}`;
    })
    .join("\n");
}

const [releasePath] = process.argv.slice(2).filter((arg) => arg !== "--");

if (!releasePath) {
  usage();
  process.exit(2);
}

const schemaPath = resolve(repoRoot, "contracts/schemas/release-manifest.schema.json");
const dataPath = resolve(process.cwd(), releasePath);

try {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const manifest = await readRelease(dataPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(manifest)) {
    console.error(`invalid release manifest: ${releasePath}`);
    console.error(formatErrors(validate.errors ?? []));
    process.exit(1);
  }

  console.log(`valid release manifest: ${releasePath}`);
} catch (error) {
  console.error(`release validation failed: ${error.message}`);
  process.exit(1);
}
