import type { Plugin } from "vite";
/** Adapt only the three style factories in the pinned xterm 6.0.0 bundle. */
export function xtermNonce(): Plugin {
  return {
    name: "harbor-xterm-style-nonce",
    enforce: "pre",
    transform(source, id) {
      if (!id.endsWith("/@xterm/xterm/lib/xterm.mjs")) return;
      const factory = /(?:[A-Za-z_$][\w$]*\.)+createElement\("style"\)/g;
      if ([...source.matchAll(factory)].length !== 3)
        throw Error("Pinned xterm style factories changed; review CSP adapter");
      const attributes =
        't.setAttribute("style",`${t.getAttribute("style")||""}${e};`)';
      if (source.split(attributes).length !== 2)
        throw Error(
          "Pinned xterm cell style factory changed; review CSP adapter",
        );
      return {
        code: source
          .replace(
            factory,
            (call) =>
              `Object.assign(${call},{nonce:document.querySelector('meta[name="harbor-style-nonce"]')?.content??''})`,
          )
          .replace(attributes, 't.style.cssText+=e+";"'),
        map: null,
      };
    },
  };
}
