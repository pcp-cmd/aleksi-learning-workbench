import { mkdir, readdir, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  MAX_PROJECTION_JSON_BYTES,
  readProjectionFile
} from "../../server/projections/projection-file";
import { readIndexProjection } from "../../server/services/index-service";
import { createTempVaultContext } from "../temp-vault";

const fixtureSchema = z.object({ ok: z.boolean() }).strict();

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:fs/promises");
  vi.restoreAllMocks();
});

describe("bounded projection reads", () => {
  it("quarantines malformed cache JSON so the projection can be rebuilt", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const projectionDirectory = join(vaultPath, ".aleksi");
    const projectionPath = join(projectionDirectory, "fixture.json");
    await mkdir(projectionDirectory, { recursive: true });
    await writeFile(projectionPath, "{broken", "utf8");

    await expect(
      readProjectionFile(vaultPath, ".aleksi/fixture.json", fixtureSchema)
    ).resolves.toBeNull();
    const files = await readdir(projectionDirectory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^fixture\.json\.corrupt-/u);
  });

  it("rejects an oversized index projection before parsing it", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const projectionPath = join(vaultPath, ".aleksi", "index.json");

    await mkdir(join(vaultPath, ".aleksi"), { recursive: true });
    await writeFile(projectionPath, "{}", "utf8");
    await truncate(projectionPath, MAX_PROJECTION_JSON_BYTES + 1);

    await expect(
      readIndexProjection(vaultPath)
    ).rejects.toMatchObject({
      code: "PROJECTION_FILE_TOO_LARGE",
      status: 413
    });
  });

  it("rejects a projection path reported as a symlink before opening it", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const relativePath = ".aleksi/symlink.json";
    const projectionPath = join(vaultPath, ".aleksi", "symlink.json");
    const originalFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
    let openCalled = false;

    await mkdir(join(vaultPath, ".aleksi"), { recursive: true });
    await writeFile(projectionPath, '{"ok":true}\n', "utf8");

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      lstat: async (...args: Parameters<typeof originalFs.lstat>) => {
        const information = await originalFs.lstat(...args);
        if (String(args[0]) !== projectionPath) {
          return information;
        }
        return new Proxy(information, {
          get(target, property) {
            if (property === "isSymbolicLink") {
              return () => true;
            }
            return Reflect.get(target, property, target);
          }
        });
      },
      open: async (...args: Parameters<typeof originalFs.open>) => {
        if (String(args[0]) === projectionPath) {
          openCalled = true;
        }
        return originalFs.open(...args);
      }
    }));

    const { readProjectionFile: readSafeProjection } = await import(
      "../../server/projections/projection-file"
    );
    await expect(
      readSafeProjection(vaultPath, relativePath, fixtureSchema)
    ).rejects.toMatchObject({
      code: "INVALID_PROJECTION_FILE"
    });
    expect(openCalled).toBe(false);
  });
});
