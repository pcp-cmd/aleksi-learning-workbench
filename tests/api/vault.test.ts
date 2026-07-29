import {
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { FaultController } from "../../server/testing/fault-controller";
import { migrateVault } from "../../server/services/vault-service";
import {
  CARD_DIRECTORIES,
  LEGACY_CARD_DIRECTORIES,
  PRIMARY_CARD_DIRECTORIES,
  READING_DIRECTORY
} from "../../shared/vault-map";
import {
  createTempVaultContext,
  readAppSettings,
  readJsonFile,
  VAULT_FOLDERS,
  writeAppSettings
} from "../temp-vault";

const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function expectDirectory(path: string): Promise<void> {
  await expect(stat(path)).resolves.toMatchObject({
    isDirectory: expect.any(Function)
  });
  expect((await stat(path)).isDirectory()).toBe(true);
}

async function expectFile(path: string): Promise<void> {
  await expect(stat(path)).resolves.toMatchObject({
    isFile: expect.any(Function)
  });
  expect((await stat(path)).isFile()).toBe(true);
}

async function expectInitializedVaultTree(path: string): Promise<void> {
  for (const folder of VAULT_FOLDERS) {
    await expectDirectory(join(path, folder));
  }

  for (const filename of [
    "index.json",
    "review-queue.json",
    "graph-state.json",
    "settings.json"
  ]) {
    await expectFile(join(path, ".aleksi", filename));
  }
}

function isErrorCode(
  error: unknown,
  ...codes: string[]
): error is Error & { code: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function expectMissing(path: string): Promise<void> {
  expect(await pathExists(path)).toBe(false);
}

function expectApiError(
  response: SupertestResponse,
  code?: string
): void {
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.body).toMatchObject({
    error: {
      code: code ?? expect.any(String),
      message: expect.any(String)
    }
  });
}

async function postMaybeBody(
  app: ReturnType<typeof createApp>,
  route: string,
  body: string | object | undefined
): Promise<SupertestResponse> {
  const builder = request(app).post(route);
  return body === undefined ? builder : builder.send(body);
}

async function backupDirectoryNames(vaultPath: string): Promise<string[]> {
  return (await readdir(dirname(vaultPath)))
    .filter((name) => name.startsWith("Aleksi-Learning-Vault-backup-"))
    .sort();
}

async function writeRawAppSettings(
  settingsDir: string,
  raw: string
): Promise<void> {
  await mkdir(settingsDir, { recursive: true });
  await writeFile(join(settingsDir, "settings.json"), raw, "utf8");
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.ALEKSI_DEFAULT_VAULT_PATH;
  delete process.env.ALEKSI_APP_DATA_VAULT_PATH;
});

