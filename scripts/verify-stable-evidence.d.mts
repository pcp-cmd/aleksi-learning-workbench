export function verifyStableEvidenceInputs(input: {
  closure: string;
  identity: Record<string, any>;
  knownLimitations: string;
  soak: Record<string, any>;
  tag: string;
}): {
  blockerCount: number;
  durationMilliseconds: number;
};

export function verifyStableEvidence(options?: {
  root?: string;
  tag?: string;
}): Promise<{
  blockerCount: number;
  durationMilliseconds: number;
}>;
