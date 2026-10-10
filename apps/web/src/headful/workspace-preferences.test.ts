import { describe, expect, it } from "vite-plus/test";
import { moveHeaderControl, resolveHeaderControls } from "./workspace-preferences";

const controls = [
  { id: "headful.admin-utilities/search", order: 0, defaultVisible: true },
  { id: "headful.admin-utilities/favorites", order: 1, defaultVisible: true },
  { id: "headful.admin-utilities/status", order: 2, defaultVisible: false },
];

describe("workspace header preferences", () => {
  it("resolves persisted order and visibility without restoring unavailable contributions", () => {
    const result = resolveHeaderControls(controls.slice(0, 2), {
      order: [
        "headful.admin-utilities/status",
        "headful.admin-utilities/favorites",
        "headful.admin-utilities/search",
      ],
      hidden: ["headful.admin-utilities/search"],
    });
    expect(result.map(({ id, visible }) => ({ id, visible }))).toEqual([
      { id: "headful.admin-utilities/favorites", visible: true },
      { id: "headful.admin-utilities/search", visible: false },
    ]);
  });
  it("adds newly contributed controls in declared order and de-duplicates saved IDs", () => {
    const result = resolveHeaderControls(controls, {
      order: ["headful.admin-utilities/favorites", "headful.admin-utilities/favorites"],
      hidden: [],
    });
    expect(result.map(({ id }) => id)).toEqual([
      "headful.admin-utilities/favorites",
      "headful.admin-utilities/search",
      "headful.admin-utilities/status",
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
