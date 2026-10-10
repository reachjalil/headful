import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import {
  StreamLanguage,
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";

import type { CodeEditorProps } from "./CodeEditor";

// Colouring only. Salesforce owns formula validation and evaluation.
const formula = StreamLanguage.define({
  startState: () => ({ comment: false }),
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.comment = false;
      } else stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("/*")) {
      state.comment = true;
      return "comment";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(/\d+(?:\.\d+)?/)) return "number";
    if (stream.match(/(?:true|false|null)\b/i)) return "atom";
    if (stream.match(/[A-Za-z_$][\w.$]*/))
      return stream.match(/^\s*\(/, false) ? "function" : "variableName";
    if (stream.match(/[+\-*/^&=<>!]+/)) return "operator";
    stream.next();
    return null;
  },
});

const syntaxColors: Readonly<Record<string, string>> = {
  "#708": "var(--geist-code-keyword, #708)",
  "#219": "var(--geist-code-number, #219)",
  "#164": "var(--geist-code-string, #164)",
  "#a11": "var(--geist-code-string, #a11)",
  "#a50": "var(--geist-code-comment, #a50)",
  "#00f": "var(--geist-link, #00f)",
  "#085": "var(--geist-link, #085)",
  "#256": "var(--geist-link, #256)",
  "#30a": "var(--geist-link, #30a)",
  "#940": "var(--geist-code-number, #940)",
};
const syntaxTheme = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) => ({
    ...spec,
    ...(spec.color ? { color: syntaxColors[spec.color] ?? spec.color } : {}),
  })),
);

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", color: "var(--hf-ink, #23314c)" },
  ".cm-scroller": {
    fontFamily: "var(--geist-font-mono, ui-monospace), monospace",
    overflow: "auto",
  },
  ".cm-content": { padding: "6px 0", minHeight: "100%" },
  ".cm-line": { padding: "0 10px" },
  ".cm-gutters": {
    background: "var(--hf-soft, #f6f7fb)",
    color: "var(--hf-muted, #65718a)",
    borderRight: "1px solid var(--hf-line, #e1e5ef)",
  },
  ".cm-activeLine, .cm-activeLineGutter": { background: "var(--geist-selected, #eceeff70)" },
  ".cm-cursor": { borderLeftColor: "var(--hf-violet, #626dd2)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    background: "var(--geist-editor-selection, #cdd2ff80)",
  },
  ".cm-panels": { background: "var(--hf-soft, #f6f7fb)", color: "var(--hf-ink, #23314c)" },
  ".cm-search": {
    fontFamily: "var(--geist-font-sans, -apple-system), sans-serif",
    fontSize: "12px",
  },
  ".cm-tooltip": {
    border: "1px solid var(--hf-line, #e1e5ef)",
    background: "var(--hf-card, white)",
    borderRadius: "4px",
  },
});

/** A controlled code surface; editing never invokes a service or evaluates source. */
export function CodeEditorSurface({
  value,
  onChange,
  onRun,
  label,
  testId,
  language,
  readOnly,
  completions,
  maxLength,
  ref: editorRef,
}: CodeEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const current = useRef({ value, onChange, onRun, completions, maxLength, readOnly });
  const wrap = useRef(new Compartment());
  const [wordWrap, setWordWrap] = useState(language === "formula");
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [limitReached, setLimitReached] = useState(false);
  useEffect(() => {
    current.current = { value, onChange, onRun, completions, maxLength, readOnly };
  });
  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => view.current?.focus(),
      insert: (text) => {
        const editor = view.current;
        if (!editor || current.current.readOnly) return;
        editor.dispatch(editor.state.replaceSelection(text));
        editor.focus();
      },
    }),
    [],
  );
  useEffect(() => {
    if (!container.current) return;
    const initial = current.current;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          basicSetup,
          syntaxHighlighting(syntaxTheme),
          editorTheme,
          language === "soql" ? sql() : language === "formula" ? formula : markdown(),
          EditorState.readOnly.of(readOnly ?? false),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            "aria-label": label,
            "data-testid": testId,
            "aria-multiline": "true",
            role: "textbox",
            tabindex: "0",
            "aria-readonly": String(Boolean(readOnly)),
          }),
          wrap.current.of(language === "formula" ? EditorView.lineWrapping : []),
          autocompletion({
            interactionDelay: 0,
            override: [
              (context) => {
                const word = context.matchBefore(/[\w.$]*/);
                if (!word || (!context.explicit && word.from === word.to)) return null;
                return {
                  from: word.from,
                  options: current.current.completions ?? [],
                  validFor: /^[\w.$]*$/,
                };
              },
            ],
          }),
          Prec.highest(
            keymap.of(
              ["Mod-Enter", "Ctrl-Enter"].map((key) => ({
                key,
                run: () => {
                  if (!current.current.onRun) return false;
                  current.current.onRun(editor.state.doc.toString());
                  return true;
                },
              })),
            ),
          ),
          EditorState.transactionFilter.of((transaction) => {
            if (
              transaction.docChanged &&
              transaction.newDoc.length > (current.current.maxLength ?? 100000)
            ) {
              setLimitReached(true);
              return [];
            }
            return transaction;
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setLimitReached(false);
            if (
              update.docChanged &&
              !update.transactions.some((t) => t.annotation(Transaction.remote))
            ) {
              current.current.onChange?.(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setPosition({ line: line.number, column: head - line.from + 1 });
            }
          }),
        ],
      }),
    });
    view.current = editor;
    editor.dispatch({ selection: { anchor: 0 } });
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, [language, readOnly, label, testId]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: Transaction.remote.of(true),
      });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: wrap.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
    // Reapply wrapping after a new source language or identity creates a view.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- These identities also recreate the editor above.
  }, [wordWrap, language, readOnly, label, testId]);
  return (
    <div className="hf-code-editor">
      <div className="hf-code-surface" ref={container} />
      <div className="hf-code-status">
        <span>
          Ln {position.line}, Col {position.column}
        </span>
        {limitReached && <span role="status">Limit: {maxLength ?? 100000} characters</span>}
        <span>
          {readOnly ? "Read only" : "Draft"} ·{" "}
          {language === "soql"
            ? "SOQL"
            : language === "formula"
              ? "Salesforce formula"
              : "Markdown"}
        </span>
        <button type="button" aria-pressed={wordWrap} onClick={() => setWordWrap(!wordWrap)}>
          Wrap
        </button>
      </div>
    </div>
  );
}
