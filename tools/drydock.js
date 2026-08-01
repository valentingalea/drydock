#!/usr/bin/env node

import { validateProjectCommand } from "./project.js";
import {
  CliUsageError,
  harnessRoot,
  isDirectInvocation,
  resolveProjectContext
} from "./context.js";
export {
  CliUsageError,
  harnessRoot,
  isDirectInvocation,
  resolveProjectContext,
  resolveProjectPath
} from "./context.js";

const SUPPORTED_COMMANDS = new Set([
  "validate",
  "iterate",
  "build",
  "package",
  "publish"
]);
const DEFAULT_COMMANDS = Object.freeze({
  build: buildCommand,
  iterate: iterateCommand,
  package: packageCommand,
  publish: publishCommand,
  validate: validateProjectCommand
});

export function parseCliArgs(argv) {
  const result = {
    command: null,
    commandArgs: [],
    help: false,
    project: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }

    if (argument === "--project") {
      if (result.project !== null) {
        throw new CliUsageError("--project may be provided only once");
      }

      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CliUsageError("--project requires a path");
      }

      result.project = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--project=")) {
      if (result.project !== null) {
        throw new CliUsageError("--project may be provided only once");
      }

      const value = argument.slice("--project=".length);
      if (!value) {
        throw new CliUsageError("--project requires a path");
      }

      result.project = value;
      continue;
    }

    if (result.command === null) {
      if (argument.startsWith("-")) {
        throw new CliUsageError(`unknown global option: ${argument}`);
      }

      result.command = argument;
      continue;
    }

    result.commandArgs.push(argument);
  }

  if (result.help) {
    return result;
  }

  if (result.command === null) {
    throw new CliUsageError("a command is required");
  }

  if (!SUPPORTED_COMMANDS.has(result.command)) {
    throw new CliUsageError(`unknown command: ${result.command}`);
  }

  if (result.project === null) {
    throw new CliUsageError("--project is required");
  }

  return result;
}

export async function runCli(
  argv,
  {
    commands = DEFAULT_COMMANDS,
    invocationCwd,
    stderr = process.stderr,
    stdout = process.stdout
  } = {}
) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    if (!(error instanceof CliUsageError)) {
      throw error;
    }

    stderr.write(`ERROR: ${error.message}\n`);
    stderr.write('Run "drydock --help" for usage.\n');
    return 2;
  }

  if (parsed.help) {
    stdout.write(helpText());
    return 0;
  }

  let context;
  try {
    context = await resolveProjectContext(parsed.project, {
      invocationCwd
    });
  } catch (error) {
    if (!(error instanceof CliUsageError)) {
      throw error;
    }

    stderr.write(`ERROR: ${error.message}\n`);
    return 2;
  }

  const handler = commands[parsed.command];
  if (typeof handler !== "function") {
    stderr.write(`ERROR: command is not implemented yet: ${parsed.command}\n`);
    return 2;
  }

  const result = await handler({
    args: parsed.commandArgs,
    context,
    stderr,
    stdout
  });

  return Number.isInteger(result) ? result : 0;
}

export function helpText() {
  return [
    "Drydock",
    "",
    "Usage:",
    "  drydock <command> --project shipping/drydock-project.json [options]",
    "",
    "Commands:",
    "  validate",
    "  iterate",
    "  build",
    "  package",
    "  publish",
    ""
  ].join("\n");
}

async function iterateCommand({ args, ...input }) {
  if (args[0] !== "web") {
    input.stderr.write(
      "ERROR: usage: iterate web [--port PORT]\n"
    );
    return 2;
  }

  const { startLiveWeb } = await import(
    "../platforms/web/iterate/caddy-live/server.js"
  );
  await startLiveWeb({
    ...input,
    args: args.slice(1)
  });
  return 0;
}

async function buildCommand({ args, ...input }) {
  if (args[0] === "web-static") {
    const { buildStaticWebCommand } = await import(
      "../platforms/web/build/static/build.js"
    );
    return buildStaticWebCommand({
      ...input,
      args: args.slice(1)
    });
  }

  if (args[0] === "electron") {
    const electron = await import(
      "../platforms/desktop/build/electron/build.js"
    );
    return electron.buildElectronCommand({
      ...input,
      args: args.slice(1)
    });
  }

  input.stderr.write(
    "ERROR: usage: build <web-static|electron> --release PATH [options]\n"
  );
  return 2;
}

async function packageCommand({ args, ...input }) {
  if (args[0] !== "downloads") {
    input.stderr.write(
      "ERROR: usage: package downloads --artifact PATH [options]\n"
    );
    return 2;
  }

  const { packageDownloadsCommand } = await import(
    "../platforms/desktop/channels/downloads/package.js"
  );
  return packageDownloadsCommand({
    ...input,
    args: args.slice(1)
  });
}

async function publishCommand({ args, ...input }) {
  if (args[0] === "downloads") {
    const { publishDownloadsCommand } = await import(
      "../platforms/desktop/channels/downloads/publish.js"
    );
    return publishDownloadsCommand({
      ...input,
      args: args.slice(1)
    });
  }

  if (args[0] !== "vps") {
    input.stderr.write(
      "ERROR: usage: publish <downloads|vps> [options]\n"
    );
    return 2;
  }

  const { publishVpsCommand } = await import(
    "../platforms/web/channels/vps/publish.js"
  );
  return publishVpsCommand({
    ...input,
    args: args.slice(1)
  });
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  const exitCode = await runCli(process.argv.slice(2), {
    invocationCwd: process.cwd()
  });
  process.exitCode = exitCode;
}
