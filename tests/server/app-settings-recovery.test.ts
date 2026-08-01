import {
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getAppSettingsDirectory,
  inspectAppSettingsRecovery,
  readAppSettings,
  writeAppSettings
} from "../../server/config/app-settings";
import { FaultController } from "../../server/testing/fault-controller";
import { createTempVaultContext, type TempVaultContext } from "../temp-vault";

let context: TempVaultContext;

async function raw(name: string): Promise<string> {
  return readFile(join(getAppSettingsDirectory(), name), "utf8");
}

beforeEach(async () => {
  context = await createTempVaultContext();
});

describe("mirrored app settings recovery", () => {
  it("repairs a missing mirror from the valid primary", async () => {
    const expected = await writeAppSettings(context.path("Vault A"));
    await rm(join(context.settingsDir, "settings.mirror.json"));

    await expect(readAppSettings()).resolves.toEqual(expected);
    await expect(raw("settings.mirror.json")).resolves.toBe(
      await raw("settings.json")
    );
  });

  it("repairs a missing primary from the valid mirror", async () => {
    const expected = await writeAppSettings(context.path("Vault B"));
    await rm(join(context.settingsDir, "settings.json"));

    await expect(readAppSettings()).resolves.toEqual(expected);
    await expect(raw("settings.json")).resolves.toBe(
      await raw("settings.mirror.json")
    );
  });

  it("chooses the highest valid revision and repairs a divergent copy", async () => {
    await writeAppSettings(context.path("Vault C"));
    const revisionOne = await raw("settings.json");
    const expected = await writeAppSettings(context.path("Vault D"));
    await writeFile(
      join(context.settingsDir, "settings.json"),
      revisionOne,
      "utf8"
    );

    await expect(readAppSettings()).resolves.toEqual(expected);
    await expect(raw("settings.json")).resolves.toBe(
      await raw("settings.mirror.json")
    );
  });

  it("returns recovery-required candidates when both copies are corrupt", async () => {
    const path = context.path("Known Vault");
    await writeAppSettings(path);
    await writeFile(join(context.settingsDir, "settings.json"), "{bad", "utf8");
    await writeFile(
      join(context.settingsDir, "settings.mirror.json"),
      "also bad",
      "utf8"
    );

    await expect(readAppSettings()).resolves.toBeNull();
    await expect(inspectAppSettingsRecovery()).resolves.toMatchObject({
      status: "recovery-required",
      recentCandidates: [path]
    });
  });

  it("keeps both locator copies durable when optional history is unavailable", async () => {
    await mkdir(join(context.settingsDir, "settings.history.jsonl"), {
      recursive: true
    });

    const settings = await writeAppSettings(context.path("Vault E"));

    expect(settings.revision).toBe(1);
    await expect(raw("settings.json")).resolves.toBe(
      await raw("settings.mirror.json")
    );
    const recovery = await inspectAppSettingsRecovery();
    expect(recovery.status).toBe("ready");
    expect(recovery.diagnostics.length).toBeLessThanOrEqual(16);
  });

  it("rejects root-relative and ordinary relative locator paths", async () => {
    await expect(writeAppSettings("relative/Vault")).rejects.toMatchObject({
      code: "INVALID_APP_SETTINGS"
    });
    await expect(writeAppSettings("\\Windows\\Temp\\Vault")).rejects.toMatchObject({
      code: "INVALID_APP_SETTINGS"
    });
    await mkdir(context.settingsDir, { recursive: true });
    await writeFile(
      join(context.settingsDir, "settings.json"),
      `${JSON.stringify({
        activeVaultPath: "\\Windows\\Temp\\Vault",
        updatedAt: "2026-07-29T00:00:00.000Z"
      })}\n`,
      "utf8"
    );
    await writeFile(
      join(context.settingsDir, "settings.mirror.json"),
      `${JSON.stringify({
        activeVaultPath: "relative/Vault",
        updatedAt: "2026-07-29T00:00:00.000Z"
      })}\n`,
      "utf8"
    );

    await expect(readAppSettings()).resolves.toBeNull();
    const recovery = await inspectAppSettingsRecovery();
    expect(recovery.status).toBe("recovery-required");
    expect(recovery.recentCandidates).toEqual([]);
  });

  it("recovers after termination at either copy replacement boundary", async () => {
    const primaryFaults = new FaultController();
    primaryFaults.install("app-settings:after-primary-replace", {
      kind: "throw",
      error: new Error("terminated after primary")
    });
    await expect(
      writeAppSettings(context.path("Vault F"), { faults: primaryFaults })
    ).rejects.toThrow("terminated after primary");
    const primaryRecovered = await readAppSettings();
    expect(primaryRecovered?.activeVaultPath).toBe(context.path("Vault F"));

    const mirrorFaults = new FaultController();
    mirrorFaults.install("app-settings:after-mirror-replace", {
      kind: "throw",
      error: new Error("terminated after mirror")
    });
    await expect(
      writeAppSettings(context.path("Vault G"), { faults: mirrorFaults })
    ).rejects.toThrow("terminated after mirror");
    const mirrorRecovered = await readAppSettings();
    expect(mirrorRecovered?.activeVaultPath).toBe(context.path("Vault G"));
  });

  it("bounds retained history and diagnostics", async () => {
    for (let index = 0; index < 40; index += 1) {
      await writeAppSettings(context.path(`Vault ${index}`));
    }
    const history = (await raw("settings.history.jsonl"))
      .trim()
      .split("\n");
    expect(history.length).toBeLessThanOrEqual(32);

    await writeFile(join(context.settingsDir, "settings.json"), "bad", "utf8");
    await writeFile(
      join(context.settingsDir, "settings.mirror.json"),
      "bad",
      "utf8"
    );
    const recovery = await inspectAppSettingsRecovery();
    expect(recovery.diagnostics.length).toBeLessThanOrEqual(16);
    expect(recovery.recentCandidates.length).toBeLessThanOrEqual(16);
  });
});
