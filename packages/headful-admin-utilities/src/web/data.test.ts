import { describe, expect, it } from "vite-plus/test";
import { recordsCsv } from "./data";

describe("local CRM CSV export", () => {
  it("escapes structured values, quotes, delimiters and spreadsheet formulas", () => {
    expect(
      recordsCsv(
        ["Name", "Notes", "Data"],
        [
          {
            Name: '=HYPERLINK("https://example.test")',
            Notes: "line 1\nline, 2",
            Data: { active: true },
          },
        ],
      ),
    ).toBe(
      '"Name","Notes","Data"\r\n"\'=HYPERLINK(""https://example.test"")","line 1\nline, 2","{""active"":true}"',
    );
  });
  it("exports a useful header for an empty result and leaves missing fields empty", () => {
    expect(recordsCsv(["Id", "Name"], [])).toBe('"Id","Name"');
    expect(recordsCsv(["Id", "Name"], [{ Id: "001example" }])).toBe(
      '"Id","Name"\r\n"001example",""',
    );
  });
});
