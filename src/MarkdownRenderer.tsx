import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Models also use LaTeX's \(…\) and \[…\] delimiters. Leave code untouched.
function normalizeMath(text: string) {
  return text
    .split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(
              /\\\[([\s\S]*?)\\\]/g,
              (_, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`,
            )
            .replace(
              /\\\(([\s\S]*?)\\\)/g,
              (_, math: string) => `$${math.trim()}$`,
            ),
    )
    .join("");
}

// Generated answers may cite external sources, but must not link to app routes.
function referenceUrl(href?: string) {
  if (!href || !/^https?:\/\//i.test(href)) return undefined;
  try {
    const url = new URL(href);
    return url.origin === window.location.origin ? undefined : url.href;
  } catch {
    return undefined;
  }
}

export default memo(function MarkdownRenderer({
  content,
}: {
  content: string;
}) {
  return (
    <div className="prose markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { strict: "ignore", throwOnError: false, trust: false },
          ],
        ]}
        skipHtml
        components={{
          a: ({ children, href, title }) => {
            const safeHref = referenceUrl(href);
            return safeHref ? (
              <a
                href={safeHref}
                title={title}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          table: ({ children }) => (
            <div className="markdown-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {normalizeMath(content)}
      </ReactMarkdown>
    </div>
  );
});
