import { t, type TFunction } from "i18next";
import type { NoteSurfaceAction } from "./surfaceActions";
import { DEFAULT_WINDOW_LAYER, type WindowLayer } from "./windowLayer";

export interface TileContextMenuItem {
  action: NoteSurfaceAction;
  label: string;
  tone?: "danger";
  /** 可勾选项（窗口层级 / 开机自启）是否为当前值 */
  checked?: boolean;
}

export interface TileContextMenuSeparator {
  separator: true;
}

export type TileContextMenuEntry = TileContextMenuItem | TileContextMenuSeparator;

export function getTileContextMenuItems(
  translate: TFunction = t,
  currentLayer: WindowLayer = DEFAULT_WINDOW_LAYER,
  autostartEnabled: boolean = false,
): TileContextMenuEntry[] {
  return [
    {
      action: "copy",
      label: translate("contextMenu.tile.copy", { defaultValue: "复制" }),
    },
    {
      action: "save",
      label: translate("contextMenu.tile.save", { defaultValue: "保存" }),
    },
    {
      action: "switchToPad",
      label: translate("contextMenu.tile.switchToPad", { defaultValue: "转为小窗" }),
    },
    { separator: true },
    {
      action: "layerTop",
      label: translate("contextMenu.tile.layerTop", { defaultValue: "置顶" }),
      checked: currentLayer === "top",
    },
    {
      action: "layerNormal",
      label: translate("contextMenu.tile.layerNormal", { defaultValue: "默认层级" }),
      checked: currentLayer === "normal",
    },
    {
      action: "layerBottom",
      label: translate("contextMenu.tile.layerBottom", { defaultValue: "沉底" }),
      checked: currentLayer === "bottom",
    },
    {
      action: "autostart",
      label: translate("contextMenu.tile.autostart", { defaultValue: "开机自启" }),
      checked: autostartEnabled,
    },
    { separator: true },
    {
      action: "close",
      label: translate("contextMenu.tile.close", { defaultValue: "取消钉屏" }),
      tone: "danger",
    },
  ];
}
