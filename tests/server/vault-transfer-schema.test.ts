import { describe, expect, it } from "vitest";
import {
  vaultTransferManifestSchema
} from "../../server/services/vault-transfer-schema";

function validManifest() {
  return {
    schemaVersion: 1,
    transactionId: "11111111-1111-4111-8111-111111111111",
    operation: "migration",
    sourceVaultId: "22222222-2222-4222-8222-222222222222",
    sourcePath: "C:\\Source",
    finalPath: "C:\\Destination",
    startedAt: "2026-07-29T00:00:00.000Z",
    completed: true,
    phase: "ready",
    files: [
      {
        relativePath: "01-阅读/source.md",
        sha256: "a".repeat(64),
        size: 10
      }
    ],
    finalFiles: [
      {
        relativePath: "01-阅读/source.md",
        sha256: "a".repeat(64),
        size: 10
      }
    ]
  };
}

describe("strict Vault transfer manifests", () => {
  it("accepts one internally consistent canonical manifest", () => {
    expect(vaultTransferManifestSchema.parse(validManifest())).toMatchObject({
      operation: "migration",
      completed: true,
      phase: "ready"
    });
  });

  it.each([
    { ...validManifest(), extra: true },
    {
      ...validManifest(),
      files: [
        validManifest().files[0],
        { ...validManifest().files[0] }
      ]
    },
    {
      ...validManifest(),
      files: [
        {
          ...validManifest().files[0],
          relativePath: "../outside.md"
        }
      ]
    },
    {
      ...validManifest(),
      sourcePath: "\\root-relative"
    },
    {
      ...validManifest(),
      completed: false,
      phase: "ready"
    },
    {
      ...validManifest(),
      transactionId: "not-a-uuid"
    },
    {
      ...validManifest(),
      finalFiles: [
        {
          ...validManifest().files[0],
          sha256: "not-a-hash"
        }
      ]
    }
  ])("rejects malformed or ambiguous transfer state", (manifest) => {
    expect(vaultTransferManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
