// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { history } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { liveEditorKeymap } from "./keymap";

let view: EditorView | null = null;

function mount(doc: string, selection?: { anchor: number; head?: number }) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      // 与 LiveEditor 一致：keymap + history + markdown 语言
      extensions: [liveEditorKeymap, history(), markdown({ base: markdownLanguage })],
      ...(selection ? { selection } : {}),
    }),
  });
  return view;
}

/** 在编辑器内容区上按一个键（与真实按键同样经过 CodeMirror 的 keymap） */
function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  view!.contentDOM.dispatchEvent(event);
  return event;
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("live editor keymap", () => {
  test("Esc with a bare cursor leaves the editor (blurs) and swallows the key", () => {
    const blur = vi.spyOn(mount("hello").contentDOM, "blur");
    const event = press("Escape");

    expect(blur).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    // 只退出输入，不改动文档
    expect(view!.state.doc.toString()).toBe("hello");
  });

  test("Esc with a selection only collapses it; a second Esc leaves the editor", () => {
    const blur = vi.spyOn(mount("hello world", { anchor: 0, head: 5 }).contentDOM, "blur");

    press("Escape");
    expect(blur).not.toHaveBeenCalled();
    expect(view!.state.selection.main.empty).toBe(true);
    expect(view!.state.doc.toString()).toBe("hello world");

    press("Escape");
    expect(blur).toHaveBeenCalledTimes(1);
  });

  test("Esc during IME composition is left to the input method", () => {
    const editor = mount("你好");
    const blur = vi.spyOn(editor.contentDOM, "blur");
    editor.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );

    const event = press("Escape", { isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(blur).not.toHaveBeenCalled();
    editor.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "你好" }),
    );
  });

  test("Tab still indents and Shift+Tab outdents", () => {
    mount("line");

    press("Tab");
    expect(view!.state.doc.toString()).toBe("  line");

    press("Tab", { shiftKey: true });
    expect(view!.state.doc.toString()).toBe("line");
  });

  test("history shortcuts keep working", () => {
    const editor = mount("a");
    editor.dispatch({ changes: { from: 1, insert: "b" } });

    press("z", { ctrlKey: true });
    expect(view!.state.doc.toString()).toBe("a");

    press("y", { ctrlKey: true });
    expect(view!.state.doc.toString()).toBe("ab");
  });

  test("Enter at the end of a list item still continues the list", () => {
    mount("- item", { anchor: 6 });
    press("Enter");
    expect(view!.state.doc.toString()).toBe("- item\n- ");
  });

  test("Backspace right after markup still deletes the whole markup", () => {
    mount("> quote", { anchor: 2 });
    press("Backspace");
    expect(view!.state.doc.toString()).toBe("quote");
  });

  test("font zoom shortcuts still bubble to the window's document listener", () => {
    mount("hello");
    const zoomKeys: string[] = [];
    const onZoomCandidate = (event: KeyboardEvent) => zoomKeys.push(event.key);
    document.addEventListener("keydown", onZoomCandidate);

    try {
      for (const key of ["=", "-", "0"]) {
        expect(press(key, { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press(key, { metaKey: true }).defaultPrevented).toBe(false);
      }
    } finally {
      document.removeEventListener("keydown", onZoomCandidate);
    }

    // 主窗字号缩放（Ctrl/Cmd 与 + / - / 0）挂在 document 的 keydown 上，依赖事件冒泡上去
    expect(zoomKeys).toEqual(["=", "=", "-", "-", "0", "0"]);
    expect(view!.state.doc.toString()).toBe("hello");
  });
});
