// 弹出菜单的键盘操作：主窗的笔记 / 分类右键菜单与全局编辑右键菜单（ContextMenu）共用。
// 约定：菜单容器 role="menu"、tabIndex={-1}，菜单项是其中未禁用的 <button>。

/** 菜单容器里可聚焦的菜单项（跳过禁用项） */
export const MENU_ITEM_SELECTOR = "button:not([disabled])";

export function getEnabledMenuItems(container: ParentNode): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR));
}

/** 聚焦首个可用菜单项（菜单打开或切换子面板后调用） */
export function focusFirstMenuItem(container: HTMLElement | null): void {
  if (container) getEnabledMenuItems(container)[0]?.focus();
}

/**
 * ↑/↓ 在可用菜单项间移动焦点，到头即停。
 * 焦点不在任何菜单项上时（例如落在菜单容器自身），两个方向都落到首项。
 */
export function focusAdjacentMenuItem(container: HTMLElement, direction: 1 | -1): void {
  const items = getEnabledMenuItems(container);
  if (items.length === 0) return;
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), items.length - 1);
  items[nextIndex]?.focus();
}

/**
 * 菜单容器上的 keydown：↑/↓ 换项、Esc 关闭（关闭逻辑由调用方提供）。
 * 返回是否已处理，已处理时调用方应 preventDefault。
 */
export function handleMenuKeyDown(container: HTMLElement, key: string, close: () => void): boolean {
  switch (key) {
    case "ArrowDown":
      focusAdjacentMenuItem(container, 1);
      return true;
    case "ArrowUp":
      focusAdjacentMenuItem(container, -1);
      return true;
    case "Escape":
      close();
      return true;
    default:
      return false;
  }
}
