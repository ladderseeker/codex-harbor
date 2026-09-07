/** Only called by pinned Monaco renderers after their own text escaping. Not a sanitizer. */
function inertLayout(markup: string): string {
  let result = "",
    position = 0;
  while (position < markup.length) {
    const start = markup.indexOf("<", position);
    if (start < 0) return result + markup.slice(position);
    result += markup.slice(position, start);
    let end = start + 1,
      quote = "";
    for (; end < markup.length; end++) {
      const c = markup[end]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    const tag = markup.slice(start, end + 1);
    let rewritten = "",
      i = 0;
    // Copy the tag name, then lex attributes; text and quoted attribute values are untouched.
    while (i < tag.length && !/\s/.test(tag[i]!)) rewritten += tag[i++];
    while (i < tag.length) {
      while (i < tag.length && /\s/.test(tag[i]!)) rewritten += tag[i++];
      const begin = i;
      while (i < tag.length && !/[\s=>/]/.test(tag[i]!)) i++;
      if (i === begin) {
        rewritten += tag[i++] ?? "";
        continue;
      }
      const name = tag.slice(begin, i);
      rewritten +=
        name.toLowerCase() === "style" ? "data-harbor-monaco-layout" : name;
      while (i < tag.length && /\s/.test(tag[i]!)) rewritten += tag[i++];
      if (tag[i] !== "=") continue;
      rewritten += tag[i++];
      while (i < tag.length && /\s/.test(tag[i]!)) rewritten += tag[i++];
      const delimiter = tag[i];
      if (delimiter === '"' || delimiter === "'") {
        rewritten += tag[i++];
        while (i < tag.length) {
          const c = tag[i++]!;
          rewritten += c;
          if (c === delimiter) break;
        }
      } else
        while (i < tag.length && !/[\s>]/.test(tag[i]!)) rewritten += tag[i++];
    }
    result += rewritten;
    position = end + 1;
  }
  return result;
}
function fragment(element: Element, value: unknown) {
  const template = element.ownerDocument.createElement("template");
  template.innerHTML = inertLayout(String(value));
  for (const child of template.content.querySelectorAll<HTMLElement>(
    "[data-harbor-monaco-layout]",
  )) {
    const layout = child.getAttribute("data-harbor-monaco-layout")!;
    child.removeAttribute("data-harbor-monaco-layout");
    child.style.cssText = layout;
  }
  return template.content;
}
export function setMonacoHTML(element: Element, value: unknown) {
  element.replaceChildren(fragment(element, value));
}
export function appendMonacoHTML(
  element: Element,
  position: "afterend" | "beforeend",
  value: unknown,
) {
  const content = fragment(element, value);
  if (position === "afterend") element.after(content);
  else element.append(content);
}
