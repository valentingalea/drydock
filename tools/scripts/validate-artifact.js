#!/usr/bin/env node
import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function usage() {
  console.error("usage: node tools/scripts/validate-artifact.js <drydock-artifact.json>");
}

async function readJson(path) {
  const text = await readFile(path, "utf8");
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

const [manifestPath] = process.argv.slice(2).filter((arg) => arg !== "--");

if (!manifestPath) {
  usage();
  process.exit(2);
}

const schemaPath = resolve(repoRoot, "contracts/schemas/drydock-artifact.schema.json");
const dataPath = resolve(process.cwd(), manifestPath);

try {
  const schema = await readJson(schemaPath);
  const manifest = await readJson(dataPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(manifest)) {
    console.error(`invalid artifact manifest: ${manifestPath}`);
    console.error(formatErrors(validate.errors ?? []));
    process.exit(1);
  }

  console.log(`valid artifact manifest: ${manifestPath}`);
} catch (error) {
  console.error(`artifact validation failed: ${error.message}`);
  process.exit(1);
}