describe("Vault settings API", () => {
  it("returns the backend-recommended default learning-library path", async () => {
    const context = await createTempVaultContext();
    const defaultPath = context.path("Aleksi Learning Workbench");
    process.env.ALEKSI_DEFAULT_VAULT_PATH = defaultPath;

    const response = await request(createApp()).get("/api/vault/recommended-path");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      path: defaultPath
    });
  });

  it("auto-prepares the default local learning library when no active path is configured", async () => {
    const context = await createTempVaultContext();
    const defaultPath = context.path("Aleksi Learning Workbench");
    process.env.ALEKSI_DEFAULT_VAULT_PATH = defaultPath;

    const response = await request(createApp()).post("/api/vault/auto-prepare");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: {
        path: defaultPath,
        initialized: true,
        writable: true,
        readOnlyReason: null,
        lastSaveAt: null
      }
    });
    await expectInitializedVaultTree(defaultPath);
    expect(await readAppSettings(context.settingsDir)).toEqual({
      activeVaultPath: defaultPath,
      updatedAt: expect.stringMatching(ISO_UTC_MS)
    });
  });

  it("auto-prepare reuses an initialized active learning library without creating the default path", async () => {
    const context = await createTempVaultContext();
    const activePath = context.path("ActiveLearningLibrary");
    const defaultPath = context.path("ShouldNotBeCreated");
    process.env.ALEKSI_DEFAULT_VAULT_PATH = defaultPath;
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: activePath });
    expect(initialize.status).toBe(200);

    const response = await request(app).post("/api/vault/auto-prepare");

    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      path: activePath,
      initialized: true,
      writable: true
    });
    await expectMissing(defaultPath);
  });

  it("falls back to Documents when the remembered learning library is unavailable", async () => {
    const context = await createTempVaultContext();
    const unavailablePath = context.path("UnavailableLibrary");
    const documentsPath = context.path("DocumentsLibrary");
    await writeFile(unavailablePath, "not a directory", "utf8");
    await writeRawAppSettings(
      context.settingsDir,
      JSON.stringify({
        activeVaultPath: unavailablePath,
        updatedAt: "2026-07-17T00:00:00.000Z"
      })
    );
    process.env.ALEKSI_DEFAULT_VAULT_PATH = documentsPath;

    const response = await request(createApp()).post("/api/vault/auto-prepare");

    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      path: documentsPath,
      initialized: true,
      writable: true
    });
    await expectInitializedVaultTree(documentsPath);
  });

  it("falls back to the desktop app-data library when Documents is unavailable", async () => {
    const context = await createTempVaultContext();
    const unavailableDocumentsPath = context.path("UnavailableDocuments");
    const appDataPath = context.path("AppDataLibrary");
    await writeFile(unavailableDocumentsPath, "not a directory", "utf8");
    process.env.ALEKSI_DEFAULT_VAULT_PATH = unavailableDocumentsPath;
    process.env.ALEKSI_APP_DATA_VAULT_PATH = appDataPath;

    const response = await request(createApp()).post("/api/vault/auto-prepare");

    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      path: appDataPath,
      initialized: true,
      writable: true
    });
    await expectInitializedVaultTree(appDataPath);
  });

  it("initializes the required folder tree without overwriting existing learning data", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const existingReadingPath = join(vaultPath, READING_DIRECTORY, "existing-reading.md");
    await mkdir(dirname(existingReadingPath), { recursive: true });
    await writeFile(existingReadingPath, "existing learning content\n", "utf8");

    const response = await request(createApp())
      .post("/api/vault/initialize")
      .send({ path: vaultPath });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: {
        path: vaultPath,
        initialized: true,
        writable: true,
        readOnlyReason: null,
        lastSaveAt: null
      }
    });
    await expectInitializedVaultTree(vaultPath);
    await expect(readFile(existingReadingPath, "utf8")).resolves.toBe(
      "existing learning content\n"
    );

    const vaultSettingsRaw = await readFile(
      join(vaultPath, ".aleksi", "settings.json"),
      "utf8"
    );
    expect(vaultSettingsRaw).toMatch(
      /^\{\n  "schemaVersion": 1,\n  "vaultId": "[^"]+"\n\}\n$/u
    );
    const vaultSettings = JSON.parse(vaultSettingsRaw) as {
      schemaVersion: number;
      vaultId: string;
    };
    expect(Object.keys(vaultSettings)).toEqual(["schemaVersion", "vaultId"]);
    expect(vaultSettings).toEqual({
      schemaVersion: 1,
      vaultId: expect.stringMatching(UUID_V4)
    });

    const appSettings = await readAppSettings(context.settingsDir);
    expect(appSettings).toEqual({
      activeVaultPath: vaultPath,
      updatedAt: expect.stringMatching(ISO_UTC_MS)
    });
  });

  it("starts a new production learning library with empty reading and card folders", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");

    const response = await request(createApp())
      .post("/api/vault/initialize")
      .send({ path: vaultPath });

    expect(response.status).toBe(200);

    expect(await readdir(join(vaultPath, READING_DIRECTORY))).toEqual([]);
    expect(await readdir(join(vaultPath, CARD_DIRECTORIES.concept))).toEqual([]);

    const index = await readJsonFile<{
      assets: Array<{
        id: string;
        assetType: string;
        title: string;
        concept: string | null;
        relativePath: string;
      }>;
      parseErrors: unknown[];
    }>(join(vaultPath, ".aleksi", "index.json"));

    expect(index.parseErrors).toEqual([]);
    expect(index.assets).toEqual([]);
  });

  it("initializes an empty production learning library at a Chinese path", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("学习资料", "数列极限知识库");

    const response = await request(createApp())
      .post("/api/vault/initialize")
      .send({ path: vaultPath });

    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      path: vaultPath,
      initialized: true,
      writable: true
    });
    await expectInitializedVaultTree(vaultPath);
    expect(await readdir(join(vaultPath, READING_DIRECTORY))).toEqual([]);
    for (const directory of Object.values(PRIMARY_CARD_DIRECTORIES)) {
      expect(await readdir(join(vaultPath, directory))).toEqual([]);
    }
  });

  it("normalizes quoted learning-library paths for initialize, select, and migrate without weakening path safety", async () => {
    const context = await createTempVaultContext();
    const initializedPath = context.path("Quoted Initialize Vault");
    const selectedPath = context.path("Quoted Select Vault");
    const sourcePath = context.path("Quoted Source Vault");
    const destinationPath = context.path("Quoted Destination Vault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: `"${initializedPath}"` });
    expect(initialize.status).toBe(200);
    expect(initialize.body.status.path).toBe(initializedPath);

    await request(app).post("/api/vault/initialize").send({ path: selectedPath });
    const select = await request(app)
      .post("/api/vault/select")
      .send({ path: `“${selectedPath}”` });
    expect(select.status).toBe(200);
    expect(select.body.status.path).toBe(selectedPath);

    await request(app).post("/api/vault/initialize").send({ path: sourcePath });
    const migrate = await request(app).post("/api/vault/migrate").send({
      sourcePath: `‘${sourcePath}’`,
      destinationPath: `'${destinationPath}'`,
      confirmed: true
    });
    expect(migrate.status).toBe(200);
    expect(migrate.body.status.path).toBe(destinationPath);

    for (const body of [
      { path: "../vault" },
      { path: "vault" },
      { path: `${context.root}/../Other` },
      { path: "\\Users\\pcp\\Documents" }
    ]) {
      const response = await request(app).post("/api/vault/initialize").send(body);
      expectApiError(response, "INVALID_ABSOLUTE_PATH");
      expect(response.body.error.message).toContain("学习库位置必须是完整路径");
    }
  });

  it("rejects unknown initialize fields without mutating settings or Vault files", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");

    const response = await request(createApp())
      .post("/api/vault/initialize")
      .send({ path: vaultPath, confirmed: true });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body).toMatchObject({
      error: {
        code: expect.any(String),
        message: expect.any(String)
      }
    });
    await expect(stat(vaultPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readAppSettings(context.settingsDir)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("persists the active Vault path when selecting an initialized Vault", async () => {
    const context = await createTempVaultContext();
    const firstVault = context.path("FirstVault");
    const secondVault = context.path("SecondVault");
    const app = createApp();

    await request(app).post("/api/vault/initialize").send({ path: firstVault });
    await request(app).post("/api/vault/initialize").send({ path: secondVault });

    const response = await request(app)
      .post("/api/vault/select")
      .send({ path: firstVault });

    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      path: firstVault,
      initialized: true
    });
    expect(await readAppSettings(context.settingsDir)).toEqual({
      activeVaultPath: firstVault,
      updatedAt: expect.stringMatching(ISO_UTC_MS)
    });
  });

  it("reports read-only status when the active Vault path is not writable", async () => {
    const context = await createTempVaultContext();
    const missingVault = context.path("MissingVault");
    await writeAppSettings(context.settingsDir, missingVault);

    const response = await request(createApp()).get("/api/vault/status");

    expect(response.status).toBe(200);
    expect(response.body.status).toEqual({
      path: missingVault,
      initialized: false,
      writable: false,
      readOnlyReason: expect.any(String),
      lastSaveAt: null
    });
    expect(response.body.status.readOnlyReason).not.toHaveLength(0);
    expect(await readAppSettings(context.settingsDir)).toEqual({
      activeVaultPath: missingVault,
      updatedAt: "2026-06-22T03:14:15.926Z"
    });
  });

  it("copies migration into an empty destination after confirmation", async () => {
    const context = await createTempVaultContext();
    const sourcePath = context.path("SourceVault");
    const destinationPath = context.path("MigratedVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: sourcePath });
    expect(initialize.status).toBe(200);
    await mkdir(destinationPath, { recursive: true });
    await mkdir(join(sourcePath, LEGACY_CARD_DIRECTORIES.definition), {
      recursive: true
    });
    await writeFile(
      join(sourcePath, READING_DIRECTORY, "source.md"),
      "# Source reading\n\nImportant proof note.\n",
      "utf8"
    );
    await writeFile(
      join(sourcePath, LEGACY_CARD_DIRECTORIES.definition, "definition.md"),
      "# Definition\n",
      "utf8"
    );
    const sourceSettingsRaw = await readFile(
      join(sourcePath, ".aleksi", "settings.json"),
      "utf8"
    );

    const response = await request(app).post("/api/vault/migrate").send({
      sourcePath,
      destinationPath,
      confirmed: true
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      path: destinationPath,
      initialized: true,
      writable: true,
      readOnlyReason: null
    });
    await expectInitializedVaultTree(destinationPath);
    await expect(
      readFile(join(destinationPath, READING_DIRECTORY, "source.md"), "utf8")
    ).resolves.toBe("# Source reading\n\nImportant proof note.\n");
    await expect(
      readFile(
        join(destinationPath, LEGACY_CARD_DIRECTORIES.definition, "definition.md"),
        "utf8"
      )
    ).resolves.toBe("# Definition\n");
    await expect(
      readFile(join(destinationPath, ".aleksi", "settings.json"), "utf8")
    ).resolves.toBe(sourceSettingsRaw);
    expect(await readAppSettings(context.settingsDir)).toEqual({
      activeVaultPath: destinationPath,
      updatedAt: expect.stringMatching(ISO_UTC_MS)
    });
  });

  it.each([
    "vault-transfer:ready",
    "vault-transfer:renamed"
  ] as const)(
    "resumes an interrupted migration from %s without recopying or corrupting the destination",
    async (boundary) => {
      const context = await createTempVaultContext();
      const sourcePath = context.path("InterruptedSource");
      const destinationPath = context.path("InterruptedDestination");
      const app = createApp();
      expect(
        (
          await request(app)
            .post("/api/vault/initialize")
            .send({ path: sourcePath })
        ).status
      ).toBe(200);
      await writeFile(
        join(sourcePath, READING_DIRECTORY, "resume.md"),
        "# Resume me\n",
        "utf8"
      );
      const faults = new FaultController();
      faults.install(boundary, {
        kind: "throw",
        error: new Error(`simulated termination at ${boundary}`)
      });

      await expect(
        migrateVault(sourcePath, destinationPath, { faults })
      ).rejects.toThrow(`simulated termination at ${boundary}`);

      await expect(
        migrateVault(sourcePath, destinationPath)
      ).resolves.toMatchObject({
        path: destinationPath,
        initialized: true,
        writable: true
      });
      await expect(
        readFile(join(destinationPath, READING_DIRECTORY, "resume.md"), "utf8")
      ).resolves.toBe("# Resume me\n");
      await expectMissing(
        join(destinationPath, ".aleksi", "migration-manifest.json")
      );
      expect(
        (await readdir(dirname(destinationPath))).filter((name) =>
          name.startsWith(`${basename(destinationPath)}.partial-`)
        )
      ).toEqual([]);
    }
  );

  it("rejects migration without confirmation and leaves destination and settings unchanged", async () => {
    const context = await createTempVaultContext();
    const sourcePath = context.path("SourceVault");
    const destinationPath = context.path("DestinationVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: sourcePath });
    expect(initialize.status).toBe(200);
    await mkdir(destinationPath, { recursive: true });

    const response = await request(app).post("/api/vault/migrate").send({
      sourcePath,
      destinationPath,
      confirmed: false
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await readdir(destinationPath)).toEqual([]);
    expect(await readAppSettings(context.settingsDir)).toEqual({
      activeVaultPath: sourcePath,
      updatedAt: expect.stringMatching(ISO_UTC_MS)
    });
  });

  it("creates timestamped backups outside the live Vault without changing settings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T03:14:15.926Z"));
    const context = await createTempVaultContext();
    const vaultPath = context.path("LiveVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);
    await writeFile(
      join(vaultPath, READING_DIRECTORY, "live.md"),
      "# Live reading\n",
      "utf8"
    );
    const appSettingsBeforeBackup = await readAppSettings(context.settingsDir);
    const vaultSettingsBeforeBackup = await readFile(
      join(vaultPath, ".aleksi", "settings.json"),
      "utf8"
    );

    const first = await request(app)
      .post("/api/vault/backup")
      .send({ confirmed: true });
    const second = await request(app)
      .post("/api/vault/backup")
      .send({ confirmed: true });

    const expectedFirst = join(
      dirname(vaultPath),
      "Aleksi-Learning-Vault-backup-20260622T031415926Z"
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.backupPath).toBe(expectedFirst);
    expect(second.body.backupPath).toBe(`${expectedFirst}-2`);
    expect(dirname(first.body.backupPath)).toBe(dirname(vaultPath));
    expect(first.body.backupPath.startsWith(`${vaultPath}\\`)).toBe(false);
    expect(basename(first.body.backupPath)).toMatch(
      /^Aleksi-Learning-Vault-backup-\d{8}T\d{9}Z$/u
    );
    await expect(
      readFile(join(first.body.backupPath, READING_DIRECTORY, "live.md"), "utf8")
    ).resolves.toBe("# Live reading\n");
    await expect(
      readFile(join(first.body.backupPath, ".aleksi", "settings.json"), "utf8")
    ).resolves.toBe(vaultSettingsBeforeBackup);
    await expect(
      readJsonFile(
        join(first.body.backupPath, ".aleksi", "backup-manifest.json")
      )
    ).resolves.toMatchObject({
      schemaVersion: 1,
      operation: "backup",
      completed: true,
      files: expect.any(Array)
    });
    expect(await readAppSettings(context.settingsDir)).toEqual(
      appSettingsBeforeBackup
    );
    expect(
      await readJsonFile(join(vaultPath, ".aleksi", "settings.json"))
    ).toEqual(JSON.parse(vaultSettingsBeforeBackup));
  });

  it("rejects malformed backup bodies without changing settings or creating backup directories", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("LiveVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);

    const settingsBefore = await readAppSettings(context.settingsDir);
    expect(await backupDirectoryNames(vaultPath)).toEqual([]);

    for (const body of [
      undefined,
      { confirmed: false },
      { confirmed: true, destinationPath: context.path("Unexpected") }
    ]) {
      const response = await postMaybeBody(app, "/api/vault/backup", body);

      expectApiError(response, "INVALID_REQUEST_BODY");
      expect(await readAppSettings(context.settingsDir)).toEqual(
        settingsBefore
      );
      expect(await backupDirectoryNames(vaultPath)).toEqual([]);
    }
  });

  it("rejects malformed migration bodies before changing settings or destination contents", async () => {
    const context = await createTempVaultContext();
    const sourcePath = context.path("SourceVault");
    const destinationPath = context.path("DestinationVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: sourcePath });
    expect(initialize.status).toBe(200);
    await mkdir(destinationPath, { recursive: true });

    const settingsBefore = await readAppSettings(context.settingsDir);

    for (const body of [
      undefined,
      { sourcePath, destinationPath, confirmed: false },
      { sourcePath, destinationPath, confirmed: true, extra: "reject me" }
    ]) {
      const response = await postMaybeBody(app, "/api/vault/migrate", body);

      expectApiError(response, "INVALID_REQUEST_BODY");
      expect(await readdir(destinationPath)).toEqual([]);
      expect(await readAppSettings(context.settingsDir)).toEqual(
        settingsBefore
      );
    }
  });

  it("rejects migration into a non-empty destination without changing settings or destination files", async () => {
    const context = await createTempVaultContext();
    const sourcePath = context.path("SourceVault");
    const destinationPath = context.path("DestinationVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: sourcePath });
    expect(initialize.status).toBe(200);
    await mkdir(destinationPath, { recursive: true });
    await writeFile(join(destinationPath, "keep.txt"), "keep\n", "utf8");

    const settingsBefore = await readAppSettings(context.settingsDir);
    const response = await request(app).post("/api/vault/migrate").send({
      sourcePath,
      destinationPath,
      confirmed: true
    });

    expectApiError(response, "DESTINATION_NOT_EMPTY");
    expect(await readdir(destinationPath)).toEqual(["keep.txt"]);
    await expect(readFile(join(destinationPath, "keep.txt"), "utf8")).resolves.toBe(
      "keep\n"
    );
    expect(await readAppSettings(context.settingsDir)).toEqual(settingsBefore);
  });

  it("cleans an empty migration destination after copy fails on a source symlink", async ({
    skip
  }) => {
    const context = await createTempVaultContext();
    const activeVault = context.path("ActiveVault");
    const sourcePath = context.path("LegacySource");
    const destinationPath = context.path("DestinationVault");
    const outsideTarget = context.path("OutsideTarget");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: activeVault });
    expect(initialize.status).toBe(200);
    await mkdir(sourcePath, { recursive: true });
    await mkdir(destinationPath, { recursive: true });
    await mkdir(outsideTarget, { recursive: true });
    await writeFile(
      join(sourcePath, "00-copied-before-failure.md"),
      "copied\n",
      "utf8"
    );

    try {
      await symlink(
        outsideTarget,
        join(sourcePath, "zz-symlink-failure"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch (error) {
      if (isErrorCode(error, "EPERM", "EACCES")) {
        skip(`OS denied directory link creation: ${String(error.code)}`);
        return;
      }
      throw error;
    }

    const settingsBefore = await readAppSettings(context.settingsDir);
    const response = await request(app).post("/api/vault/migrate").send({
      sourcePath,
      destinationPath,
      confirmed: true
    });

    expectApiError(response, "PATH_AMBIGUOUS");
    expect(await readdir(destinationPath)).toEqual([]);
    expect(await readAppSettings(context.settingsDir)).toEqual(settingsBefore);
    await expect(
      readFile(join(sourcePath, "00-copied-before-failure.md"), "utf8")
    ).resolves.toBe("copied\n");
  });

  it("rejects overlapping migration source and destination paths before creating or selecting the destination", async () => {
    const context = await createTempVaultContext();
    const sourcePath = context.path("SourceVault");
    const destinationInsideSource = join(sourcePath, "NestedDestination");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: sourcePath });
    expect(initialize.status).toBe(200);

    const settingsBefore = await readAppSettings(context.settingsDir);
    const nestedResponse = await request(app).post("/api/vault/migrate").send({
      sourcePath,
      destinationPath: destinationInsideSource,
      confirmed: true
    });

    expectApiError(nestedResponse, "SOURCE_DESTINATION_CONFLICT");
    await expectMissing(destinationInsideSource);
    expect(await readAppSettings(context.settingsDir)).toEqual(settingsBefore);

    const parentPath = context.path("ParentVault");
    const childSourcePath = join(parentPath, "ChildSource");
    const childInitialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: childSourcePath });
    expect(childInitialize.status).toBe(200);

    const childSettingsBefore = await readAppSettings(context.settingsDir);
    const ancestorResponse = await request(app).post("/api/vault/migrate").send({
      sourcePath: childSourcePath,
      destinationPath: parentPath,
      confirmed: true
    });

    expectApiError(ancestorResponse, "SOURCE_DESTINATION_CONFLICT");
    expect(await readAppSettings(context.settingsDir)).toEqual(
      childSettingsBefore
    );
  });

  it("rejects traversal and encoded-separator privileged paths without changing the active Vault", async () => {
    const context = await createTempVaultContext();
    const activeVault = context.path("ActiveVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: activeVault });
    expect(initialize.status).toBe(200);

    const traversalName = `${basename(context.root)}-traversal-target`;
    const traversalInput = `${context.root}/../${traversalName}`;
    const traversalResolvedTarget = join(dirname(context.root), traversalName);
    const encodedInput = `${context.root}/Encoded%5cVault`;
    const encodedResolvedTarget = join(context.root, "Encoded%5cVault");
    const settingsBefore = await readAppSettings(context.settingsDir);

    for (const { route, body } of [
      {
        route: "/api/vault/initialize",
        body: { path: traversalInput }
      },
      {
        route: "/api/vault/select",
        body: { path: encodedInput }
      },
      {
        route: "/api/vault/migrate",
        body: {
          sourcePath: traversalInput,
          destinationPath: context.path("TraversalDestination"),
          confirmed: true
        }
      },
      {
        route: "/api/vault/migrate",
        body: {
          sourcePath: activeVault,
          destinationPath: encodedInput,
          confirmed: true
        }
      }
    ]) {
      const response = await request(app).post(route).send(body);

      expectApiError(response, "INVALID_ABSOLUTE_PATH");
      expect(await readAppSettings(context.settingsDir)).toEqual(
        settingsBefore
      );
    }

    await expectMissing(traversalResolvedTarget);
    await expectMissing(encodedResolvedTarget);
    await expectMissing(context.path("TraversalDestination"));
  });

  it("rejects privileged paths that pass through a symlink or junction without Vault mutation", async ({
    skip
  }) => {
    const context = await createTempVaultContext();
    const activeVault = context.path("ActiveVault");
    const outsideTarget = context.path("OutsideTarget");
    const linkedParent = context.path("LinkedParent");
    const linkedVault = join(linkedParent, "NestedVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: activeVault });
    expect(initialize.status).toBe(200);
    await mkdir(outsideTarget, { recursive: true });

    try {
      await symlink(
        outsideTarget,
        linkedParent,
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch (error) {
      if (isErrorCode(error, "EPERM", "EACCES")) {
        skip(`OS denied directory link creation: ${String(error.code)}`);
        return;
      }
      throw error;
    }

    const settingsBefore = await readAppSettings(context.settingsDir);

    for (const { route, body } of [
      {
        route: "/api/vault/initialize",
        body: { path: linkedVault }
      },
      {
        route: "/api/vault/select",
        body: { path: linkedVault }
      },
      {
        route: "/api/vault/migrate",
        body: {
          sourcePath: linkedVault,
          destinationPath: context.path("SymlinkSourceRejectedDestination"),
          confirmed: true
        }
      },
      {
        route: "/api/vault/migrate",
        body: {
          sourcePath: activeVault,
          destinationPath: linkedVault,
          confirmed: true
        }
      }
    ]) {
      const response = await request(app).post(route).send(body);

      expectApiError(response, "PATH_AMBIGUOUS");
      expect(await readAppSettings(context.settingsDir)).toEqual(
        settingsBefore
      );
    }

    await expectMissing(join(outsideTarget, "NestedVault"));
    await expectMissing(context.path("SymlinkSourceRejectedDestination"));
  });

  it("rejects malformed select bodies, including confirmed as an unknown field, without changing the active Vault", async () => {
    const context = await createTempVaultContext();
    const firstVault = context.path("FirstVault");
    const secondVault = context.path("SecondVault");
    const app = createApp();

    const firstInitialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: firstVault });
    expect(firstInitialize.status).toBe(200);
    const secondInitialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: secondVault });
    expect(secondInitialize.status).toBe(200);

    const settingsBefore = await readAppSettings(context.settingsDir);

    for (const body of [
      undefined,
      { path: firstVault, confirmed: true }
    ]) {
      const response = await postMaybeBody(app, "/api/vault/select", body);

      expectApiError(response, "INVALID_REQUEST_BODY");
      expect(await readAppSettings(context.settingsDir)).toEqual(
        settingsBefore
      );
    }
  });

  it("selecting a Vault does not rewrite the live Vault settings file", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);

    const vaultSettingsPath = join(vaultPath, ".aleksi", "settings.json");
    const vaultSettings = await readJsonFile<{
      schemaVersion: 1;
      vaultId: string;
    }>(vaultSettingsPath);
    const compactVaultSettings = `${JSON.stringify(vaultSettings)}\n`;
    await writeFile(vaultSettingsPath, compactVaultSettings, "utf8");

    const response = await request(app)
      .post("/api/vault/select")
      .send({ path: vaultPath });

    expect(response.status).toBe(200);
    await expect(readFile(vaultSettingsPath, "utf8")).resolves.toBe(
      compactVaultSettings
    );
  });

  it("migrates a legacy source without live settings by creating destination settings only after a successful copy", async () => {
    const context = await createTempVaultContext();
    const activeVault = context.path("ActiveVault");
    const legacySource = context.path("LegacySource");
    const destinationPath = context.path("MigratedLegacyVault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: activeVault });
    expect(initialize.status).toBe(200);
    await mkdir(join(legacySource, VAULT_FOLDERS[0]), { recursive: true });
    await writeFile(
      join(legacySource, VAULT_FOLDERS[0], "legacy.md"),
      "# Legacy source\n",
      "utf8"
    );
    await expectMissing(join(legacySource, ".aleksi", "settings.json"));

    const response = await request(app).post("/api/vault/migrate").send({
      sourcePath: legacySource,
      destinationPath,
      confirmed: true
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      path: destinationPath,
      initialized: true,
      writable: true,
      readOnlyReason: null
    });
    await expectInitializedVaultTree(destinationPath);
    await expect(
      readFile(join(destinationPath, VAULT_FOLDERS[0], "legacy.md"), "utf8")
    ).resolves.toBe("# Legacy source\n");
    await expectFile(join(destinationPath, ".aleksi", "settings.json"));
    await expectMissing(join(legacySource, ".aleksi", "settings.json"));
    await expect(
      readFile(join(legacySource, VAULT_FOLDERS[0], "legacy.md"), "utf8")
    ).resolves.toBe("# Legacy source\n");
    expect(await readAppSettings(context.settingsDir)).toEqual({
      activeVaultPath: destinationPath,
      updatedAt: expect.stringMatching(ISO_UTC_MS)
    });
  });

  it("quarantines an invalid primary locator and repairs it from the valid mirror", async () => {
    const context = await createTempVaultContext();
    const vaultPath = context.path("Vault");
    const app = createApp();

    const initialize = await request(app)
      .post("/api/vault/initialize")
      .send({ path: vaultPath });
    expect(initialize.status).toBe(200);

    const invalidSettings = `${JSON.stringify(
      {
        activeVaultPath: "relative-vault",
        updatedAt: "not-an-iso-date",
        extra: "reject me"
      },
      null,
      2
    )}\n`;
    await writeRawAppSettings(context.settingsDir, invalidSettings);

    const response = await request(app).get("/api/vault/status");

    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      path: vaultPath,
      initialized: true,
      writable: true
    });
    const files = await readdir(context.settingsDir);
    const corrupt = files.find((name) =>
      name.startsWith("settings.corrupt-")
    );
    expect(corrupt).toBeDefined();
    await expect(
      readFile(join(context.settingsDir, corrupt!), "utf8")
    ).resolves.toBe(invalidSettings);
    expect(files.some((name) => name.startsWith("settings.recovery-"))).toBe(
      true
    );
    await expect(
      readFile(join(context.settingsDir, "settings.json"), "utf8")
    ).resolves.toBe(
      await readFile(
        join(context.settingsDir, "settings.mirror.json"),
        "utf8"
      )
    );
  });

  it("quarantines a Windows root-relative app locator without selecting another Vault", async () => {
    const context = await createTempVaultContext();
    const rootRelativeSettings = `${JSON.stringify(
      {
        activeVaultPath: "\\Vault",
        updatedAt: "2026-06-22T03:14:15.926Z"
      },
      null,
      2
    )}\n`;
    await writeRawAppSettings(context.settingsDir, rootRelativeSettings);

    const response = await request(createApp()).get("/api/vault/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: null });
    const files = await readdir(context.settingsDir);
    const corrupt = files.find((name) =>
      name.startsWith("settings.corrupt-")
    );
    expect(corrupt).toBeDefined();
    await expect(
      readFile(join(context.settingsDir, corrupt!), "utf8")
    ).resolves.toBe(rootRelativeSettings);
  });
});
