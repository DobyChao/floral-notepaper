import { afterEach, describe, expect, test, vi } from "vitest";
import {
  formatHeldKeys,
  hotkeyToConfigString,
  isShortcutRecordingEscape,
  isValidGlobalShortcut,
} from "./shortcutRecorder";

describe("shortcutRecorder", () => {
  test("serializes meta shortcuts into config strings", () => {
    const layeredMetaShortcut = "Meta+Shift+P" as Parameters<typeof hotkeyToConfigString>[0];

    expect(hotkeyToConfigString("Meta+K")).toBe("Meta+K");
    expect(hotkeyToConfigString(layeredMetaShortcut)).toBe("Shift+Meta+P");
  });

  test("serializes mac shortcuts using Command and Option labels", () => {
    const macShortcut = "Meta+Alt+N" as Parameters<typeof hotkeyToConfigString>[0];

    expect(hotkeyToConfigString(macShortcut, "mac")).toBe("Command+Option+N");
  });

  test("resolves Mod alias to Command on macOS, not Ctrl", () => {
    expect(hotkeyToConfigString("Mod+N", "mac")).toBe("Command+N");
    expect(hotkeyToConfigString("Mod+Shift+P", "mac")).toBe("Command+Shift+P");
  });

  test("accepts meta as a valid global shortcut modifier", () => {
    expect(isValidGlobalShortcut("Meta+K")).toBe(true);
    expect(isValidGlobalShortcut("Shift+K")).toBe(false);
  });

  test("formats held meta keys for the recorder UI", () => {
    expect(formatHeldKeys(["Meta", "P"])).toBe("Meta + P");
  });

  test("formats held mac keys with Command before Option", () => {
    expect(formatHeldKeys(["Alt", "Meta", "N"], "mac")).toBe("Command + Option + N");
  });
});

// DOM 下的判定（面板里有录制器 / 事件目标在录制器内）在 SettingsPanel.test.tsx 里覆盖
describe("isShortcutRecordingEscape", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("never claims Esc without a DOM (Node / Vitest)", () => {
    vi.stubGlobal("Element", undefined);

    expect(isShortcutRecordingEscape(null, null)).toBe(false);
    expect(
      isShortcutRecordingEscape(
        { querySelector: () => ({}) } as unknown as ParentNode,
        {} as EventTarget,
      ),
    ).toBe(false);
  });
});
