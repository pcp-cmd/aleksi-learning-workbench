export type SourceLocation = {
  byteOffset: number;
  line: number;
};

export function mapCharacterOffsetsToSourceLocations(
  source: string,
  characterOffsets: readonly number[]
): ReadonlyMap<number, SourceLocation> {
  const requested = [...new Set(characterOffsets)].sort((left, right) => left - right);
  const result = new Map<number, SourceLocation>();
  let characterOffset = 0;
  let byteOffset = 0;
  let line = 1;

  for (const target of requested) {
    if (!Number.isSafeInteger(target) || target < 0 || target > source.length) {
      throw new Error(`Invalid source character offset: ${target}`);
    }

    while (characterOffset < target) {
      const codePoint = source.codePointAt(characterOffset);
      if (codePoint === undefined) {
        throw new Error("Source offset mapping ended unexpectedly");
      }
      const value = String.fromCodePoint(codePoint);
      const characterWidth = value.length;
      if (characterOffset + characterWidth > target) {
        throw new Error("AST offset points inside a UTF-16 surrogate pair");
      }
      byteOffset += Buffer.byteLength(value, "utf8");
      if (codePoint === 0x0a) {
        line += 1;
      }
      characterOffset += characterWidth;
    }

    result.set(target, { byteOffset, line });
  }

  return result;
}
