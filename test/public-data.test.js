import { describe, expect, test } from "bun:test";
import { verifyPublicData } from "../src/verify-public-data.js";

describe("public ECDSA Atlas data", () => {
  test("matches every indexed manifest, byte count, and artifact hash", async () => {
    const report = await verifyPublicData();
    expect(report.status).toBe("PASS");
    expect(report.releases).toHaveLength(2);
    expect(report.releases.every((release) => release.files > 250)).toBe(true);
  });
});

