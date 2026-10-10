import { lazy, memo, type Ref } from "react";
import type { Completion } from "@codemirror/autocomplete";
import { LazySurface } from "./LazySurface";

export interface CodeEditorHandle {
  focus: () => void;
  insert: (text: string) => void;
}
export interface CodeEditorProps {
  value: string;
  onChange?: ((value: string) => void) | undefined;
  onRun?: ((source: string) => void) | undefined;
  label: string;
  testId: string;
  language: "soql" | "formula" | "markdown";
  readOnly?: boolean | undefined;
  completions?: Completion[] | undefined;
  maxLength?: number | undefined;
  ref?: Ref<CodeEditorHandle> | undefined;
}

const Surface = lazy(() =>
  import("./CodeEditorSurface").then((module) => ({ default: module.CodeEditorSurface })),
);

/** Load the code engine only when a code surface is opened. */
export const CodeEditor = memo(function CodeEditor(props: CodeEditorProps) {
  return (
    <LazySurface label={`${props.label} editor`}>
      <Surface {...props} />
    </LazySurface>
  );
});
