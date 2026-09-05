import {
  analyzeAtlasAccessProbe,
  ATLAS_ACCESS_CORE_ARMS,
  ATLAS_ACCESS_POINTER_ARM,
  buildAccessMessages,
  executeAtlasAccessSession,
  pointerRecordId,
} from "./atlas-access-probe.js";

export {
  analyzeAtlasAccessProbe,
  ATLAS_ACCESS_CORE_ARMS,
  ATLAS_ACCESS_POINTER_ARM,
  pointerRecordId,
};

export const ATLAS_ACCESS_V2_OUTPUT_CONTRACT = [
  "Output contract (the literal enum spellings and field names are mandatory):",
  '{"classification":"prior_attempt","decision":"reject_duplicate","ideaIds":["<returned Idea ID>"],"matches":[{"submissionId":"<returned ID>","changeId":"<returned ID>","status":"<returned status>","outcome":"<returned outcome>","sourceRefs":["<returned source-reference ID>"]}],"caveats":[]}',
  "Allowed classification values: prior_attempt, no_prior_attempt, uncertain.",
  "Allowed decision values: reject_duplicate, investigate_novel, uncertain.",
  "For this positive-case assay, return exactly one best grounded match. Do not add fields and do not rename sourceRefs.",
].join("\n");

export const ATLAS_ACCESS_PROBE_V2_SCHEMA = "yukon.atlas-access-probe.v2";

export function withV2OutputContract(candidate) {
  return {
    ...candidate,
    query: `${candidate.query}\n\n${ATLAS_ACCESS_V2_OUTPUT_CONTRACT}`,
  };
}

export function buildAccessMessagesV2(candidate, options = {}) {
  return buildAccessMessages(withV2OutputContract(candidate), options);
}

export async function executeAtlasAccessSessionV2(options = {}) {
  const result = await executeAtlasAccessSession({
    ...options,
    candidate: withV2OutputContract(options.candidate),
  });
  return { ...result, schema: ATLAS_ACCESS_PROBE_V2_SCHEMA };
}
