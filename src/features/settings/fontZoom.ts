// 字号缩放快捷键（Obsidian 风格的 Ctrl/Cmd 与 + / - / 0 组合）。
// 按键判定与步进是纯函数、不依赖 DOM：主窗口用它调编辑器字号，便签/磁贴窗用它调表面字号。
export type FontZoomDirection = "in" | "out" | "reset";

// 与设置面板里两个字号滑块的范围保持一致
export const FONT_ZOOM_MIN = 8;
export const FONT_ZOOM_MAX = 30;
export const FONT_ZOOM_STEP = 1;
export const FONT_ZOOM_DEFAULT = 14;

interface FontZoomKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
  code: string;
}

const ZOOM_IN_KEYS = new Set(["=", "+", "Add"]);
const ZOOM_IN_CODES = new Set(["Equal", "NumpadAdd"]);
const ZOOM_OUT_KEYS = new Set(["-", "Subtract"]);
const ZOOM_OUT_CODES = new Set(["Minus", "NumpadSubtract"]);
const ZOOM_RESET_KEYS = new Set(["0"]);
const ZOOM_RESET_CODES = new Set(["Digit0", "Numpad0"]);

export function getFontZoomDirection(event: FontZoomKeyboardEvent): FontZoomDirection | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  if (event.altKey) return null;

  // 放大同时认 Shift 层：美式键盘上的 + 就是 Shift+=
  if (ZOOM_IN_KEYS.has(event.key) || ZOOM_IN_CODES.has(event.code)) return "in";
  if (ZOOM_OUT_KEYS.has(event.key) || ZOOM_OUT_CODES.has(event.code)) return "out";
  // Ctrl+Shift+0 常被输入法切换等占用，不算复位
  if (!event.shiftKey && (ZOOM_RESET_KEYS.has(event.key) || ZOOM_RESET_CODES.has(event.code))) {
    return "reset";
  }

  return null;
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_ZOOM_DEFAULT;
  return Math.min(FONT_ZOOM_MAX, Math.max(FONT_ZOOM_MIN, Math.round(value)));
}

export function nextFontSize(current: number, direction: FontZoomDirection): number {
  if (direction === "reset") return FONT_ZOOM_DEFAULT;
  const baseSize = clampFontSize(current);
  const delta = direction === "in" ? FONT_ZOOM_STEP : -FONT_ZOOM_STEP;
  return clampFontSize(baseSize + delta);
}

// 录制全局快捷键时按下 Ctrl+= 等组合是在「录入快捷键」，不应同时触发字号缩放
export function isFontZoomEventTargetBlocked(target: EventTarget | null): boolean {
  // Node / Vitest 等无 DOM 环境没有 HTMLElement
  if (typeof HTMLElement === "undefined") return false;
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('[data-shortcut-recorder-recording="true"]'))
  );
}
