export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Protect local CSV exports from spreadsheet formulas while preserving quotes and line breaks. */
export function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function recordsCsv(
  columns: readonly string[],
  records: readonly Record<string, unknown>[],
): string {
  return [
    columns.map(csvCell).join(","),
    ...records.map((record) => columns.map((column) => csvCell(record[column])).join(",")),
  ].join("\r\n");
}

export function downloadLocal(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyLocal(
  value: string,
  onFeedback: (message: string) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    onFeedback("Copied to the clipboard.");
  } catch {
    onFeedback("The clipboard is unavailable. Select and copy the visible value instead.");
  }
}
