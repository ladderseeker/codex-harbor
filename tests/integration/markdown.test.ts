import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "../../apps/web/src/MarkdownMessage.tsx";
const render = (text: string) =>
  renderToStaticMarkup(createElement(MarkdownMessage, { text }));

test("assistant Markdown renders GFM semantics without inline alignment styles", () => {
  const html = render(
    "# Heading\n\n**bold** *italic* ~~gone~~ `inline`\n\n| Item | Count |\n| --- | ---: |\n| Apples | 2 |\n\n- [x] Done\n\n> Quote\n\n1. Ordered\n\n---",
  );
  for (const tag of [
    "h1",
    "strong",
    "em",
    "del",
    "code",
    "table",
    "blockquote",
    "ol",
    "hr",
  ])
    assert.match(html, new RegExp(`<${tag}[ >/]`));
  assert.match(html, /class="markdown-align-right"/);
  assert.doesNotMatch(html, /style=/);
  assert.match(html, /disabled=""/);
});

test("long outer Markdown fences preserve inner code fences, including incomplete streams", () => {
  const source =
    "````markdown\n# Literal\n```js\nconst n = 1;\n```\n````\n\n**Finished**";
  const partial = render(source.slice(0, source.indexOf("const") + 8));
  assert.match(
    partial,
    /<code class="language-markdown"># Literal\n```js\nconst n/,
  );
  const complete = render(source);
  assert.match(complete, /const n = 1;\n```\n<\/code>/);
  assert.match(complete, /<strong>Finished<\/strong>/);
  assert.doesNotMatch(complete, /<h1>/);
  for (let i = 0; i <= source.length; i++)
    assert.doesNotThrow(() => render(source.slice(0, i)));
  assert.match(render("~~~markdown\n```js\nx\n```\n~~~"), /```js\nx\n```/);
});

test("HTML, unsafe URLs and images cannot create active content or automatic requests", () => {
  const html = render(
    "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n![pixel](https://example.com/pixel)\n\n[safe](https://example.com)",
  );
  assert.doesNotMatch(html, /<(script|img|iframe)|href="javascript:|onerror="/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /pixel \(image\)/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("Mermaid and unknown code languages have readable source labels", () => {
  assert.match(render("```mermaid\ngraph TD; A-->B\n```"), /Mermaid source/);
  assert.match(render("```unknown\n<unsafe>\n```"), /&lt;unsafe&gt;/);
});

test("footnotes navigate within the document and have unique IDs in each reply", () => {
  const text = "First[^1].\n\n[^1]: Footnote content.";
  const html = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(MarkdownMessage, { text }),
      createElement(MarkdownMessage, { text }),
    ),
  );
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, ids.length);
  const fragments = [...html.matchAll(/<a [^>]*href="#([^"]+)"[^>]*>/g)];
  assert.equal(fragments.length, 4);
  for (const [anchor, destination] of fragments) {
    assert.ok(ids.includes(destination));
    assert.doesNotMatch(anchor, /target=/);
  }
  for (const [, label] of html.matchAll(/aria-describedby="([^"]+)"/g))
    assert.ok(ids.includes(label));
  assert.match(html, /aria-label="Back to reference 1"/);
  assert.match(render("[external](https://example.com)"), /target="_blank"/);
});

test("code/source copy controls sit after the code region and never repeat on ordinary paragraphs", () => {
  const html = render(
    "First paragraph.\n\nSecond paragraph.\n\n```js\n  const x = 1;\n\n    x++;\n```\n\n````markdown\n# Heading\n```js\nx();\n```\n````",
  );
  assert.equal([...html.matchAll(/class="markdown-code-actions"/g)].length, 2);
  assert.match(html, /<\/pre><div class="markdown-code-actions">/);
  assert.match(html, /aria-label="Copy code"/);
  assert.match(html, /aria-label="Copy Markdown source"/);
  assert.match(html, /  const x = 1;\n\n    x\+\+;\n<\/code>/);
  assert.equal(
    [...render("Plain\n\nparagraph\n\n`inline code`").matchAll(/<button/g)]
      .length,
    0,
  );
});
