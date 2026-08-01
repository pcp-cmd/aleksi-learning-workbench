import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertAssetVersion,
  readAssetVersion,
  readVersionedText
} from "../../server/lib/asset-version";
import { createTempVaultContext } from "../temp-vault";

describe("asset version", () => {
  it("captures content and filesystem identity and accepts the unchanged file", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const target = join(vaultPath, "asset.md");
    await mkdir(vaultPath, { recursive: true });
    await writeFile(target, "first", "utf8");

    const snapshot = await readVersionedText(target);

    expect(snapshot.content).toBe("first");
    expect(snapshot.version).toEqual({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      size: 5,
      mtimeNs: expect.stringMatching(/^\d+$/u),
      inode: expect.stringMatching(/^\d+$/u)
    });
    await expect(
      assertAssetVersion(target, "asset.md", snapshot.version)
    ).resolves.toBeUndefined();
  });

  it("rejects an external replacement even when its bytes are identical", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const target = join(vaultPath, "asset.md");
    const replacement = join(vaultPath, "replacement.md");
    await mkdir(vaultPath, { recursive: true });
    await writeFile(target, "same bytes", "utf8");
    const expected = await readAssetVersion(target);
    await writeFile(replacement, "same bytes", "utf8");
    await rename(replacement, target);

    await expect(
      assertAssetVersion(target, "asset.md", expected)
    ).rejects.toMatchObject({
      code: "ASSET_VERSION_CONFLICT",
      status: 409,
      relativePath: "asset.md"
    });
  });

  it("treats nonexistence as a version for create-only CAS", async () => {
    const context = await createTempVaultContext();
    const target = context.path("Vault", "new.md");

    await expect(
      assertAssetVersion(target, "new.md", null)
    ).resolves.toBeUndefined();

    await mkdir(context.path("Vault"), { recursive: true });
    await writeFile(target, "claimed", "utf8");
    await expect(
      assertAssetVersion(target, "new.md", null)
    ).rejects.toMatchObject({ code: "ASSET_VERSION_CONFLICT" });
  });
});
