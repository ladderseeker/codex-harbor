import { memo, useId, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "./code-highlighting.ts";
import { CopyButton } from "./MessageActions.tsx";

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
  pre: ({ node }) => {
    const code = node?.children.find(
      (child) => child.type === "element" && child.tagName === "code",
    );
    const language =
      code?.type === "element"
        ? String(code.properties.className ?? "").replace(/^language-/, "")
        : "";
    const text =
      code?.type === "element"
        ? code.children
            .map((child) => (child.type === "text" ? child.value : ""))
            .join("")
        : "";
    return <CodeBlock text={text} language={language} />;
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
const CodeBlock = memo(function CodeBlock({
  text,
  language,
}: {
  text: string;
  language: string;
}) {
  const html = useMemo(() => highlightCode(text, language), [text, language]);
  return (
    <div className="markdown-code">
      <div className="markdown-code-header">
        <span className="markdown-code-label">
          {language === "mermaid" ? "Mermaid source" : language || "Text"}
        </span>
        <CopyButton
          text={text}
          label={
            language === "markdown" || language === "md"
              ? "Copy Markdown source"
              : "Copy code"
          }
        />
      </div>
      <pre
        tabIndex={0}
        aria-label={language ? `${language} code block` : "Code block"}
      >
        {html === null ? (
          <code className={language ? `language-${language}` : undefined}>
            {text}
          </code>
        ) : (
          <code
            className={`language-${language}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </pre>
    </div>
  );
});

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
