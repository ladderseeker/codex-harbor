import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
let library: Promise<typeof Monaco> | undefined;
function load() {
  (globalThis as any).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };
  return (library ??= import("monaco-editor/editor/editor.api.js"));
}
export function FileEditor({
  value,
  onChange,
  readOnly = false,
  original,
  label,
}: {
  value: string;
  onChange?: (text: string) => void;
  readOnly?: boolean;
  original?: string;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<
      | Monaco.editor.IStandaloneCodeEditor
      | Monaco.editor.IStandaloneDiffEditor
      | null
    >(null),
    change = useRef(onChange),
    latest = useRef(value);
  change.current = onChange;
  latest.current = value;
  useEffect(() => {
    let dead = false,
      models: Monaco.editor.ITextModel[] = [];
    void load().then((m) => {
      if (dead || !host.current) return;
      m.editor.defineTheme("harbor-neutral", {
        base: "vs",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#ffffff",
          "editor.foreground": "#191919",
          "editorLineNumber.foreground": "#737373",
          "editor.selectionBackground": "#dedede",
          "editor.inactiveSelectionBackground": "#e9e9e9",
          "editor.lineHighlightBackground": "#fafafa",
          "diffEditor.insertedTextBackground": "#dedede80",
          "diffEditor.removedTextBackground": "#adadad66",
          "diffEditor.insertedLineBackground": "#f5f5f5",
          "diffEditor.removedLineBackground": "#e9e9e9",
          "diffEditorGutter.insertedLineBackground": "#dedede",
          "diffEditorGutter.removedLineBackground": "#adadad",
          "diffEditorOverview.insertedForeground": "#adadad",
          "diffEditorOverview.removedForeground": "#737373",
        },
      });
      const options = {
        theme: "harbor-neutral",
        automaticLayout: true,
        minimap: { enabled: false },
        readOnly,
        ariaLabel: label,
        fontSize: 14,
        lineHeight: 22,
        wordWrap: "on" as const,
        links: false,
        hover: { enabled: "off" as const },
        contextmenu: false,
        renderValidationDecorations: "off" as const,
        scrollBeyondLastLine: false,
      };
      const model = m.editor.createModel(latest.current, "plaintext");
      models.push(model);
      if (original !== undefined) {
        const before = m.editor.createModel(original, "plaintext");
        models.push(before);
        const view = m.editor.createDiffEditor(host.current, {
          ...options,
          renderSideBySide: window.innerWidth >= 900,
          originalEditable: false,
        });
        view.setModel({ original: before, modified: model });
        editor.current = view;
      } else
        editor.current = m.editor.create(host.current, { ...options, model });
      model.onDidChangeContent(() =>
        change.current?.(model.getValue(undefined, true)),
      );
    });
    return () => {
      dead = true;
      editor.current?.dispose();
      editor.current = null;
      for (const model of models) model.dispose();
    };
  }, [label, readOnly, original]);
  useEffect(() => {
    const current = editor.current;
    if (!current) return;
    const model =
      "getModifiedEditor" in current
        ? current.getModifiedEditor().getModel()
        : current.getModel();
    if (model && model.getValue(undefined, true) !== value)
      model.setValue(value);
  }, [value]);
  return <div className="file-editor" ref={host} aria-label={label} />;
}
