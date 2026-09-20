import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import markdown from "highlight.js/lib/languages/markdown";

for (const [name, grammar] of Object.entries({
  javascript,
  typescript,
  python,
  bash,
  json,
  yaml,
  xml,
  css,
  sql,
  go,
  rust,
  java,
  c,
  cpp,
  markdown,
}))
  hljs.registerLanguage(name, grammar);
hljs.registerAliases(["shell", "shellscript", "zsh"], { languageName: "bash" });

/** Only bundled grammar output becomes markup; null means render escaped text. */
export function highlightCode(text: string, language: string): string | null {
  const selected = language.toLowerCase();
  if (
    !selected ||
    selected === "mermaid" ||
    !hljs.getLanguage(selected) ||
    new TextEncoder().encode(text).byteLength > 32 * 1024
  )
    return null;
  try {
    return hljs.highlight(text, { language: selected, ignoreIllegals: true })
      .value;
  } catch {
    return null;
  }
}
