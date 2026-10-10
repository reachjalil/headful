import { memo, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const components: Components = { a: ({ children }) => <span>{children}</span>, img: () => null };
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]> = [
  [rehypeKatex, { trust: false, strict: "error", maxSize: 10, maxExpand: 500 }],
];

/** Parse only when the bounded source changes; document mode changes reuse this tree. */
export const DocumentPreview = memo(function DocumentPreview({ source }: { source: string }) {
  return (
    <ReactMarkdown
      skipHtml
      components={components}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
    >
      {source}
    </ReactMarkdown>
  );
});
