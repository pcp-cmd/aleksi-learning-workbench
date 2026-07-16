import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const runtimeConfigModulePath = "../../server/runtime-config";
const originalPort = process.env.ALEKSI_SERVER_PORT;

type RuntimeConfigModule = {
  DEFAULT_SERVER_PORT: number;
  loadEnvFileIfPresent: (envFilePath?: string) => boolean;
  parseDesktopServerPort: (value: string | undefined) => number;
  parseServerPort: (value: string | undefined) => number;
};

type ViteConfigModule = {
  createViteConfig?: (env: NodeJS.ProcessEnv) => {
    server?: {
      proxy?: Record<string, string>;
    };
  };
};

async function loadRuntimeConfig(): Promise<RuntimeConfigModule> {
  const runtimeConfig = await import(
    /* @vite-ignore */ runtimeConfigModulePath
  ).catch(() => undefined);

  if (!runtimeConfig) {
    expect.fail("server/runtime-config.ts is not implemented");
  }

  return runtimeConfig as RuntimeConfigModule;
}

afterEach(() => {
  if (originalPort === undefined) {
    delete process.env.ALEKSI_SERVER_PORT;
  } else {
    process.env.ALEKSI_SERVER_PORT = originalPort;
  }
});

describe("server runtime configuration", () => {
  it("defaults ALEKSI_SERVER_PORT to 5174", async () => {
    const { DEFAULT_SERVER_PORT, parseServerPort } =
      await loadRuntimeConfig();

    expect(DEFAULT_SERVER_PORT).toBe(5174);
    expect(parseServerPort(undefined)).toBe(5174);
  });

  it("accepts integer ports across the valid range", async () => {
    const { parseServerPort } = await loadRuntimeConfig();

    expect(parseServerPort("1")).toBe(1);
    expect(parseServerPort("62001")).toBe(62001);
    expect(parseServerPort("65535")).toBe(65535);
  });

  it.each(["", "0", "1.5", "65536", "not-a-port"])(
    "rejects invalid port value %j",
    async (value) => {
      const { parseServerPort } = await loadRuntimeConfig();

      expect(() => parseServerPort(value)).toThrow(
        /ALEKSI_SERVER_PORT must be an integer between 1 and 65535/
      );
    }
  );

  it("reserves ephemeral port zero for the controlled desktop sidecar", async () => {
    const { parseDesktopServerPort, parseServerPort } =
      await loadRuntimeConfig();

    expect(() => parseServerPort("0")).toThrow();
    expect(parseDesktopServerPort(undefined)).toBe(0);
    expect(parseDesktopServerPort("0")).toBe(0);
    expect(parseDesktopServerPort("43127")).toBe(43127);
    expect(() => parseDesktopServerPort("not-a-port")).toThrow(
      /ALEKSI_SERVER_PORT must be 0 or an integer between 1 and 65535/
    );
  });

  it("guards a missing .env file", async () => {
    const { loadEnvFileIfPresent } = await loadRuntimeConfig();

    expect(
      loadEnvFileIfPresent(join(tmpdir(), "aleksi-missing-env-file"))
    ).toBe(false);
  });

  it("loads an existing env file through Node", async () => {
    const { loadEnvFileIfPresent } = await loadRuntimeConfig();
    const directory = mkdtempSync(join(tmpdir(), "aleksi-env-"));
    const envFilePath = join(directory, ".env");

    writeFileSync(envFilePath, "ALEKSI_SERVER_PORT=62001\n", "utf8");
    delete process.env.ALEKSI_SERVER_PORT;

    try {
      expect(loadEnvFileIfPresent(envFilePath)).toBe(true);
      expect(process.env.ALEKSI_SERVER_PORT).toBe("62001");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the validated server port for the Vite API proxy", async () => {
    const viteConfigModule = (await import(
      "../../vite.config"
    )) as ViteConfigModule;

    if (typeof viteConfigModule.createViteConfig !== "function") {
      expect.fail("vite.config.ts does not expose createViteConfig");
    }

    const config = viteConfigModule.createViteConfig({
      ALEKSI_SERVER_PORT: "62001"
    });

    expect(config.server?.proxy?.["/api"]).toBe(
      "http://127.0.0.1:62001"
    );
  });
});
