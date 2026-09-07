import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
/** Pinned Monaco has no public nonce option. Adapt only its trusted style factories. */
export function monacoNonce(): Plugin {
  return {
    name: "harbor-monaco-style-nonce",
    enforce: "pre",
    transform(source, id) {
      const replacements: Record<string, [string, string][]> = {
        "editor/browser/view/domLineBreaksComputer.js": [
          [
            "containerDomNode.innerHTML = trustedhtml;",
            "setMonacoHTML(containerDomNode,trustedhtml);",
          ],
        ],
        "editor/browser/view/viewLayer.js": [
          [
            "this._domNode.innerHTML = newLinesHTML;",
            "setMonacoHTML(this._domNode,newLinesHTML);",
          ],
          [
            "lastChild.insertAdjacentHTML('afterend', newLinesHTML);",
            "appendMonacoHTML(lastChild,'afterend',newLinesHTML);",
          ],
          [
            "hugeDomNode.innerHTML = invalidLinesHTML;",
            "setMonacoHTML(hugeDomNode,invalidLinesHTML);",
          ],
        ],
        "editor/standalone/browser/colorizer.js": [
          [
            "domNode.innerHTML = trustedhtml;",
            "setMonacoHTML(domNode,trustedhtml);",
          ],
        ],
        "editor/browser/controller/editContext/native/screenReaderContentRich.js":
          [
            [
              "domNode.innerHTML = trustedhtml;",
              "setMonacoHTML(domNode,trustedhtml);",
            ],
          ],
        "editor/browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.js":
          [["root.innerHTML = content;", "setMonacoHTML(root,content);"]],
        "editor/contrib/stickyScroll/browser/stickyScrollWidget.js": [
          [
            "lineHTMLNode.innerHTML = newLine;",
            "setMonacoHTML(lineHTMLNode,newLine);",
          ],
        ],
        "editor/contrib/inlineCompletions/browser/view/ghostText/ghostTextView.js":
          [
            [
              "domNode.innerHTML = trustedhtml;",
              "setMonacoHTML(domNode,trustedhtml);",
            ],
          ],
        "editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js":
          [
            [
              "domNode.innerHTML = trustedhtml;",
              "setMonacoHTML(domNode,trustedhtml);",
            ],
          ],
        "editor/browser/widget/diffEditor/components/accessibleDiffViewer.js": [
          [
            "cell.insertAdjacentHTML('beforeend', html);",
            "appendMonacoHTML(cell,'beforeend',html);",
          ],
        ],
      };
      for (const [suffix, pairs] of Object.entries(replacements)) {
        if (!id.endsWith("/monaco-editor/esm/vs/" + suffix)) continue;
        for (const [before, after] of pairs) {
          const expected = suffix.endsWith("accessibleDiffViewer.js") ? 2 : 1;
          if (source.split(before).length !== expected + 1)
            throw Error(
              "Pinned Monaco layout factory changed; review CSP adapter",
            );
          source = source.replaceAll(before, after);
        }
        return {
          code:
            `import {setMonacoHTML,appendMonacoHTML} from ${JSON.stringify(fileURLToPath(new URL("./src/monaco-layout.ts", import.meta.url)))};\n` +
            source,
          map: null,
        };
      }
      if (
        id.endsWith(
          "/monaco-editor/esm/vs/editor/browser/widget/diffEditor/components/diffEditorViewZones/diffEditorViewZones.js",
        )
      ) {
        const before =
          "marginElement.setAttribute('style', `position:absolute;top:${i * modLineHeight}px;width:${renderOptions.lineDecorationsWidth}px;height:${modLineHeight}px;right:0;`);";
        if (source.split(before).length !== 2)
          throw Error("Pinned Monaco style attribute factory changed");
        return {
          code: source.replace(
            before,
            "marginElement.style.cssText = `position:absolute;top:${i * modLineHeight}px;width:${renderOptions.lineDecorationsWidth}px;height:${modLineHeight}px;right:0;`;",
          ),
          map: null,
        };
      }
      if (
        ![
          "/monaco-editor/esm/vs/base/browser/domStylesheets.js",
          "/monaco-editor/esm/vs/base/browser/ui/contextview/contextview.js",
        ].some((suffix) => id.endsWith(suffix))
      )
        return;
      const factory = "document.createElement('style')";
      if (source.split(factory).length !== 2)
        throw Error("Pinned Monaco style factory changed; review CSP adapter");
      return {
        code: source.replace(
          factory,
          `Object.assign(document.createElement('style'), { nonce: document.querySelector('meta[name="harbor-style-nonce"]')?.content ?? '' })`,
        ),
        map: null,
      };
    },
  };
}
