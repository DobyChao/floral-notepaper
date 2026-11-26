// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { NoteMetadata } from "../features/notes/types";
import type { AppConfig } from "../features/settings/types";
import { ContextMenuProvider } from "./ContextMenu";
import { MainWindow } from "./MainWindow";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  convertFileSrc: (path: string) => path,
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: tauri.listen,
}));

vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: vi.fn(() => Promise.resolve(null)),
  getCurrentWindow: () => ({
    label: "main",
    isMaximized: () => Promise.resolve(false),
    onDragDropEvent: () => Promise.resolve(() => {}),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const config: AppConfig = {
  locale: "zh-CN",
  dataDir: "/home/user/.floral",
  globalShortcut: "Control+Alt+N",
  closeToTray: true,
  autostart: false,
  // 纯文本编辑视图：便于顺带验证 textarea 上的 Esc
  defaultViewMode: "edit",
  noteAutoSave: true,
  noteSurfaceAutoSave: true,
  tileColor: "#f6f3ec",
  tileColorMode: "system",
  theme: "system",
  fontSize: 14,
  surfaceFontSize: 14,
  tabIndentSize: 2,
  externalFileAutoSave: false,
  rememberSurfaceSize: true,
  tileCtrlClose: true,
  notepadEscClose: true,
  tileDoubleClickToEdit: true,
  tileSaveReturnsToPin: false,
  tileRenderMarkdown: true,
  renderHtmlMarkdown: false,
  splitScrollSync: true,
  codeBlockLineNumbers: false,
  editorLineNumbers: false,
  liveActiveHighlight: "off",
  codeWrap: true,
  toggleVisibilityShortcut: "Control+Alt+M",
  openAtCursor: true,
};

const stamp = (day: number) => `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`;
const note = (id: string, title: string, category: string, day: number): NoteMetadata => ({
  id,
  title,
  fileName: `${id}.md`,
  category,
  createdAt: stamp(day),
  updatedAt: stamp(day),
  wordCount: 1,
  preview: `${title} 的预览`,
});

// 未分类两篇 + 「工作」两篇 + 「归档」一篇
const notes = [
  note("a1", "归档 1", "归档", 1),
  note("w2", "工作 2", "工作", 2),
  note("w1", "工作 1", "工作", 3),
  note("u2", "未分类 2", "", 4),
  note("u1", "未分类 1", "", 5),
];
const categories = ["工作", "归档"];

// 菜单打开 / 切换子面板后的自动聚焦走 requestAnimationFrame；改成手动刷帧
const frames: Array<FrameRequestCallback | null> = [];
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  frames.push(callback);
  return frames.length;
});
vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
  frames[handle - 1] = null;
});

let container: HTMLDivElement;
let root: Root;

async function flushFrames() {
  const pending = frames
    .splice(0)
    .filter((callback): callback is FrameRequestCallback => callback !== null);
  await act(async () => {
    pending.forEach((callback) => callback(0));
  });
}

/** 让挂起的事件循环任务（加载笔记、菜单退场动画等）跑完 */
const settle = (ms = 0) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

function key(target: EventTarget, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

const noteItems = () =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-note-item="true"]'));
const titleOf = (item: HTMLElement) => item.querySelector("span")?.textContent ?? "";
const noteItem = (title: string) => {
  const item = noteItems().find((element) => titleOf(element) === title);
  if (!item) throw new Error(`note item not rendered: ${title}`);
  return item;
};
const categoryHeader = (name: string) => {
  const header = Array.from(container.querySelectorAll<HTMLElement>('[class*="group/cat"]')).find(
    (element) => element.querySelector("span")?.textContent === name,
  );
  if (!header) throw new Error(`category header not rendered: ${name}`);
  return header;
};
/** 收起分类下的笔记项仍在 DOM 里，只是不可见 */
const isCollapsed = (item: HTMLElement) =>
  item.closest('[data-category-collapsed="true"]') !== null;
const visibleItems = () => noteItems().filter((item) => !isCollapsed(item));

const menus = () => Array.from(container.querySelectorAll<HTMLElement>('[role="menu"]'));
const menuItemsOf = (menu: HTMLElement) =>
  Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
const labelOf = (item: HTMLElement) => item.textContent ?? "";
const focusedLabel = () =>
  document.activeElement?.getAttribute("role") === "menuitem"
    ? labelOf(document.activeElement as HTMLElement)
    : null;

