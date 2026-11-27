// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { EditorState, StateField, Transaction } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ContextMenuProvider } from "./ContextMenu";
import { requestSurfaceAction } from "../features/windows/surfaceActions";
import { setCurrentTileAutostart } from "../features/windows/tileAutostart";
import { setCurrentWindowLayer } from "../features/windows/windowLayer";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(() => Promise.resolve("pasted")),
  writeText: vi.fn(() => Promise.resolve()),
}));

vi.mock("../features/settings/api", () => ({
  getConfig: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../features/windows/surfaceActions", () => ({
  requestSurfaceAction: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// jsdom 没实现 isContentEditable：按「自身或祖先带 contenteditable（非 false）」补一个最小实现
Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
  configurable: true,
  get(this: HTMLElement) {
    return this.closest('[contenteditable]:not([contenteditable="false"])') !== null;
  },
});

// 菜单打开后的自动聚焦走 requestAnimationFrame；这里改成手动刷帧，测试不依赖真实帧率
const frames: Array<FrameRequestCallback | null> = [];
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  frames.push(callback);
  return frames.length;
});
vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
  frames[handle - 1] = null;
});

async function flushFrames() {
  const pending = frames
    .splice(0)
    .filter((callback): callback is FrameRequestCallback => callback !== null);
  await act(async () => {
    pending.forEach((callback) => callback(0));
  });
}

/** 在当前焦点元素上按键：事件像真实按键一样从菜单项冒泡到菜单容器 */
function press(name: string) {
  act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

async function openMenuOn(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await flushFrames();
}

/** 在编辑器里选一段文字后右键，打开编辑菜单 */
async function openEditMenu(select: [number, number] | null = [0, 5]) {
  editor.focus();
  if (select) editor.setSelectionRange(select[0], select[1]);
  await openMenuOn(editor);
}

/** 类 CodeMirror 的可编辑宿主：内部节点自身不可聚焦 */
function appendEditableHost() {
  const host = document.createElement("div");
  host.setAttribute("contenteditable", "true");
  // jsdom 不把 contenteditable 当作可聚焦元素，补一个 tabindex 模拟浏览器的行为
  host.tabIndex = 0;
  host.innerHTML = "<span>text</span>";
  container.append(host);
  return host;
}

let container: HTMLDivElement;
let root: Root;
let editor: HTMLTextAreaElement;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ContextMenuProvider>
        <textarea defaultValue="hello world" />
      </ContextMenuProvider>,
    );
  });
  editor = container.querySelector("textarea")!;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const menu = () => container.querySelector<HTMLElement>('[role="menu"]');
const menuItems = () => Array.from(menu()?.querySelectorAll<HTMLButtonElement>("button") ?? []);
const focusedItem = () => {
  const button = menuItems().find((item) => item === document.activeElement);
  // 菜单项里快捷键提示也是文本，只取标签本身
  return button?.querySelector("span")?.textContent ?? null;
};
/** 菜单的 150ms 退场动画结束后才从 DOM 卸载 */
const finishClosing = () => act(() => vi.advanceTimersByTime(150));

describe("context menu keyboard support", () => {
  test("is a menu that focuses its first enabled item as soon as it opens", async () => {
    await openEditMenu();

    const element = menu();
    expect(element).not.toBeNull();
    expect(element!.tabIndex).toBe(-1);
    expect(menuItems().map((button) => button.getAttribute("role"))).toEqual([
      "menuitem",
      "menuitem",
      "menuitem",
      "menuitem",
    ]);
    expect(focusedItem()).toBe("剪切");
  });

  test("skips disabled items and lands on the first usable one", async () => {
    await openEditMenu(null);

    // 没有选区：剪切 / 复制不可用
    expect(menuItems().map((button) => button.disabled)).toEqual([true, true, false, false]);
    expect(focusedItem()).toBe("粘贴");
  });

  test("↑/↓ move focus between enabled items and stop at the ends", async () => {
    await openEditMenu();

    press("ArrowDown");
    expect(focusedItem()).toBe("复制");

    press("ArrowUp");
    press("ArrowUp");
    expect(focusedItem()).toBe("剪切");

    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    expect(focusedItem()).toBe("全选");

    press("ArrowDown");
    expect(focusedItem()).toBe("全选");
  });

  test("arrows never land on a disabled item", async () => {
    await openEditMenu(null);

    press("ArrowUp");
    expect(focusedItem()).toBe("粘贴");
  });

  test("Esc closes the menu and hands focus back to the editor", async () => {
    await openEditMenu();

    press("Escape");
    expect(document.activeElement).toBe(editor);

    await finishClosing();
    expect(menu()).toBeNull();
  });

  test("Esc with the menu open still reaches document-level Esc handlers", async () => {
    // 便签小窗的 notepadEscClose 等逻辑挂在 document 的 keydown 上，关菜单不能把它们拦掉
    const onDocumentKeyDown = vi.fn();
    document.addEventListener("keydown", onDocumentKeyDown);
    try {
      await openEditMenu();

      press("Escape");

      expect(onDocumentKeyDown).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", onDocumentKeyDown);
    }
  });

  test("activating an item with the keyboard runs it against the editor", async () => {
    await openEditMenu();

    act(() => menuItems()[1].click()); // 复制
    await act(async () => {});

    expect(writeText).toHaveBeenCalledWith("hello");
    // 菜单关闭后焦点仍在编辑器里，可以接着输入
    expect(document.activeElement).toBe(editor);
    await finishClosing();
    expect(menu()).toBeNull();
  });

  test("Esc hands focus back to the contenteditable that opened the menu", async () => {
    const host = appendEditableHost();
    await openMenuOn(host);

    expect(focusedItem()).toBe("粘贴");

    press("Escape");
    expect(document.activeElement).toBe(host);
  });

  test("commands focus the contenteditable host before running", async () => {
    let focusedWhenRun: Element | null = null;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        focusedWhenRun = document.activeElement;
        return true;
      }),
    });
    const host = appendEditableHost();

    // 右键点在宿主内部的子节点上
    await openMenuOn(host.firstElementChild as HTMLElement);
    act(() => menuItems()[3].click()); // 全选

    expect(document.execCommand).toHaveBeenCalledWith("selectAll");
    expect(focusedWhenRun).toBe(host);
  });

  test("menu items show a visible focus ring", async () => {
    await openEditMenu();

    for (const button of menuItems()) {
      expect(button.className).toContain("focus-visible:outline-none");
      expect(button.className).toContain("focus-visible:ring-2");
      expect(button.className).toContain("focus-visible:ring-inset");
      expect(button.className).toContain("focus-visible:ring-bamboo/50");
    }
  });
});

