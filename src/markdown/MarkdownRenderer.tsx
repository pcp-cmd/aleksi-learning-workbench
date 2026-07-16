import { Component, memo, type ReactNode } from "react";
import "katex/dist/katex.min.css";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components
} from "react-markdown";
import rehypeKatex from "rehype-katex";
import { markdownComponents } from "./MarkdownComponents";
import { markdownRemarkPlugins } from "./MarkdownPlugins";
import "./MarkdownTheme.css";

export interface MarkdownRendererProps {
  components?: Components;
  resolveImageUrl?: (source: string) => string;
  source: string;
}

type MarkdownBoundaryProps = {
  fallback: ReactNode;
  children: ReactNode;
};

type MarkdownBoundaryState = {
  failed: boolean;
};

class MarkdownBoundary extends Component<
  MarkdownBoundaryProps,
  MarkdownBoundaryState
> {
  state: MarkdownBoundaryState = { failed: false };

  static getDerivedStateFromError(): MarkdownBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export function stripYamlFrontmatter(source: string): string {
  const sourceWithoutBom = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(
    sourceWithoutBom
  );

  if (frontmatter === null) {
    return source;
  }

  return sourceWithoutBom.slice(frontmatter[0].length);
}

function MarkdownRendererView({
  components,
  resolveImageUrl,
  source
}: MarkdownRendererProps) {
  return (
    <MarkdownBoundary
      fallback={
        <pre className="markdown-fallback" data-testid="markdown-raw-fallback">
          {source}
        </pre>
      }
      key={source}
    >
      <div className="markdown-reader markdown-math">
        <ReactMarkdown
          components={{ ...markdownComponents, ...components }}
          rehypePlugins={[rehypeKatex]}
          remarkPlugins={markdownRemarkPlugins}
          urlTransform={(url, key) => {
            const safeUrl = defaultUrlTransform(url);
            if (
              key !== "src" ||
              safeUrl.length === 0 ||
              resolveImageUrl === undefined
            ) {
              return safeUrl;
            }

            return defaultUrlTransform(resolveImageUrl(safeUrl));
          }}
        >
          {stripYamlFrontmatter(source)}
        </ReactMarkdown>
      </div>
    </MarkdownBoundary>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererView);
MarkdownRenderer.displayName = "MarkdownRenderer";

export const MarkdownMath = MarkdownRenderer;
