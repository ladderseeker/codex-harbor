import { monacoNonce } from "./monaco-nonce.ts";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [monacoNonce(), react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
