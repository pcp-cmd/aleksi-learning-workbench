export type VerifyReleaseManifestOptions = {
  allowAbsentInstaller?: boolean;
  allowDirty?: boolean;
  manifestPath?: string;
  root?: string;
};

export type VerifiedReleaseManifest = {
  identity: Record<string, unknown>;
  manifest: {
    artifacts: Array<{
      bytes: number;
      path: string;
      sha256: string;
    }>;
    version: string;
    [key: string]: unknown;
  };
  manifestPath: string;
  releaseDirectory: string;
};

export function verifyReleaseManifest(
  options?: VerifyReleaseManifestOptions
): Promise<VerifiedReleaseManifest>;
