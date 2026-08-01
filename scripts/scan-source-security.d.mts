export type SourceSecurityFinding = {
  code: string;
  label: string;
  line: number;
  path: string;
};

export type ScanSourceSecurityOptions = {
  files?: string[];
  root?: string;
};

export function scanSourceSecurity(
  options?: ScanSourceSecurityOptions
): Promise<{
  filesScanned: number;
  findings: SourceSecurityFinding[];
}>;
