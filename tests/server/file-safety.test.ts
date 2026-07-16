import {
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  readdir,
  realpath,
  rename as renameFile,
  rm,
  stat,
  symlink,
  unlink as unlinkFile,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertInsideRoot,
  assertRealPathInsideRoot,
  isFullyQualifiedAbsolutePath,
  isSameOrNestedRealPath,
  normalizeVaultRelativePath,
  resolveInsideRoot
} from "../../server/lib/path-safety";
import {
  allocateUniqueMarkdownPath,
  sanitizeWindowsFilename
} from "../../server/lib/filename";
import {
  atomicCreateText,
  atomicWriteText,
  type AtomicWriteFileSystem
} from "../../server/lib/atomic-write";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrow(expect.objectContaining({ code }));
}

async function expectRejectedCode(
  action: () => Promise<unknown>,
  code: string
): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code });
}

function artifactNames(names: string[]): string[] {
  return names.filter(
    (name) => name.endsWith(".tmp") || name.endsWith(".bak")
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("Vault path safety", () => {
  it("requires fully qualified absolute paths for Windows-style privileged paths", () => {
    for (const path of ["C:\\Vault", "C:/Vault", "\\\\server\\share\\Vault"]) {
      expect(isFullyQualifiedAbsolutePath(path)).toBe(true);
    }

    for (const path of ["\\Vault", "/Vault", "C:Vault", "Vault"]) {
      expect(isFullyQualifiedAbsolutePath(path, "win32")).toBe(false);
    }
  });

  it("accepts POSIX absolute Vault paths on POSIX platforms without accepting Windows root-relative paths", () => {
    for (const path of ["/tmp/aleksi-vault", "/Users/aleksi/Vault"]) {
      expect(isFullyQualifiedAbsolutePath(path, "linux")).toBe(true);
      expect(isFullyQualifiedAbsolutePath(path, "darwin")).toBe(true);
    }

    for (const path of ["tmp/aleksi-vault", "../vault", "\\Users\\Aleksi\\Vault"]) {
      expect(isFullyQualifiedAbsolutePath(path)).toBe(false);
    }
  });

  it("accepts supported Windows extended absolute path forms", () => {
    expect(isFullyQualifiedAbsolutePath("\\\\?\\C:\\Vault")).toBe(true);
    expect(
      isFullyQualifiedAbsolutePath("\\\\?\\UNC\\server\\share\\Vault")
    ).toBe(true);
  });

  it("detects normal and extended-length paths to the same physical tree as nested", async ({
    skip
  }) => {
    if (process.platform !== "win32") {
      skip("Windows extended-length path aliases are Windows-only");
      return;
    }

    const parent = await makeTemporaryDirectory("aleksi-real-overlap-");
    const vault = join(parent, "vault");
    const sibling = join(parent, "vault-sibling", "missing");
    await mkdir(vault);
    await mkdir(dirname(sibling));

    const extendedVault = `\\\\?\\${vault}`;

    await expect(
      isSameOrNestedRealPath(extendedVault, join(vault, "missing-child"))
    ).resolves.toBe(true);
    await expect(
      isSameOrNestedRealPath(extendedVault, sibling)
    ).resolves.toBe(false);
  });

  it("allows the root itself and rejects traversal and sibling-prefix escapes", async () => {
    const parent = await makeTemporaryDirectory("aleksi-path-");
    const vault = join(parent, "vault");
    const sibling = join(parent, "vault-evil", "asset.md");
    await mkdir(vault);

    expect(assertInsideRoot(vault, vault)).toBe(resolve(vault));
    expectCode(
      () => assertInsideRoot(vault, join(vault, "..", "outside.md")),
      "PATH_OUTSIDE_VAULT"
    );
    expectCode(
      () => assertInsideRoot(vault, sibling),
      "PATH_OUTSIDE_VAULT"
    );
  });

  it("normalizes valid Vault-relative paths to NFC with forward slashes", () => {
    expect(normalizeVaultRelativePath("数学 分析/Cafe\u0301 极限.md")).toBe(
      "数学 分析/Café 极限.md"
    );
    expect(
      resolveInsideRoot("C:\\Vault", "数学 分析", "Cafe\u0301 极限.md")
    ).toBe(resolve("C:\\Vault", "数学 分析", "Café 极限.md"));
  });

  it.each([
    "",
    ".",
    "..",
    "a//b",
    "a/./b",
    "a/../b",
    "/absolute",
    "//server/share",
    "\\\\server\\share",
    "C:/absolute",
    "C:\\absolute",
    "a\\b",
    "a\\b/c",
    "a/%2fb",
    "a/%2Fb",
    "a/%5cb",
    "a/%5Cb",
    "a/\0b",
    "a:b",
    "card.md:ads",
    "bad|name",
    "folder/trailing.",
    "folder/trailing ",
    "CON",
    "con.txt",
    "folder/LPT1.log",
    "folder/com9.md"
  ])("rejects invalid Vault-relative path %j", (relativePath) => {
    expectCode(
      () => normalizeVaultRelativePath(relativePath),
      "INVALID_VAULT_RELATIVE_PATH"
    );
  });

  it("rejects absolute, traversal, encoded, and mixed injected segments", () => {
    for (const segments of [
      ["..", "outside.md"],
      ["C:\\outside", "asset.md"],
      ["\\\\server\\share", "asset.md"],
      ["safe\\mixed", "asset.md"],
      ["safe", "%2foutside.md"]
    ]) {
      expectCode(
        () => resolveInsideRoot("C:\\Vault", ...segments),
        "INVALID_VAULT_RELATIVE_PATH"
      );
    }
  });

  it("rejects a directory junction or symlink that leaves the Vault", async ({
    skip
  }) => {
    const parent = await makeTemporaryDirectory("aleksi-junction-");
    const vault = join(parent, "vault");
    const outside = join(parent, "outside");
    const linkedDirectory = join(vault, "linked");
    await mkdir(vault);
    await mkdir(outside);

    try {
      await symlink(
        outside,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        skip(`OS denied directory link creation: ${error.code}`);
        return;
      }
      throw error;
    }

    await expectRejectedCode(
      () =>
        assertRealPathInsideRoot(
          vault,
          join(linkedDirectory, "missing-card.md")
        ),
      "SYMLINK_OUTSIDE_VAULT"
    );
  });

  it("rejects an existing file symlink that leaves the Vault", async ({
    skip
  }) => {
    const parent = await makeTemporaryDirectory("aleksi-symlink-");
    const vault = join(parent, "vault");
    const outside = join(parent, "outside.md");
    const linkedFile = join(vault, "linked.md");
    await mkdir(vault);
    await writeFile(outside, "outside", "utf8");

    try {
      await symlink(outside, linkedFile, "file");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        skip(`OS denied file symlink creation: ${error.code}`);
        return;
      }
      throw error;
    }

    await expectRejectedCode(
      () => assertRealPathInsideRoot(vault, linkedFile),
      "SYMLINK_OUTSIDE_VAULT"
    );
  });

  it("allows a missing target beneath a real parent inside the Vault", async () => {
    const vault = await makeTemporaryDirectory("aleksi-realpath-");
    const safeParent = join(vault, "safe");
    const target = join(safeParent, "missing.md");
    await mkdir(safeParent);

    await expect(assertRealPathInsideRoot(vault, target)).resolves.toBe(
      resolve(target)
    );
  });
});

describe("Windows filenames and collision claims", () => {
  it("normalizes NFC, replaces invalid characters, collapses dashes, and trims trailing dots and spaces", () => {
    expect(
      sanitizeWindowsFilename("  Cafe\u0301:::a??//b\\\\c...  ")
    ).toBe("Café-a-b-c");
    expect(sanitizeWindowsFilename("  数列 | 极限  ")).toBe("数列 - 极限");
  });

  it.each(["", "   ", ".", "..", "...", "bad\u0001name", "bad\u007fname"])(
    "rejects empty, dot-only, or control-bearing filename %j",
    (title) => {
      expectCode(() => sanitizeWindowsFilename(title), "INVALID_FILENAME");
    }
  );

  it.each([
    "CON",
    "con.txt",
    "PRN ",
    "aux...",
    "NUL.md",
    "COM1",
    "com9.txt",
    "LPT1",
    "lpt9 .log"
  ])("rejects reserved Windows device filename %j", (title) => {
    expectCode(
      () => sanitizeWindowsFilename(title),
      "RESERVED_WINDOWS_NAME"
    );
  });

  it("does not reject non-device names that merely share a prefix", () => {
    expect(sanitizeWindowsFilename("CONSOLE")).toBe("CONSOLE");
    expect(sanitizeWindowsFilename("COM10")).toBe("COM10");
    expect(sanitizeWindowsFilename("LPT10.notes")).toBe("LPT10.notes");
  });

  it("claims name.md, name-2.md, and name-3.md without overwrite", async () => {
    const vault = await makeTemporaryDirectory("aleksi-collision-");

    const claims = [];
    for (let index = 0; index < 3; index += 1) {
      claims.push(
        await allocateUniqueMarkdownPath(vault, "name", { root: vault })
      );
    }

    expect(claims.map((path) => basename(path))).toEqual([
      "name.md",
      "name-2.md",
      "name-3.md"
    ]);
    await expect(
      Promise.all(claims.map((path) => readFile(path, "utf8")))
    ).resolves.toEqual(["", "", ""]);
  });

  it("gives concurrent allocators distinct claimed files", async () => {
    const vault = await makeTemporaryDirectory("aleksi-concurrent-");

    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        allocateUniqueMarkdownPath(vault, "并发", { root: vault })
      )
    );

    expect(new Set(claims).size).toBe(5);
    expect(claims.map((path) => basename(path)).sort()).toEqual([
      "并发-2.md",
      "并发-3.md",
      "并发-4.md",
      "并发-5.md",
      "并发.md"
    ]);
  });
});

