import { HttpError } from "../domain/types.ts";
type Token = { value: string; start: number; end: number };
/** Parse only the top-level query clauses; quoted values and nested SELECTs
 * cannot impersonate LIMIT/OFFSET. sf data query remains the only executor. */
export function readOnlySoql(query: string) {
  if (!query.trim() || query.length > 21000 || /\u0000/.test(query))
    throw new HttpError(400, "soql_invalid", "Enter a bounded read-only SOQL query.");
  const tokens: Token[] = [];
  let depth = 0,
    quoted = false;
  for (let i = 0; i < query.length;) {
    const char = query[i]!;
    if (quoted) {
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === "'") quoted = false;
      i++;
      continue;
    }
    if (char === "'") {
      quoted = true;
      i++;
      continue;
    }
    if (
      char === ";" ||
      char === '"' ||
      query.startsWith("/*", i) ||
      query.startsWith("//", i) ||
      query.startsWith("--", i)
    )
      throw new HttpError(
        400,
        "soql_read_only",
        "Use one SELECT query without comments or execution statements.",
      );
    if (char === "(") {
      depth++;
      i++;
      continue;
    }
    if (char === ")") {
      if (--depth < 0) throw new HttpError(400, "soql_invalid", "Balance the query parentheses.");
      i++;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_]*|^\d+/.exec(query.slice(i));
    if (match) {
      if (depth === 0)
        tokens.push({ value: match[0].toUpperCase(), start: i, end: i + match[0].length });
      i += match[0].length;
    } else i++;
  }
  if (
    quoted ||
    depth !== 0 ||
    tokens[0]?.value !== "SELECT" ||
    !tokens.some((token) => token.value === "FROM") ||
    tokens.some((token) => ["FOR", "ALL"].includes(token.value))
  )
    throw new HttpError(
      400,
      "soql_read_only",
      "Use a SELECT query without row locks, tracking clauses or ALL ROWS.",
    );
  return tokens;
}
export function boundedSoql(query: string, page: number, pageSize: number) {
  const tokens = readOnlySoql(query),
    removals: [number, number][] = [];
  let originalLimit = Number.MAX_SAFE_INTEGER,
    baseOffset = 0;
  for (const name of ["LIMIT", "OFFSET"] as const) {
    const positions = tokens
      .map((token, i) => (token.value === name ? i : -1))
      .filter((i) => i >= 0);
    if (positions.length > 1)
      throw new HttpError(400, "soql_invalid", "Use one top-level LIMIT and OFFSET.");
    const index = positions[0];
    if (index === undefined) continue;
    const token = tokens[index]!,
      value = tokens[index + 1];
    if (!value || !/^\d+$/.test(value.value) || !/^\s+$/.test(query.slice(token.end, value.start)))
      throw new HttpError(400, "soql_bound", "Use an integer LIMIT and OFFSET.");
    const amount = Number(value.value);
    if (!Number.isSafeInteger(amount))
      throw new HttpError(400, "soql_bound", "The query bound is too large.");
    if (name === "LIMIT") originalLimit = amount;
    else baseOffset = amount;
    removals.push([token.start, value.end]);
  }
  const skipped = (page - 1) * pageSize,
    offset = baseOffset + skipped;
  if (offset > 2000)
    throw new HttpError(
      400,
      "query_page_bound",
      "Salesforce supports at most 2,000 skipped rows here. Refine the query or reduce the page number.",
    );
  const remaining = Math.max(0, originalLimit - skipped),
    limit = Math.min(pageSize + 1, remaining);
  let base = query;
  for (const [start, end] of removals.sort((a, b) => b[0] - a[0]))
    base = base.slice(0, start) + base.slice(end);
  return {
    query: `${base.trim()} LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ""}`,
    limit,
    canPage: offset + pageSize <= 2000 && remaining > pageSize,
  };
}