beforeEach(async () => {
  tauri.listen.mockResolvedValue(() => {});
  tauri.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "config_get":
        return config;
      case "config_save":
        return args?.config;
      case "global_shortcut_check":
        return { available: true, conflictType: "none", message: "" };
      case "notes_list":
        return notes;
      case "categories_list":
        return categories;
      case "notes_get": {
        const metadata = notes.find((entry) => entry.id === args?.id);
        if (!metadata) throw new Error(`unexpected notes_get for ${String(args?.id)}`);
        return { ...metadata, content: `${metadata.title} 的正文` };
      }
      case "take_startup_file":
        return null;
      case "update_status":
        return { status: "idle", latestVersion: null };
      case "images_get_base_dir":
        return null;
      default:
        return null;
    }
  });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ContextMenuProvider>
        <MainWindow />
      </ContextMenuProvider>,
    );
  });
  // 引导流程：读配置 / 笔记列表 / 分类，再加载第一篇笔记
  await settle();
  await flushFrames();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("main window note list keyboard support", () => {
  test("every note item is focusable with a visible focus ring", () => {
    expect(noteItems()).toHaveLength(5);
    for (const item of noteItems()) {
      expect(item.tabIndex).toBe(0);
      expect(item.className).toContain("focus-visible:outline-none");
      expect(item.className).toContain("focus-visible:ring-2");
      expect(item.className).toContain("focus-visible:ring-bamboo/50");
      // 焦点环走 box-shadow：只过渡颜色，否则 600ms 的过渡会让焦点环跟着慢慢淡入
      expect(item.className).toContain("transition-colors");
      expect(item.className).not.toContain("transition-all");
    }
  });

  test("↑/↓ walk the visible items in display order, across category groups", async () => {
    // 分类默认收起：先展开两个分类，让列表横跨「工作 / 归档 / 未分类」三个分组
    act(() => categoryHeader("工作").click());
    act(() => categoryHeader("归档").click());

    const order = visibleItems().map(titleOf);
    // 分组顺序：分类（按名称）在前、未分类在后；组内按更新时间倒序
    expect(order).toEqual(["工作 1", "工作 2", "归档 1", "未分类 1", "未分类 2"]);

    noteItem(order[0]).focus();
    for (const title of order.slice(1)) {
      key(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(noteItem(title));
    }
    // 到底后不再移动
    key(document.activeElement!, "ArrowDown");
    expect(titleOf(document.activeElement as HTMLElement)).toBe(order[order.length - 1]);

    for (const title of [...order].reverse().slice(1)) {
      key(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(noteItem(title));
    }
    key(document.activeElement!, "ArrowUp");
    expect(titleOf(document.activeElement as HTMLElement)).toBe(order[0]);
  });

  test("↑/↓ never move focus into a collapsed category", async () => {
    act(() => categoryHeader("工作").click());
    expect(visibleItems().map(titleOf)).toEqual(["工作 1", "工作 2", "未分类 1", "未分类 2"]);
    // 「归档」仍收起：它的笔记项还在 DOM 里
    expect(noteItems().filter(isCollapsed).map(titleOf)).toEqual(["归档 1"]);

    // 焦点万一落在收起的笔记项上：上下都找不到相邻的可见项，保持不动、不报错
    noteItem("归档 1").focus();
    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowUp");
    expect(titleOf(document.activeElement as HTMLElement)).toBe("归档 1");

    // 紧邻收起分组的可见项，直接越过它
    noteItem("工作 2").focus();
    key(document.activeElement!, "ArrowDown");
    expect(titleOf(document.activeElement as HTMLElement)).toBe("未分类 1");

    key(document.activeElement!, "ArrowUp");
    expect(titleOf(document.activeElement as HTMLElement)).toBe("工作 2");
  });

  test("collapsed categories are inert, so Tab never lands on their hidden note items", () => {
    const bodyOf = (item: HTMLElement) => item.closest(".category-body")!;

    // 分类默认全部收起
    expect(bodyOf(noteItem("工作 1")).hasAttribute("inert")).toBe(true);
    expect(bodyOf(noteItem("归档 1")).hasAttribute("inert")).toBe(true);

    act(() => categoryHeader("工作").click());

    expect(bodyOf(noteItem("工作 1")).hasAttribute("inert")).toBe(false);
    expect(bodyOf(noteItem("归档 1")).hasAttribute("inert")).toBe(true);
  });

  test("Enter opens the focused note", async () => {
    tauri.invoke.mockClear();
    noteItem("未分类 2").focus();

    key(document.activeElement!, "Enter");
    await settle();

    expect(tauri.invoke).toHaveBeenCalledWith("notes_get", { id: "u2" });
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="无标题笔记"]')!.value,
    ).toBe("未分类 2");
    expect(container.querySelector("textarea")!.value).toBe("未分类 2 的正文");
  });

  test("Shift+F10 and the ContextMenu key open the note menu on the focused item", async () => {
    const item = noteItem("未分类 1");
    item.focus();

    // 单按 F10 不是唤出菜单的按键
    key(item, "F10");
    await flushFrames();
    expect(menus()).toHaveLength(0);

    expect(key(item, "F10", { shiftKey: true }).defaultPrevented).toBe(true);
    await flushFrames();

    expect(menus()).toHaveLength(1);
    const menu = menus()[0];
    expect(menu.tabIndex).toBe(-1);
    expect(menuItemsOf(menu).map(labelOf)).toEqual(["导出 Markdown", "移动到分类…", "删除笔记"]);
    expect(focusedLabel()).toBe("导出 Markdown");

    key(document.activeElement!, "Escape");
    await settle(200);
    expect(menus()).toHaveLength(0);

    key(item, "ContextMenu");
    await flushFrames();
    expect(menus()).toHaveLength(1);
    expect(focusedLabel()).toBe("导出 Markdown");
  });

  test("the note menu is fully operable from the keyboard", async () => {
    noteItem("未分类 1").focus();
    key(document.activeElement!, "F10", { shiftKey: true });
    await flushFrames();

    key(document.activeElement!, "ArrowDown");
    expect(focusedLabel()).toBe("移动到分类…");
    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowDown");
    expect(focusedLabel()).toBe("删除笔记");
    key(document.activeElement!, "ArrowUp");
    expect(focusedLabel()).toBe("移动到分类…");

    // 进入「移动到分类」子面板：焦点落到首项「返回」
    act(() => document.activeElement!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flushFrames();
    expect(menuItemsOf(menus()[0]).map(labelOf)).toEqual(["返回", "未分类", "工作", "归档"]);
    expect(focusedLabel()).toBe("返回");

    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowDown");
    expect(focusedLabel()).toBe("工作");

    // 回到主面板：焦点重新落到首项
    key(document.activeElement!, "ArrowUp");
    key(document.activeElement!, "ArrowUp");
    expect(focusedLabel()).toBe("返回");
    act(() => document.activeElement!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flushFrames();
    expect(focusedLabel()).toBe("导出 Markdown");
  });

  test("choosing a category with the keyboard moves the note", async () => {
    tauri.invoke.mockClear();
    noteItem("未分类 1").focus();
    key(document.activeElement!, "F10", { shiftKey: true });
    await flushFrames();
    act(() => menuItemsOf(menus()[0])[1].click()); // 移动到分类…
    await flushFrames();

    act(() => menuItemsOf(menus()[0])[2].click()); // 工作
    await settle(200);

    expect(tauri.invoke).toHaveBeenCalledWith("notes_move_category", {
      id: "u1",
      category: "工作",
    });
    expect(menus()).toHaveLength(0);
  });

  test("Esc on the note menu hands focus back to the note item that opened it", async () => {
    const item = noteItem("未分类 2");
    item.focus();
    key(item, "F10", { shiftKey: true });
    await flushFrames();
    expect(document.activeElement).not.toBe(item);

    key(document.activeElement!, "Escape");

    expect(document.activeElement).toBe(item);
    // 还焦后可以直接接着用方向键浏览列表
    key(item, "ArrowUp");
    expect(document.activeElement).toBe(noteItem("未分类 1"));
    await settle(200);
    expect(menus()).toHaveLength(0);
  });
});

describe("main window menus and editor Esc", () => {
  test("the category menu is fully operable from the keyboard", async () => {
    const header = categoryHeader("归档");
    act(() =>
      header.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      ),
    );
    await flushFrames();

    expect(menus()).toHaveLength(1);
    expect(menuItemsOf(menus()[0]).map(labelOf)).toEqual(["重命名", "删除分类"]);
    expect(focusedLabel()).toBe("重命名");

    key(document.activeElement!, "ArrowDown");
    expect(focusedLabel()).toBe("删除分类");

    // 切到删除确认面板：焦点落到「确认删除」
    act(() => document.activeElement!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flushFrames();
    expect(menuItemsOf(menus()[0]).map(labelOf)).toEqual(["确认删除", "取消"]);
    expect(focusedLabel()).toBe("确认删除");

    key(document.activeElement!, "ArrowDown");
    expect(focusedLabel()).toBe("取消");

    key(document.activeElement!, "Escape");
    await settle(200);
    expect(menus()).toHaveLength(0);
  });

  test("Esc in the plain editor releases focus and nothing else", async () => {
    const textarea = container.querySelector("textarea")!;
    act(() => textarea.focus());

    // 输入法组合中的 Esc 是取消候选：不退出编辑
    key(textarea, "Escape", { isComposing: true });
    expect(document.activeElement).toBe(textarea);

    key(textarea, "Escape");
    expect(document.activeElement).not.toBe(textarea);

    // 编辑器内容与窗口都原样保留
    expect(container.querySelector("textarea")!.value).toBe("归档 1 的正文");
    expect(noteItems()).toHaveLength(5);
  });
});

describe("font zoom and shortcut recording alongside the keyboard navigation", () => {
  const editorFontSize = () => container.querySelector("textarea")!.style.fontSize;
  const savedConfigs = () =>
    tauri.invoke.mock.calls
      .filter(([command]) => command === "config_save")
      .map(([, args]) => (args as { config: AppConfig }).config);

  /** 等某个条件成立（懒加载的设置面板、定时器触发的状态更新等） */
  async function until(condition: () => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) await settle(10);
    if (!condition()) throw new Error("condition not met in time");
  }

  async function openSettings() {
    act(() => container.querySelector<HTMLButtonElement>('button[title="设置"]')!.click());
    await until(() => container.querySelector("aside") !== null);
    await flushFrames(); // 面板内容滑入
    await settle(80); // 打开 60ms 后焦点自动移入面板
  }

  test("Ctrl/Cmd + = / - / 0 keep zooming wherever focus sits", async () => {
    tauri.invoke.mockClear();

    // 焦点在笔记项上
    noteItem("未分类 1").focus();
    key(document.activeElement!, "=", { ctrlKey: true });
    expect(editorFontSize()).toBe("15px");

    // 焦点在编辑器里
    const textarea = container.querySelector("textarea")!;
    act(() => textarea.focus());
    key(textarea, "=", { ctrlKey: true });
    expect(editorFontSize()).toBe("16px");
    key(textarea, "-", { metaKey: true });
    expect(editorFontSize()).toBe("15px");

    // 焦点在打开的笔记菜单里：菜单只接管 ↑/↓/Esc，缩放键照常冒泡到 document
    noteItem("未分类 1").focus();
    key(document.activeElement!, "F10", { shiftKey: true });
    await flushFrames();
    expect(menus()).toHaveLength(1);
    key(document.activeElement!, "=", { ctrlKey: true });
    expect(editorFontSize()).toBe("16px");
    expect(focusedLabel()).toBe("导出 Markdown");
    key(document.activeElement!, "0", { ctrlKey: true });
    expect(editorFontSize()).toBe("14px");

    // 保存是防抖的：停手后只落盘最后一次
    await settle(350);
    expect(savedConfigs().map((saved) => saved.fontSize)).toEqual([14]);
  });

  test("while recording a shortcut, Esc only cancels the recording and zoom stays out", async () => {
    await openSettings();
    const panel = () => container.querySelector<HTMLElement>("aside");
    // 面板打开后焦点自动落在首个控件（标题栏的关闭按钮）上
    expect(document.activeElement).toBe(panel()!.querySelector("button"));

    // Chromium 下点击 / 键盘触发都会让录制按钮持有焦点
    const record = Array.from(panel()!.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("点击录制"),
    )!;
    act(() => record.focus());
    act(() => record.click());
    await until(() => panel()!.querySelector('[data-shortcut-recorder-recording="true"]') !== null);
    const isRecording = () =>
      panel()!.querySelector('[data-shortcut-recorder-recording="true"]') !== null;

    // 录制期按 Ctrl+= 是在录入快捷键：字号不变，组合键被录进去
    tauri.invoke.mockClear();
    key(record, "=", { ctrlKey: true });
    expect(editorFontSize()).toBe("14px");
    // 录制结束后还要等冲突检测返回，新快捷键才会写进配置
    await until(() => !isRecording());
    await until(() => Boolean(record.textContent?.includes("Ctrl+=")));
    await settle(350);
    expect(savedConfigs().map((saved) => saved.globalShortcut)).toEqual(["Ctrl+="]);

    // 录制期的 Esc：只取消录制，设置面板不关
    act(() => record.click());
    await until(() => isRecording());
    key(record, "Escape");
    await until(() => !isRecording());
    expect(panel()).not.toBeNull();
    expect(record.textContent).toContain("Ctrl+=");

    // 录制结束后，Esc 才关闭设置面板
    key(document.activeElement!, "Escape");
    await until(() => panel() === null, 1000);
  });
});
