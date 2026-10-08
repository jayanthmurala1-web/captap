import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * The one way document content is rendered: markdown, plus any embedded HTML (older docs were
 * saved as HTML by the previous editor) — always sanitized, since agents and clients write here.
 */
export function DocContent({
  content,
  className = "prose-doc",
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
      >
        {content}
      </Markdown>
    </div>
  );
}
