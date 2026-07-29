import {
  type ComponentProps,
  useEffect,
  useState
} from "react";
import { apiClient, hasDesktopApiSession } from "../../lib/api-client";

export function readingImageUrl(readingId: string, source: string): string {
  const normalized = source.trim();
  if (
    /^data:image\/(?:avif|bmp|gif|jpeg|png|webp);base64,/iu.test(normalized)
  ) {
    return normalized;
  }
  if (
    normalized.length === 0 ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/iu.test(normalized)
  ) {
    return "";
  }

  return `/api/readings/${encodeURIComponent(readingId)}/media?path=${encodeURIComponent(normalized)}`;
}

const MAX_READING_IMAGE_RESPONSE_BYTES = 10 * 1024 * 1024;
const READING_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

type AuthenticatedReadingImageProps = ComponentProps<"img"> & {
  node?: unknown;
};

function isProtectedReadingImageUrl(source: string): boolean {
  return /^\/api\/readings\/[^/?#]+\/media(?:\?|$)/u.test(source);
}

export function AuthenticatedReadingImage({
  alt,
  node: _node,
  src,
  title
}: AuthenticatedReadingImageProps) {
  const [zoomed, setZoomed] = useState(false);
  const [loadedImage, setLoadedImage] = useState<{
    objectUrl: string;
    source: string;
  } | null>(null);
  const source = typeof src === "string" ? src : "";
  const requiresAuthenticatedFetch =
    source.length > 0 &&
    isProtectedReadingImageUrl(source) &&
    hasDesktopApiSession();

  useEffect(() => {
    if (!requiresAuthenticatedFetch) {
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;

    void apiClient
      .getBinary(source, {
        allowedMimeTypes: READING_IMAGE_MIME_TYPES,
        maxBytes: MAX_READING_IMAGE_RESPONSE_BYTES,
        signal: controller.signal
      })
      .then((blob) => {
        if (controller.signal.aborted) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setLoadedImage({ objectUrl, source });
      })
      .catch(() => undefined);

    return () => {
      controller.abort(new DOMException("Reading image changed", "AbortError"));
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [requiresAuthenticatedFetch, source]);

  if (source.length === 0) {
    return null;
  }

  const resolvedSource = requiresAuthenticatedFetch
    ? loadedImage?.source === source
      ? loadedImage.objectUrl
      : undefined
    : source;
  const image = (
    <img
      alt={alt ?? ""}
      className="markdown-reader__image"
      loading="lazy"
      src={resolvedSource}
      title={title}
    />
  );

  return (
    <>
      <button
        aria-label={alt ? `放大图片：${alt}` : "放大图片"}
        className="markdown-reader__image-button"
        onClick={() => setZoomed(true)}
        type="button"
      >
        {image}
      </button>
      {zoomed ? (
        <button
          aria-label="关闭图片预览"
          className="markdown-reader__image-zoom"
          onClick={() => setZoomed(false)}
          type="button"
        >
          <img alt={alt ?? ""} src={resolvedSource} title={title} />
        </button>
      ) : null}
    </>
  );
}
