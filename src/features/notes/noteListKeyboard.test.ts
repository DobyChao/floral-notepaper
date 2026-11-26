// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getAdjacentNoteItem,
  getVisibleNoteItems,
  handleNoteItemKey,
  type NoteItemKeyActions,
} from "./noteListKeyboard";

const item = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
};

// 模拟主窗侧栏的列表结构：外部文件 → 未分类分组 → 两个分类（其中一个收起）
function buildList() {
  const list = document.createElement("div");
  list.setAttribute("data-note-list", "true");
  list.innerHTML = `
    <button id="file">外部文件</button>
    <div class="uncategorized">
      <div id="n1" data-note-item="true" tabindex="0">未分类 1</div>
      <div id="n2" data-note-item="true" tabindex="0">未分类 2</div>
    </div>
    <div class="category">
      <div class="category-header">工作</div>
      <div class="category-body expanded">
        <div class="category-body-inner">
          <div id="n3" data-note-item="true" tabindex="0">工作 1</div>
          <div id="n4" data-note-item="true" tabindex="0">工作 2</div>
        </div>
      </div>
    </div>
    <div class="category">
      <div class="category-header">归档</div>
      <div class="category-body" data-category-collapsed="true">
        <div class="category-body-inner">
          <div id="n5" data-note-item="true" tabindex="0">归档 1</div>
        </div>
      </div>
    </div>
  `;
  document.body.append(list);
  return list;
}

function keyEvent(
  current: HTMLElement,
  key: string,
  shiftKey = false,
): { event: Parameters<typeof handleNoteItemKey>[0]; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  return { event: { key, shiftKey, currentTarget: current, preventDefault }, preventDefault };
}

const idleActions = (): NoteItemKeyActions => ({ openNote: vi.fn(), openNoteMenu: vi.fn() });

const ids = (elements: HTMLElement[]) => elements.map((element) => element.id);

afterEach(() => {
  document.body.replaceChildren();
});

describe("note list keyboard navigation", () => {
  test("only note items count as list entries, and collapsed categories are skipped", () => {
    const list = buildList();

    expect(ids(getVisibleNoteItems(list))).toEqual(["n1", "n2", "n3", "n4"]);
  });

  test("↑/↓ cross group boundaries in both directions", () => {
    buildList();

    expect(getAdjacentNoteItem(item("n1"), 1)).toBe(item("n2"));
    expect(getAdjacentNoteItem(item("n2"), 1)).toBe(item("n3"));
    expect(getAdjacentNoteItem(item("n3"), -1)).toBe(item("n2"));
    expect(getAdjacentNoteItem(item("n3"), 1)).toBe(item("n4"));
  });

  test("↑/↓ stop at the ends and never land on a collapsed item", () => {
    buildList();

    expect(getAdjacentNoteItem(item("n1"), -1)).toBeNull();
    expect(getAdjacentNoteItem(item("n4"), 1)).toBeNull();
  });

  test("expanding a category puts its notes back into the navigation order", () => {
    buildList();
    item("n5")
      .closest('[data-category-collapsed="true"]')
      ?.removeAttribute("data-category-collapsed");

    expect(getVisibleNoteItems(document)).toHaveLength(5);
    expect(getAdjacentNoteItem(item("n4"), 1)).toBe(item("n5"));
  });

  test("ArrowDown / ArrowUp move focus and swallow the key", () => {
    buildList();
    item("n1").focus();

    const down = keyEvent(item("n1"), "ArrowDown");
    expect(handleNoteItemKey(down.event, idleActions())).toBe(true);
    expect(document.activeElement).toBe(item("n2"));
    expect(down.preventDefault).toHaveBeenCalledTimes(1);

    const up = keyEvent(item("n2"), "ArrowUp");
    expect(handleNoteItemKey(up.event, idleActions())).toBe(true);
    expect(document.activeElement).toBe(item("n1"));
  });

  test("Enter opens the note", () => {
    buildList();
    const actions = idleActions();
    const { event, preventDefault } = keyEvent(item("n3"), "Enter");

    expect(handleNoteItemKey(event, actions)).toBe(true);
    expect(actions.openNote).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test("Shift+F10 and the ContextMenu key open the note menu anchored at the item", () => {
    buildList();
    const openNoteMenu = vi.fn();
    const actions: NoteItemKeyActions = { openNote: vi.fn(), openNoteMenu };

    expect(handleNoteItemKey(keyEvent(item("n3"), "F10", true).event, actions)).toBe(true);
    expect(handleNoteItemKey(keyEvent(item("n3"), "ContextMenu").event, actions)).toBe(true);

    expect(openNoteMenu.mock.calls).toEqual([[item("n3")], [item("n3")]]);
  });

  test("plain F10 and unrelated keys keep their default behavior", () => {
    buildList();
    const actions = idleActions();

    for (const key of ["F10", " ", "Tab", "ArrowLeft", "Escape"]) {
      const { event, preventDefault } = keyEvent(item("n1"), key);
      expect(handleNoteItemKey(event, actions)).toBe(false);
      expect(preventDefault).not.toHaveBeenCalled();
    }

    expect(actions.openNote).not.toHaveBeenCalled();
    expect(actions.openNoteMenu).not.toHaveBeenCalled();
  });
});
