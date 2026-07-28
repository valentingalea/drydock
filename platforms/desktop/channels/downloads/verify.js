#!/usr/bin/env node
import { parseVerifyArgs, verifyDownloads } from "./package.js";

await verifyDownloads(parseVerifyArgs(process.argv.slice(2), process.env));
