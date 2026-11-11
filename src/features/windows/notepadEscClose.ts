import type { NoteSurfaceMode } from "./surfaceMode";

/**
 * 便签小窗是否响应 Esc 关闭：开关开启，且当前是快捷唤起的 pad 态。
 * 磁贴态，以及磁贴进入编辑撑起的 pad 态（editExpanded，即仍记有还原边界）
 * 都不响应，避免误关正在编辑的窗口。
 */
export function shouldCloseOnEsc({
  enabled,
  surfaceMode,
  editExpanded,
}: {
  enabled: boolean;
  surfaceMode: NoteSurfaceMode;
  editExpanded: boolean;
}): boolean {
  return enabled && surfaceMode === "pad" && !editExpanded;
}