describe("tile context menu", () => {
  // 复制 / 保存 / 转为小窗 │ 置顶 / 默认层级 / 沉底 / 开机自启 │ 取消钉屏
  const TILE_ITEM_LABELS = [
    "复制",
    "保存",
    "转为小窗",
    "置顶",
    "默认层级",
    "沉底",
    "开机自启",
    "取消钉屏",
  ];
  let tile: HTMLDivElement;

  const tileMenu = () => openMenuOn(tile);
  /** 每个菜单项的勾选状态；不可勾选的项没有 aria-checked */
  const checkedStates = () => menuItems().map((button) => button.getAttribute("aria-checked"));

  beforeEach(() => {
    // 窗口层级 / 开机自启是模块级共享状态，每个用例显式复位
    act(() => {
      setCurrentWindowLayer("top");
      setCurrentTileAutostart(false);
    });
    vi.mocked(requestSurfaceAction).mockClear();
    tile = document.createElement("div");
    tile.dataset.contextMenu = "tile";
    tile.textContent = "pinned note";
    container.append(tile);
  });

  test("focuses its first item and reaches every item with ↑/↓ across separators", async () => {
    await tileMenu();

    expect(menuItems().map((button) => button.querySelector("span")?.textContent)).toEqual(
      TILE_ITEM_LABELS,
    );
    expect(focusedItem()).toBe("复制");

    for (const label of TILE_ITEM_LABELS.slice(1)) {
      press("ArrowDown");
      expect(focusedItem()).toBe(label);
    }
    press("ArrowDown");
    expect(focusedItem()).toBe("取消钉屏");

    for (const label of TILE_ITEM_LABELS.slice(0, -1).reverse()) {
      press("ArrowUp");
      expect(focusedItem()).toBe(label);
    }
  });

  test("exposes layer and autostart items as checkable and marks the current ones", async () => {
    await tileMenu();

    expect(menuItems().map((button) => button.getAttribute("role"))).toEqual([
      "menuitem",
      "menuitem",
      "menuitem",
      "menuitemcheckbox",
      "menuitemcheckbox",
      "menuitemcheckbox",
      "menuitemcheckbox",
      "menuitem",
    ]);
    // 默认层级为置顶、未开启开机自启
    expect(checkedStates()).toEqual([null, null, null, "true", "false", "false", "false", null]);
  });

  test("updates the check marks when the layer or autostart state changes", async () => {
    await tileMenu();

    act(() => {
      setCurrentWindowLayer("bottom");
      setCurrentTileAutostart(true);
    });

    expect(checkedStates()).toEqual([null, null, null, "false", "false", "true", "true", null]);
  });

  test("runs the matching surface action for the layer and autostart items", async () => {
    await tileMenu();
    act(() => menuItems()[3].click()); // 置顶
    await act(async () => {});

    expect(requestSurfaceAction).toHaveBeenLastCalledWith("layerTop");
    await finishClosing();
    expect(menu()).toBeNull();

    await tileMenu();
    act(() => menuItems()[5].click()); // 沉底
    expect(requestSurfaceAction).toHaveBeenLastCalledWith("layerBottom");

    await finishClosing();
    await tileMenu();
    act(() => menuItems()[6].click()); // 开机自启
    expect(requestSurfaceAction).toHaveBeenLastCalledWith("autostart");
    await finishClosing();
    expect(menu()).toBeNull();
  });

  test("Esc closes the tile menu without running an item", async () => {
    await tileMenu();
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    expect(focusedItem()).toBe("置顶");

    press("Escape");

    expect(requestSurfaceAction).not.toHaveBeenCalled();
    await finishClosing();
    expect(menu()).toBeNull();
  });
});

