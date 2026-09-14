import { memo, useId, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  table: ({ children }) => (
    <div
      className="markdown-scroll"
      tabIndex={0}
      role="region"
      aria-label="Markdown table"
    >
      <table>{children}</table>
    </div>
  ),
  pre: ({ children, node }) => {
    const code = node?.children.find(
      (child) => child.type === "element" && child.tagName === "code",
    );
    const language =
      code?.type === "element"
        ? String(code.properties.className ?? "").replace(/^language-/, "")
        : "";
    return (
      <div className="markdown-code">
        {language && (
          <div className="markdown-code-label">
            {language === "mermaid" ? "Mermaid source" : language}
          </div>
        )}
        <pre
          tabIndex={0}
          aria-label={language ? `${language} code block` : "Code block"}
        >
          {children}
        </pre>
      </div>
    );
  },
  // Images in model text must not make automatic requests to arbitrary endpoints.
  // Attachments keep their dedicated, authenticated preview component.
  img: ({ alt, src }) => (
    <a
      href={typeof src === "string" && src ? src : undefined}
      target="_blank"
      rel="noopener noreferrer"
    >
      {alt || "Image"} (image)
    </a>
  ),
  // GFM alignment normally emits inline styles, which the application CSP denies.
  th: ({ children, style }) => (
    <th className={alignment(style?.textAlign)}>{children}</th>
  ),
  td: ({ children, style }) => (
    <td className={alignment(style?.textAlign)}>{children}</td>
  ),
};
function alignment(value: string | undefined) {
  return value === "center" || value === "right"
    ? `markdown-align-${value}`
    : undefined;
}
const plugins = [remarkGfm];

/** Parse accumulated source on each stream update; never execute model HTML. */
export const MarkdownMessage = memo(function MarkdownMessage({
  text,
}: {
  text: string;
}) {
  const id = useId();
  const prefix = `markdown-${id}-`;
  const scopedComponents = useMemo<Components>(
    () => ({
      ...components,
      a: ({ node: _node, children, href, ...props }) => (
        <a
          {...props}
          href={href || undefined}
          target={href?.startsWith("#") ? undefined : "_blank"}
          rel="noopener noreferrer"
          aria-describedby={
            props["aria-describedby"] === "footnote-label"
              ? `${prefix}footnote-label`
              : props["aria-describedby"]
          }
        >
          {children}
        </a>
      ),
      // remark-rehype scopes footnote anchors but leaves its label ID fixed.
      h2: ({ node: _node, children, ...props }) => (
        <h2
          {...props}
          id={
            props.id === "footnote-label" ? `${prefix}footnote-label` : props.id
          }
        >
          {children}
        </h2>
      ),
    }),
    [prefix],
  );
  return (
    <div className="message-text markdown-body">
      <Markdown
        remarkPlugins={plugins}
        components={scopedComponents}
        remarkRehypeOptions={{ clobberPrefix: prefix }}
      >
        {text}
      </Markdown>
    </div>
  );
});