describe("atomic UTF-8 writes", () => {
  it("creates missing safe parents and returns the real path and observed mtime", async () => {
    const vault = await makeTemporaryDirectory("aleksi-create-");
    const target = join(vault, "nested", "中文.md");
    const content = "ε-N 定义 🙂\n";

    const receipt = await atomicCreateText(target, content, { root: vault });
    const targetStat = await stat(target);

    expect(receipt).toEqual({
      path: await realpath(target),
      modifiedAt: targetStat.mtime.toISOString()
    });
    await expect(readFile(target, "utf8")).resolves.toBe(content);
    expect(await readdir(dirname(target))).toEqual(["中文.md"]);
  });

  it("keeps an exclusive create committed when temporary cleanup unlink fails", async () => {
    const vault = await makeTemporaryDirectory("aleksi-create-cleanup-");
    const target = join(vault, "card.md");
    const content = "new content";
    const fileSystem: Partial<AtomicWriteFileSystem> = {
      unlink: async (path) => {
        if (basename(path).endsWith(".tmp")) {
          throw new Error("injected temporary unlink failure");
        }
        await unlinkFile(path);
      }
    };

    const receipt = await atomicCreateText(target, content, {
      root: vault,
      fileSystem
    });

    expect(receipt.path).toBe(await realpath(target));
    expect(receipt.modifiedAt).toBe((await stat(target)).mtime.toISOString());
    await expect(readFile(target, "utf8")).resolves.toBe(content);
    const artifacts = artifactNames(await readdir(vault));
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatch(/\.tmp$/);
  });

  it("overwrites an existing target and returns its filesystem-observed receipt", async () => {
    const vault = await makeTemporaryDirectory("aleksi-write-");
    const target = join(vault, "card.md");
    await writeFile(target, "old", "utf8");

    const receipt = await atomicWriteText(target, "new 内容", { root: vault });

    expect(receipt.path).toBe(await realpath(target));
    expect(receipt.modifiedAt).toBe((await stat(target)).mtime.toISOString());
    await expect(readFile(target, "utf8")).resolves.toBe("new 内容");
    expect(artifactNames(await readdir(vault))).toEqual([]);
  });

  it("exclusive create fails with EEXIST and never overwrites", async () => {
    const vault = await makeTemporaryDirectory("aleksi-exclusive-");
    const target = join(vault, "card.md");
    await writeFile(target, "original", "utf8");

    await expect(atomicCreateText(target, "replacement", { root: vault }))
      .rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(target, "utf8")).resolves.toBe("original");
    expect(artifactNames(await readdir(vault))).toEqual([]);
  });

  it("supports collision retry with concurrent exclusive creates without overwrite", async () => {
    const vault = await makeTemporaryDirectory("aleksi-create-race-");

    async function createUnique(content: string): Promise<string> {
      for (let ordinal = 1; ; ordinal += 1) {
        const suffix = ordinal === 1 ? "" : `-${ordinal}`;
        const target = join(vault, `race${suffix}.md`);
        try {
          return (await atomicCreateText(target, content, { root: vault }))
            .path;
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            continue;
          }
          throw error;
        }
      }
    }

    const contents = ["one", "two", "three", "four"];
    const created = await Promise.all(contents.map(createUnique));

    expect(new Set(created).size).toBe(contents.length);
    await expect(
      Promise.all(created.map((path) => readFile(path, "utf8")))
    ).resolves.toEqual(contents);
  });

  it("rolls back an overwrite when both Windows replacement attempts fail", async () => {
    const vault = await makeTemporaryDirectory("aleksi-rollback-");
    const target = join(vault, "card.md");
    await writeFile(target, "previous content", "utf8");
    let replacementAttempts = 0;
    const fileSystem: Partial<AtomicWriteFileSystem> = {
      rename: async (source, destination) => {
        if (
          basename(source).endsWith(".tmp") &&
          resolve(destination) === resolve(target)
        ) {
          replacementAttempts += 1;
          throw Object.assign(new Error("injected replacement failure"), {
            code: replacementAttempts === 1 ? "EPERM" : "EIO"
          });
        }
        await renameFile(source, destination);
      }
    };

    await expect(
      atomicWriteText(target, "new content", { root: vault, fileSystem })
    ).rejects.toThrow("injected replacement failure");

    expect(replacementAttempts).toBe(2);
    await expect(readFile(target, "utf8")).resolves.toBe("previous content");
    expect(artifactNames(await readdir(vault))).toEqual([]);
  });

  it.each(["write", "sync", "close"] as const)(
    "cleans temporary files and preserves the target after an injected %s failure",
    async (stage) => {
      const vault = await makeTemporaryDirectory(`aleksi-${stage}-`);
      const target = join(vault, "card.md");
      await writeFile(target, "previous content", "utf8");
      const fileSystem: Partial<AtomicWriteFileSystem> = {
        open: async (path, flags) => {
          const handle = await openFile(path, flags);
          return {
            writeFile: async (data) => {
              if (stage === "write") {
                throw new Error("injected write failure");
              }
              await handle.writeFile(data);
            },
            sync: async () => {
              if (stage === "sync") {
                throw new Error("injected sync failure");
              }
              await handle.sync();
            },
            close: async () => {
              await handle.close();
              if (stage === "close") {
                throw new Error("injected close failure");
              }
            }
          };
        }
      };

      await expect(
        atomicWriteText(target, "new content", { root: vault, fileSystem })
      ).rejects.toThrow(`injected ${stage} failure`);

      await expect(readFile(target, "utf8")).resolves.toBe(
        "previous content"
      );
      expect(artifactNames(await readdir(vault))).toEqual([]);
    }
  );

  it("cleans an incomplete backup and preserves the target when backup open fails", async () => {
    const vault = await makeTemporaryDirectory("aleksi-backup-open-");
    const target = join(vault, "card.md");
    await writeFile(target, "previous content", "utf8");
    const fileSystem: Partial<AtomicWriteFileSystem> = {
      open: async (path, flags) => {
        if (basename(path).endsWith(".bak")) {
          throw new Error("injected backup open failure");
        }
        return openFile(path, flags);
      }
    };

    await expect(
      atomicWriteText(target, "new content", { root: vault, fileSystem })
    ).rejects.toThrow("injected backup open failure");

    await expect(readFile(target, "utf8")).resolves.toBe("previous content");
    expect(artifactNames(await readdir(vault))).toEqual([]);
  });

  it("cleans a partial backup and preserves the target when backup copy fails", async () => {
    const vault = await makeTemporaryDirectory("aleksi-backup-copy-");
    const target = join(vault, "card.md");
    await writeFile(target, "previous content", "utf8");
    const fileSystem: Partial<AtomicWriteFileSystem> = {
      copyFile: async (_source, destination) => {
        await writeFile(destination, "partial backup", "utf8");
        throw new Error("injected backup copy failure");
      }
    };

    await expect(
      atomicWriteText(target, "new content", { root: vault, fileSystem })
    ).rejects.toThrow("injected backup copy failure");

    await expect(readFile(target, "utf8")).resolves.toBe("previous content");
    expect(artifactNames(await readdir(vault))).toEqual([]);
  });

  it("removes a newly created target if final receipt observation fails", async () => {
    const vault = await makeTemporaryDirectory("aleksi-receipt-");
    const target = join(vault, "card.md");
    const fileSystem: Partial<AtomicWriteFileSystem> = {
      stat: async () => {
        throw new Error("injected final stat failure");
      }
    };

    await expect(
      atomicWriteText(target, "new content", { root: vault, fileSystem })
    ).rejects.toThrow("injected final stat failure");

    await expect(readFile(target, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(artifactNames(await readdir(vault))).toEqual([]);
  });

  it("restores the previous target when final receipt observation fails after overwrite", async () => {
    const vault = await makeTemporaryDirectory("aleksi-existing-receipt-");
    const target = join(vault, "card.md");
    await writeFile(target, "previous content", "utf8");
    const fileSystem: Partial<AtomicWriteFileSystem> = {
      stat: async () => {
        throw new Error("injected existing target stat failure");
      }
    };

    await expect(
      atomicWriteText(target, "new content", { root: vault, fileSystem })
    ).rejects.toThrow("injected existing target stat failure");

    await expect(readFile(target, "utf8")).resolves.toBe("previous content");
    expect(artifactNames(await readdir(vault))).toEqual([]);
  });

  it("keeps the backup recoverable if restoring after receipt failure fails", async () => {
    const vault = await makeTemporaryDirectory("aleksi-restore-fail-");
    const target = join(vault, "card.md");
    await writeFile(target, "previous content", "utf8");
    const fileSystem: Partial<AtomicWriteFileSystem> = {
      rename: async (source, destination) => {
        if (
          basename(source).endsWith(".bak") &&
          resolve(destination) === resolve(target)
        ) {
          throw new Error("injected restore failure");
        }
        await renameFile(source, destination);
      },
      stat: async () => {
        throw new Error("injected final stat failure");
      }
    };

    await expect(
      atomicWriteText(target, "new content", { root: vault, fileSystem })
    ).rejects.toThrow("injected restore failure");

    await expect(readFile(target, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    const artifacts = artifactNames(await readdir(vault));
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatch(/\.bak$/);
    await expect(readFile(join(vault, artifacts[0]), "utf8")).resolves.toBe(
      "previous content"
    );
  });

  it("rejects a mutation through an outside directory link", async ({
    skip
  }) => {
    const parent = await makeTemporaryDirectory("aleksi-write-link-");
    const vault = join(parent, "vault");
    const outside = join(parent, "outside");
    const linkedDirectory = join(vault, "linked");
    await mkdir(vault);
    await mkdir(outside);

    try {
      await symlink(
        outside,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        skip(`OS denied directory link creation: ${error.code}`);
        return;
      }
      throw error;
    }

    await expectRejectedCode(
      () =>
        atomicWriteText(join(linkedDirectory, "escaped.md"), "bad", {
          root: vault
        }),
      "SYMLINK_OUTSIDE_VAULT"
    );
    await expect(readFile(join(outside, "escaped.md"), "utf8")).rejects
      .toMatchObject({ code: "ENOENT" });
  });

  it("rejects lone surrogate content before creating any file", async () => {
    const vault = await makeTemporaryDirectory("aleksi-surrogate-");
    const target = join(vault, "bad.md");

    await expect(
      atomicCreateText(target, "bad\uD800", { root: vault })
    ).rejects.toMatchObject({ code: "INVALID_TEXT_CONTENT" });
    expect(await readdir(vault)).toEqual([]);
  });
});
