#!/usr/bin/env node
import { parseArgs, verifyDownloads } from "./package.js";

await verifyDownloads(parseArgs(process.argv.slice(2), process.env));
