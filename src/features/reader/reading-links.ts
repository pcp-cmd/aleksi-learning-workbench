const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

function linkPathPart(href: string): string {
  const queryIndex = href.indexOf("?");
  const hashIndex = href.indexOf("#");
  const suffixIndexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  const end = suffixIndexes.length === 0 ? href.length : Math.min(...suffixIndexes);
  return href.slice(0, end);
}

export function normalizeReadingRelativePath(path: string): string {
  return path.replaceAll("\\", "/").normalize("NFC").replace(/^\.\//u, "");
}

export function resolveReadingLinkPath(
  sourceRelativePath: string,
  href: string
): string | null {
  const trimmed = href.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    URL_SCHEME.test(trimmed)
  ) {
    return null;
  }

  let targetPath = linkPathPart(trimmed);
  if (targetPath.length === 0) return null;

  try {
    targetPath = decodeURIComponent(targetPath);
  } catch {
    return null;
  }

  targetPath = targetPath.replaceAll("\\", "/").normalize("NFC");
  const sourcePath = normalizeReadingRelativePath(sourceRelativePath);
  const segments = targetPath.startsWith("/")
    ? []
    : sourcePath.split("/").slice(0, -1).filter(Boolean);

  for (const segment of targetPath.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.length === 0 ? null : segments.join("/");
}
