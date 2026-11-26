// 笔记列表（主窗侧栏）的键盘操作。未分类与各分类下的笔记项都带 data-note-item="true"；
// 分类收起时其中的笔记项仍留在 DOM 里（grid 0fr 收起），靠 data-category-collapsed 跳过。

export const NOTE_ITEM_SELECTOR = '[data-note-item="true"]';
const NOTE_LIST_SELECTOR = "[data-note-list]";
const COLLAPSED_CATEGORY_SELECTOR = '[data-category-collapsed="true"]';

/** 列表里当前可见的笔记项（按显示顺序） */
export function getVisibleNoteItems(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(NOTE_ITEM_SELECTOR)).filter(
    (item) => !item.closest(COLLAPSED_CATEGORY_SELECTOR),
  );
}

/** 当前笔记项的上 / 下一个可见笔记项，跨分类分组；到头返回 null */
export function getAdjacentNoteItem(current: HTMLElement, direction: 1 | -1): HTMLElement | null {
  const scope = current.closest<HTMLElement>(NOTE_LIST_SELECTOR) ?? document;
  const items = getVisibleNoteItems(scope);
  const index = items.indexOf(current);
  if (index === -1) return null;
  return items[index + direction] ?? null;
}

/** 键盘唤出右键菜单的锚点：笔记项右上角，菜单贴着该项右侧展开、不遮挡该项 */
export function getNoteMenuAnchor(item: HTMLElement): { x: number; y: number } {
  const rect = item.getBoundingClientRect();
  return { x: rect.right, y: rect.top };
}

export interface NoteItemKeyActions {
  /** Enter：打开 / 加载该笔记 */
  openNote: () => void;
  /** Shift+F10 / ContextMenu 键：以该笔记项为锚点打开右键菜单 */
  openNoteMenu: (anchor: HTMLElement) => void;
}

interface NoteItemKeyEvent {
  key: string;
  shiftKey: boolean;
  currentTarget: HTMLElement | null;
  preventDefault: () => void;
}

/** 笔记项上的 keydown；返回是否已处理（已处理时焦点滚动等默认行为已被阻止） */
export function handleNoteItemKey(event: NoteItemKeyEvent, actions: NoteItemKeyActions): boolean {
  const item = event.currentTarget;
  if (!item) return false;

  switch (event.key) {
    case "ArrowDown":
    case "ArrowUp": {
      event.preventDefault();
      getAdjacentNoteItem(item, event.key === "ArrowDown" ? 1 : -1)?.focus();
      return true;
    }
    case "Enter":
      event.preventDefault();
      actions.openNote();
      return true;
    case "F10":
      if (!event.shiftKey) return false;
      event.preventDefault();
      actions.openNoteMenu(item);
      return true;
    case "ContextMenu":
      event.preventDefault();
      actions.openNoteMenu(item);
      return true;
    default:
      return false;
  }
}
