#!/usr/bin/env bun

import process from "node:process";
import { loadIndexedAtlasRelease } from "./atlas-local.js";
import { buildEcdsaWorkingKnowledgeBrief } from "./atlas-runtime/working-knowledge.ts";
import { canonicalStringify } from "./protocol.js";

const purpose = process.argv.includes("--retrieval") ? "retrieval" : "default";

const { release, experimentDetails } = await loadIndexedAtlasRelease(purpose);
const brief = buildEcdsaWorkingKnowledgeBrief(release, experimentDetails);
process.stdout.write(`${canonicalStringify(brief)}\n`);
