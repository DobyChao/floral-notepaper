// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { isShortcutRecordingEscape } from "../features/settings/shortcutRecorder";
import type { AppConfig } from "../features/settings/types";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
  convertFileSrc: (path: string) => path,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// 更新设置区自身的开关结构由 UpdateSettingsSection.test.tsx 覆盖，这里换成占位
vi.mock("../features/update/UpdateSettingsSection", () => ({
  UpdateSettingsSection: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const config: AppConfig = {
  locale: "zh-CN",
  dataDir: "/home/user/.floral",
  globalShortcut: "Control+Alt+N",
  closeToTray: true,
  autostart: false,
  defaultViewMode: "split",
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

const noop = () => {};

function renderPanel(overrides: Partial<AppConfig> = {}) {
  return renderToStaticMarkup(
    <SettingsPanel
      config={{ ...config, ...overrides }}
      onChange={noop}
      onMigrateDataDir={noop}
      onClose={noop}
    />,
  );
}

const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1] ?? "";

describe("SettingsPanel structure", () => {
  test("toggles are full-row switch buttons, not hidden checkboxes", () => {
    const markup = renderPanel();

    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain("sr-only");

    const switches = markup.match(/<button[^>]*role="switch"[^>]*>/g) ?? [];
    // 设置面板里的全部开关（常规设置 14 项 + 快捷键相关 3 项）
    expect(switches).toHaveLength(17);
    for (const tag of switches) {
      expect(tag).toMatch(/aria-checked="(true|false)"/);
      expect(classOf(tag)).toContain("w-full");
      expect(classOf(tag)).toContain("text-left");
    }
    // 状态随配置走，滑块对辅助技术隐藏
    expect(markup.match(/aria-checked="false"/g)).toHaveLength(6);
    expect(markup.match(/aria-hidden="true"/g)).toHaveLength(17);
    expect(renderPanel({ closeToTray: false }).match(/aria-checked="false"/g)).toHaveLength(7);
  });

  test("keeps the header fixed while only the content area scrolls", () => {
    const markup = renderPanel();

    expect(markup).toContain(
      '<aside class="w-[360px] h-full shrink-0 border-l border-paper-deep/30 bg-cloud/92 backdrop-blur-sm flex flex-col">',
    );
    expect(markup).toContain("flex-1 overflow-y-auto scrollbar-hidden px-4 py-4 space-y-5");
    // 标题栏在滚动容器之外，且不参与收缩
    const header = markup.indexOf(
      "flex items-center justify-between h-11 px-4 border-b border-paper-deep/25 shrink-0",
    );
    const scroller = markup.indexOf("flex-1 overflow-y-auto scrollbar-hidden px-4 py-4 space-y-5");
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(scroller);
  });

  test("every focusable control has a visible keyboard focus ring", () => {
    const markup = renderPanel();

    const controls = markup.match(/<(?:button|input|a)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(30);
    const withoutRing = controls
      // 滑块自身只有轨道那几像素高，焦点环画在它所在的整行上（见下一条断言）
      .filter((tag) => !tag.includes('type="range"'))
      .filter((tag) => !classOf(tag).includes("focus-visible:ring-bamboo/50"));
    expect(withoutRing).toEqual([]);

    const sliders = controls.filter((tag) => tag.includes('type="range"'));
    expect(sliders.length).toBeGreaterThan(0);
    expect(markup.match(/has-\[:focus-visible\]:ring-bamboo\/50/g)).toHaveLength(sliders.length);
  });
});

describe("SettingsPanel keyboard behavior", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: Mock<() => void>;
  let onChange: Mock<(config: AppConfig) => void>;

  async function mountPanel() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SettingsPanel
          config={config}
          onChange={onChange}
          onMigrateDataDir={noop}
          onClose={onClose}
        />,
      );
    });
  }

  const panel = () => container.querySelector<HTMLElement>("aside")!;
  // 标题栏的关闭按钮是面板里的第一个控件
  const closeButton = () => panel().querySelector<HTMLButtonElement>("button")!;
  const switches = () => Array.from(panel().querySelectorAll<HTMLButtonElement>('[role="switch"]'));
  const recorders = () =>
    Array.from(panel().querySelectorAll<HTMLButtonElement>("button")).filter((button) =>
      button.textContent?.includes("点击录制"),
    );
  const recordingRecorder = () =>
    panel().querySelector('[data-shortcut-recorder-recording="true"]');

  const startRecording = async () => {
    act(() => recorders()[0].click());
    await act(async () => {});
    expect(recordingRecorder()).not.toBeNull();
  };

  function pressEscape(target: EventTarget, isComposing = false) {
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
          isComposing,
        }),
      );
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onClose = vi.fn<() => void>();
    onChange = vi.fn<(config: AppConfig) => void>();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  test("moves focus to its first control shortly after opening", async () => {
    await mountPanel();
    expect(document.activeElement).toBe(document.body);

    act(() => vi.advanceTimersByTime(60));

    expect(document.activeElement).toBe(closeButton());
  });

  test("does not steal focus when closed before the delay elapses", async () => {
    await mountPanel();
    await act(async () => root.unmount());

    act(() => vi.advanceTimersByTime(60));

    expect(document.activeElement).toBe(document.body);
  });

  test("Esc closes the panel", async () => {
    await mountPanel();
    act(() => vi.advanceTimersByTime(60));

    pressEscape(closeButton());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Esc during IME composition is left to the input method", async () => {
    await mountPanel();
    act(() => vi.advanceTimersByTime(60));

    pressEscape(closeButton(), true);

    expect(onClose).not.toHaveBeenCalled();
  });

  test("Esc while recording a shortcut only cancels the recording", async () => {
    await mountPanel();
    act(() => vi.advanceTimersByTime(60));
    await startRecording();

    // 焦点在录制器之外（自动聚焦落在关闭按钮上）：面板里有录制器在录，Esc 只取消录制
    pressEscape(closeButton());

    expect(onClose).not.toHaveBeenCalled();
    expect(recordingRecorder()).toBeNull();

    // 焦点在录制器内部：同理
    await startRecording();
    act(() => recorders()[0].focus());
    pressEscape(recorders()[0]);

    expect(onClose).not.toHaveBeenCalled();
    expect(recordingRecorder()).toBeNull();

    // 录制结束后，Esc 才恢复为关闭面板
    pressEscape(document.activeElement!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("switches report their state and toggle on activation", async () => {
    await mountPanel();
    const closeToTray = switches()[0];
    const autostart = switches()[1];

    // Enter / Space 在按钮上最终都表现为一次 click
    act(() => closeToTray.click());
    expect(onChange).toHaveBeenLastCalledWith({ ...config, closeToTray: false });

    act(() => autostart.click());
    expect(onChange).toHaveBeenLastCalledWith({ ...config, autostart: true });
  });
});

describe("isShortcutRecordingEscape", () => {
  const build = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.append(root);
    return root;
  };

  afterEach(() => {
    document.body.replaceChildren();
  });

  test("claims Esc anywhere in the panel while one of its recorders is recording", () => {
    const panel = build(
      '<button id="close">关闭</button><div data-shortcut-recorder-recording="true"><button id="record">录制</button></div>',
    );

    expect(isShortcutRecordingEscape(panel, panel.querySelector("#close"))).toBe(true);
    expect(isShortcutRecordingEscape(panel, panel.querySelector("#record"))).toBe(true);
    expect(isShortcutRecordingEscape(panel, null)).toBe(true);
  });

  test("leaves Esc alone when nothing is recording", () => {
    const panel = build(
      '<button id="close">关闭</button><div data-shortcut-recorder-recording><button>录制</button></div>',
    );

    expect(isShortcutRecordingEscape(panel, panel.querySelector("#close"))).toBe(false);
  });

  test("a recorder outside the panel still claims the Esc pressed inside it", () => {
    const panel = build('<button id="close">关闭</button>');
    const recorder = build(
      '<div data-shortcut-recorder-recording="true"><button id="record">录制</button></div>',
    );

    expect(isShortcutRecordingEscape(panel, recorder.querySelector("#record"))).toBe(true);
    expect(isShortcutRecordingEscape(null, recorder.querySelector("#record"))).toBe(true);
    expect(isShortcutRecordingEscape(panel, panel.querySelector("#close"))).toBe(false);
  });
});
