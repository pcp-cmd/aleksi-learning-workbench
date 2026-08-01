import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from "react";
import type { Components } from "react-markdown";

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join("");
  }
  return "";
}

function languageFromClassName(className: string | undefined): string | null {
  const match = /(?:^|\s)language-([\w-]+)/u.exec(className ?? "");
  return match?.[1] ?? null;
}

type MarkdownAnchorProps = ComponentProps<"a"> & {
  node?: unknown;
};

function MarkdownLink({
  children,
  href,
  node: _node,
  ...props
}: MarkdownAnchorProps) {
  const external = typeof href === "string" && /^https?:\/\//iu.test(href);

  return (
    <a
      {...props}
      href={href}
      rel={external ? "noopener noreferrer" : props.rel}
      target={external ? "_blank" : props.target}
    >
      {children}
    </a>
  );
}

type MarkdownImageProps = ComponentProps<"img"> & {
  node?: unknown;
};

function MarkdownImage({
  alt,
  node: _node,
  src,
  title
}: MarkdownImageProps) {
  const [zoomed, setZoomed] = useState(false);

  if (typeof src !== "string" || src.length === 0) {
    return null;
  }

  const image = (
    <img
      alt={alt ?? ""}
      className="markdown-reader__image"
      loading="lazy"
      src={src}
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
          <img alt={alt ?? ""} src={src} title={title} />
        </button>
      ) : null}
    </>
  );
}

type MarkdownCodeProps = ComponentProps<"code"> & {
  inline?: boolean;
  node?: unknown;
};

function MarkdownCode({
  children,
  className,
  inline: _inline,
  node: _node,
  ...props
}: MarkdownCodeProps) {
  return (
    <code {...props} className={className}>
      {children}
    </code>
  );
}

type MarkdownPreProps = ComponentProps<"pre"> & {
  node?: unknown;
};

function MarkdownPre({
  children,
  node: _node,
  ...props
}: MarkdownPreProps) {
  const codeElement = isValidElement<{
    children?: ReactNode;
    className?: string;
  }>(children)
    ? children
    : null;
  const language = languageFromClassName(codeElement?.props.className) ?? "text";
  const codeText = textFromChildren(
    codeElement?.props.children ?? children
  ).replace(/\n$/u, "");
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
    },
    []
  );

  const showCopyStatus = (status: "copied" | "failed") => {
    setCopyStatus(status);
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
    }
    resetTimer.current = window.setTimeout(
      () => setCopyStatus("idle"),
      status === "copied" ? 1600 : 2400
    );
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      showCopyStatus("copied");
    } catch {
      showCopyStatus("failed");
    }
  };

  return (
    <figure className="markdown-reader__code-block">
      <figcaption>
        <span>{language}</span>
        <button aria-live="polite" onClick={copyCode} type="button">
          {copyStatus === "copied"
            ? "已复制"
            : copyStatus === "failed"
              ? "复制失败"
              : "复制"}
        </button>
      </figcaption>
      <pre {...props}>{children}</pre>
    </figure>
  );
}

export const markdownComponents: Components = {
  a: MarkdownLink,
  code: MarkdownCode,
  img: MarkdownImage,
  pre: MarkdownPre
};