// 模拟即时视图：光标不在标题行时，行首的 "# " 记号被 replace 装饰隐藏，DOM 里看不到
const headingMarkDecorations = (state: EditorState): DecorationSet =>
  state.doc.line(1).text.startsWith("# ")
    ? Decoration.set([Decoration.replace({}).range(0, 2)])
    : Decoration.none;

const hideHeadingMark = StateField.define<DecorationSet>({
  create: headingMarkDecorations,
  update: (value, transaction) =>
    transaction.docChanged ? headingMarkDecorations(transaction.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});

describe("context menu on the live (CodeMirror) editor", () => {
  // 菜单打开时自动聚焦把焦点抢到了菜单项上；CodeMirror 失焦后不再接管 copy/cut 事件。
  // 所以命令要按文档选区走编辑器自身，否则复制出来的是 DOM 文本，隐藏的 Markdown 记号会丢。
  const views: EditorView[] = [];
  let userEvents: string[];
  let execCommand: ReturnType<typeof vi.fn>;

  const docOf = (view: EditorView) => view.state.doc.toString();
  const selectionOf = (view: EditorView) => {
    const { from, to } = view.state.selection.main;
    return `${from}..${to}`;
  };

  function appendEditor(
    doc: string,
    anchor: number,
    head = anchor,
    options: { readOnly?: boolean } = {},
  ) {
    const host = document.createElement("div");
    container.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: { anchor, head },
        extensions: [
          hideHeadingMark,
          EditorState.readOnly.of(Boolean(options.readOnly)),
          EditorView.updateListener.of((update) => {
            for (const transaction of update.transactions) {
              userEvents.push(...(transaction.annotation(Transaction.userEvent)?.split(" ") ?? []));
            }
          }),
        ],
      }),
    });
    // jsdom 不把 contenteditable 当作可聚焦元素，补一个 tabindex 模拟浏览器的行为
    view.contentDOM.tabIndex = 0;
    view.focus();
    views.push(view);
    return view;
  }

  /** 在编辑器内容区的某个节点上右键，打开编辑菜单 */
  async function openMenuOnEditor(view: EditorView) {
    const target = view.contentDOM.querySelector<HTMLElement>(".cm-line")!;
    act(() => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await flushFrames();
  }

  async function choose(index: number) {
    await act(async () => {
      menuItems()[index].click();
      await Promise.resolve();
    });
    await act(async () => {});
  }

  beforeEach(() => {
    userEvents = [];
    execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    vi.mocked(readText).mockResolvedValue("pasted ");
    vi.mocked(writeText).mockClear();
    vi.mocked(readText).mockClear();
  });

  afterEach(() => {
    while (views.length) views.pop()!.destroy();
  });

  test("copy takes the document text, so hidden markup survives the focus steal", async () => {
    const view = appendEditor("# Title\n\nbody", 0, 7);
    expect(view.contentDOM.textContent).not.toContain("#");

    await openMenuOnEditor(view);
    // 焦点确实被菜单抢走了
    expect(document.activeElement).not.toBe(view.contentDOM);
    await choose(1); // 复制

    expect(writeText).toHaveBeenCalledWith("# Title");
    expect(execCommand).not.toHaveBeenCalled();
    expect(docOf(view)).toBe("# Title\n\nbody");
    // 菜单关闭后焦点回到编辑器
    expect(document.activeElement).toBe(view.contentDOM);
  });

  test("cut copies the document text and deletes through a transaction", async () => {
    const view = appendEditor("# Title\n\nbody", 0, 7);

    await openMenuOnEditor(view);
    await choose(0); // 剪切

    expect(writeText).toHaveBeenCalledWith("# Title");
    expect(docOf(view)).toBe("\n\nbody");
    expect(userEvents).toContain("delete.cut");
    expect(execCommand).not.toHaveBeenCalled();
  });

  test("paste inserts the clipboard text at the cursor", async () => {
    const view = appendEditor("# Title\n\nbody", 13);

    await openMenuOnEditor(view);
    await choose(2); // 粘贴

    expect(readText).toHaveBeenCalled();
    expect(docOf(view)).toBe("# Title\n\nbodypasted ");
    expect(userEvents).toContain("input.paste");
  });

  test("selectAll selects the whole document", async () => {
    const view = appendEditor("# Title\n\nbody", 9, 11);

    await openMenuOnEditor(view);
    await choose(3); // 全选

    expect(selectionOf(view)).toBe(`0..${view.state.doc.length}`);
    expect(userEvents).toContain("select");
  });

  test("a read-only editor copies but is never modified", async () => {
    const view = appendEditor("# Title\n\nbody", 0, 7, { readOnly: true });

    await openMenuOnEditor(view);
    await choose(0); // 剪切
    expect(writeText).toHaveBeenCalledWith("# Title");
    expect(docOf(view)).toBe("# Title\n\nbody");

    await openMenuOnEditor(view);
    await choose(2); // 粘贴
    expect(docOf(view)).toBe("# Title\n\nbody");
  });
});
