#!/usr/bin/env node
import { parseArgs, publishDownloads } from "./package.js";

await publishDownloads(parseArgs(process.argv.slice(2)));
