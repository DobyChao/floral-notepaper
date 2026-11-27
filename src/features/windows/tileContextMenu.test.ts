import { describe, expect, test } from "vitest";
import { getTileContextMenuItems } from "./tileContextMenu";
import type { WindowLayer } from "./windowLayer";

const itemLabels = (items: ReturnType<typeof getTileContextMenuItems>) =>
  items.flatMap((item) => ("separator" in item ? [] : [item]));

const findItem = (action: string, layer: WindowLayer = "top", autostart = false) =>
  itemLabels(getTileContextMenuItems(undefined, layer, autostart)).find(
    (item) => item.action === action,
  );

describe("getTileContextMenuItems", () => {
  test("keeps the base actions and closes with a danger tone", () => {
    const items = itemLabels(getTileContextMenuItems());

    expect(items.map((item) => item.action)).toEqual([
      "copy",
      "save",
      "switchToPad",
      "layerTop",
      "layerNormal",
      "layerBottom",
      "autostart",
      "close",
    ]);
    expect(items[items.length - 1]?.tone).toBe("danger");
  });

  test("marks the autostart item only when enabled", () => {
    expect(findItem("autostart", "top", false)?.checked).toBe(false);
    expect(findItem("autostart", "top", true)?.checked).toBe(true);
  });

  test("marks only the current layer as checked", () => {
    for (const layer of ["top", "normal", "bottom"] as const) {
      const items = itemLabels(getTileContextMenuItems(undefined, layer)).filter((item) =>
        item.action.startsWith("layer"),
      );
      const currentAction = `layer${layer[0].toUpperCase()}${layer.slice(1)}`;

      expect(items.map((item) => item.checked)).toEqual(
        items.map((item) => item.action === currentAction),
      );
    }
  });

  test("separates the layer group and the close action", () => {
    const entries = getTileContextMenuItems();
    expect(entries.filter((entry) => "separator" in entry)).toHaveLength(2);
  });
});
