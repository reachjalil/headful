import { describe, expect, it } from "vite-plus/test";
import { moveHeaderControl, resolveHeaderControls } from "./workspace-preferences";

const controls = [
  { id: "admin-utilities/search", order: 0, defaultVisible: true },
  { id: "admin-utilities/favorites", order: 1, defaultVisible: true },
  { id: "admin-utilities/status", order: 2, defaultVisible: false },
];

describe("workspace header preferences", () => {
  it("resolves persisted order and visibility without restoring unavailable contributions", () => {
    const result = resolveHeaderControls(controls.slice(0, 2), {
      order: ["admin-utilities/status", "admin-utilities/favorites", "admin-utilities/search"],
      hidden: ["admin-utilities/search"],
    });
    expect(result.map(({ id, visible }) => ({ id, visible }))).toEqual([
      { id: "admin-utilities/favorites", visible: true },
      { id: "admin-utilities/search", visible: false },
    ]);
  });
  it("adds newly contributed controls in declared order and de-duplicates saved IDs", () => {
    const result = resolveHeaderControls(controls, {
      order: ["admin-utilities/favorites", "admin-utilities/favorites"],
      hidden: [],
    });
    expect(result.map(({ id }) => id)).toEqual([
      "admin-utilities/favorites",
      "admin-utilities/search",
      "admin-utilities/status",
    ]);
    expect(resolveHeaderControls(controls).at(-1)?.visible).toBe(false);
    expect(resolveHeaderControls(controls, { order: [], hidden: [] }).at(-1)?.visible).toBe(false);
  });
  it("supports keyboard reorder without moving beyond either end", () => {
    const order = controls.map(({ id }) => id);
    expect(moveHeaderControl(order, order[1]!, -1)).toEqual([order[1], order[0], order[2]]);
    expect(moveHeaderControl(order, order[0]!, -1)).toEqual(order);
    expect(moveHeaderControl(order, "missing", 1)).toEqual(order);
  });
});
