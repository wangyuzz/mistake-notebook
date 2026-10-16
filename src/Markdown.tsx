import { lazy, memo, Suspense } from "react";
// Keep the Markdown and formula engines out of the initial mobile page download.
const Renderer = lazy(() => import("./MarkdownRenderer"));
export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  return (
    <Suspense fallback={<div className="prose">{content}</div>}>
      <Renderer content={content} />
    </Suspense>
  );
});
