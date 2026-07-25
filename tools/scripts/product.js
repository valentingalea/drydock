import { execFile } from "node:child_process";
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";

const execFileAsync = promisify(execFile);
const contractName = "drydock-product.json";
const pinnedProductPath = "product";
const reservedRuntimeEntries = [
  {
    source: "runtime/web/host-bridge.js",
    target: "host-bridge.js"
  },
  {
    source: "runtime/web/vendor/drydock-host-bridge",
    target: "vendor/drydock-host-bridge"
  }
];

export async function loadProduct(repoRoot, options = {}) {
  const productRoot = resolveProductRoot(repoRoot, options.productRoot);
  const contractPath = resolveWithin(productRoot, contractName);
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  await validateContract(repoRoot, contract);

  const drydockEntries = await resolveEntries(repoRoot, reservedRuntimeEntries, "drydock");
  const productEntries = await resolveEntries(productRoot, contract.entries, "product");

  for (const entry of productEntries) {
    if (entry.target !== "index.html" && !entry.target.startsWith("product/")) {
      throw new Error(
        `product runtime target must be index.html or live under product/: ${entry.target}`
      );
    }

    for (const reserved of drydockEntries) {
      if (targetsOverlap(entry, reserved)) {
        throw new Error(`product runtime target overlaps Drydock runtime: ${entry.target}`);
      }
    }
  }

  if (!targetCovered(productEntries, contract.entrypoint)) {
    throw new Error(`product entrypoint is not staged: ${contract.entrypoint}`);
  }

  return {
    ...contract,
    contractName,
    contractPath: productRoot === resolve(repoRoot, pinnedProductPath)
      ? `${pinnedProductPath}/${contractName}`
      : contractPath,
    entries: [...drydockEntries, ...productEntries],
    productRoot
  };
}

export async function stageProduct(product, outDir) {
  for (const entry of product.entries) {
    const targetPath = resolveWithin(outDir, entry.target);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(entry.sourcePath, targetPath, {
      recursive: entry.directory,
      dereference: true,
      force: true
    });
  }
}

export function resolveProductRequest(product, pathname) {
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const withIndex = requested.endsWith("/") ? `${requested}index.html` : requested;
  const normalized = posix.normalize(withIndex).replace(/^\/+/, "");

  if (
    normalized === ""
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("\\")
  ) {
    return null;
  }

  for (const entry of [...product.entries].reverse()) {
    if (!entry.directory && normalized === entry.target) {
      return entry.sourcePath;
    }

    if (entry.directory && normalized.startsWith(`${entry.target}/`)) {
      const suffix = normalized.slice(entry.target.length + 1);
      return resolveWithin(entry.sourcePath, suffix);
    }
  }

  return null;
}

export async function readProductRevision(repoRoot, product) {
  const [{ stdout: commit }, { stdout: remote }, tag] = await Promise.all([
    execFileAsync("git", ["-C", product.productRoot, "rev-parse", "HEAD"]),
    execFileAsync("git", ["-C", product.productRoot, "remote", "get-url", "origin"]),
    readExactTag(product.productRoot)
  ]);

  return {
    path: pinnedProductPath,
    contract: `${pinnedProductPath}/${contractName}`,
    commit: commit.trim(),
    remote: remote.trim(),
    tag
  };
}

export async function verifyPinnedProduct(repoRoot, mode = "--strict") {
  const verifier = resolveWithin(repoRoot, "tools/scripts/verify-product.sh");
  const { stdout, stderr } = await execFileAsync(verifier, [mode]);

  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
}

export function resolveProductRoot(repoRoot, override) {
  if (!override) {
    return resolve(repoRoot, pinnedProductPath);
  }

  return isAbsolute(override) ? resolve(override) : resolve(repoRoot, override);
}

async function validateContract(repoRoot, contract) {
  const schema = JSON.parse(
    await readFile(resolve(repoRoot, "contracts/schemas/drydock-product.schema.json"), "utf8")
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  if (!validate(contract)) {
    throw new Error(`invalid product contract: ${JSON.stringify(validate.errors, null, 2)}`);
  }
}

async function resolveEntries(root, entries, owner) {
  const resolved = [];

  for (const entry of entries) {
    assertRelativePath(entry.source, `${owner} source`);
    assertRelativePath(entry.target, `${owner} target`);

    const sourcePath = resolveWithin(root, entry.source);
    const sourceStat = await stat(sourcePath);
    resolved.push({
      ...entry,
      directory: sourceStat.isDirectory(),
      owner,
      sourcePath
    });
  }

  return resolved;
}

async function readExactTag(productRoot) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", productRoot, "describe", "--tags", "--exact-match", "HEAD"]
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function targetCovered(entries, target) {
  return entries.some((entry) => (
    entry.directory
      ? target.startsWith(`${entry.target}/`)
      : target === entry.target
  ));
}

function targetsOverlap(left, right) {
  if (left.target === right.target) {
    return true;
  }

  if (left.directory && right.target.startsWith(`${left.target}/`)) {
    return true;
  }

  return right.directory && left.target.startsWith(`${right.target}/`);
}

function assertRelativePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.startsWith("/")
    || value.includes("\\")
    || value.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a safe relative path: ${value}`);
  }
}

function resolveWithin(root, path) {
  const absolute = resolve(root, path);
  const within = relative(root, absolute);

  if (within === "" || (!within.startsWith("..") && !within.includes(`..${sep}`))) {
    return absolute;
  }

  throw new Error(`path escapes root: ${path}`);
}
