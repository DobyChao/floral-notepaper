import { afterEach, describe, expect, test, vi } from "vitest";
import {
  FONT_ZOOM_DEFAULT,
  FONT_ZOOM_MAX,
  FONT_ZOOM_MIN,
  FONT_ZOOM_STEP,
  clampFontSize,
  getFontZoomDirection,
  isFontZoomEventTargetBlocked,
  nextFontSize,
} from "./fontZoom";

const keyEvent = (
  overrides: Partial<Parameters<typeof getFontZoomDirection>[0]>,
): Parameters<typeof getFontZoomDirection>[0] => ({
  altKey: false,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  key: "",
  code: "",
  ...overrides,
});

describe("fontZoom", () => {
  test("detects Obsidian-style zoom-in shortcuts", () => {
    expect(getFontZoomDirection(keyEvent({ key: "=", code: "Equal" }))).toBe("in");
    expect(getFontZoomDirection(keyEvent({ key: "+", code: "Equal" }))).toBe("in");
    expect(getFontZoomDirection(keyEvent({ key: "+", code: "NumpadAdd" }))).toBe("in");
    expect(getFontZoomDirection(keyEvent({ ctrlKey: false, metaKey: true, key: "=" }))).toBe("in");
  });

  test("detects zoom-out shortcuts", () => {
    expect(getFontZoomDirection(keyEvent({ key: "-", code: "Minus" }))).toBe("out");
    expect(getFontZoomDirection(keyEvent({ key: "-", code: "NumpadSubtract" }))).toBe("out");
  });

  test("requires a primary modifier and ignores alt-layered shortcuts", () => {
    expect(getFontZoomDirection(keyEvent({ ctrlKey: false, key: "=", code: "Equal" }))).toBeNull();
    expect(getFontZoomDirection(keyEvent({ altKey: true, key: "=", code: "Equal" }))).toBeNull();
  });

  test("steps font sizes inside the configured bounds", () => {
    expect(nextFontSize(14, "in")).toBe(15);
    expect(nextFontSize(14, "out")).toBe(13);
    expect(nextFontSize(FONT_ZOOM_MAX, "in")).toBe(FONT_ZOOM_MAX);
    expect(nextFontSize(FONT_ZOOM_MIN, "out")).toBe(FONT_ZOOM_MIN);
  });

  test("accepts the numpad zoom keys", () => {
    expect(getFontZoomDirection(keyEvent({ key: "Add", code: "NumpadAdd" }))).toBe("in");
    expect(getFontZoomDirection(keyEvent({ key: "Subtract", code: "NumpadSubtract" }))).toBe("out");
  });

  test("accepts the shifted + key as zoom-in", () => {
    expect(getFontZoomDirection(keyEvent({ key: "+", code: "Equal", shiftKey: true }))).toBe("in");
  });

  test("ignores alt-layered zoom-out and reset shortcuts", () => {
    expect(getFontZoomDirection(keyEvent({ altKey: true, key: "-", code: "Minus" }))).toBeNull();
    expect(getFontZoomDirection(keyEvent({ altKey: true, key: "0", code: "Digit0" }))).toBeNull();
    expect(
      getFontZoomDirection(
        keyEvent({ ctrlKey: false, metaKey: true, altKey: true, key: "0", code: "Digit0" }),
      ),
    ).toBeNull();
  });

  test("detects reset shortcuts", () => {
    expect(getFontZoomDirection(keyEvent({ key: "0", code: "Digit0" }))).toBe("reset");
    expect(
      getFontZoomDirection(keyEvent({ ctrlKey: false, metaKey: true, key: "0", code: "Digit0" })),
    ).toBe("reset");
    expect(getFontZoomDirection(keyEvent({ key: "0", code: "Numpad0" }))).toBe("reset");
  });

  test("does not reset without a primary modifier or with shift held", () => {
    expect(getFontZoomDirection(keyEvent({ ctrlKey: false, key: "0", code: "Digit0" }))).toBeNull();
    expect(getFontZoomDirection(keyEvent({ shiftKey: true, key: ")", code: "Digit0" }))).toBeNull();
    expect(
      getFontZoomDirection(keyEvent({ shiftKey: true, key: "0", code: "Numpad0" })),
    ).toBeNull();
  });

  test("resets the font size to the default", () => {
    expect(FONT_ZOOM_DEFAULT).toBe(14);
    expect(nextFontSize(22, "reset")).toBe(FONT_ZOOM_DEFAULT);
    expect(nextFontSize(FONT_ZOOM_DEFAULT, "reset")).toBe(FONT_ZOOM_DEFAULT);
    expect(nextFontSize(5, "reset")).toBe(FONT_ZOOM_DEFAULT);
  });

  test("keeps the step and bounds in sync with the settings panel sliders", () => {
    expect(FONT_ZOOM_MIN).toBe(8);
    expect(FONT_ZOOM_MAX).toBe(30);
    expect(FONT_ZOOM_STEP).toBe(1);
    expect(nextFontSize(29, "in")).toBe(30);
    expect(nextFontSize(9, "out")).toBe(8);
  });

  test("clamps out-of-range and invalid sizes", () => {
    expect(clampFontSize(40)).toBe(FONT_ZOOM_MAX);
    expect(clampFontSize(1)).toBe(FONT_ZOOM_MIN);
    expect(clampFontSize(14.6)).toBe(15);
    expect(clampFontSize(Number.NaN)).toBe(FONT_ZOOM_DEFAULT);
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(FONT_ZOOM_DEFAULT);
    expect(nextFontSize(Number.NaN, "in")).toBe(15);
    expect(nextFontSize(100, "in")).toBe(FONT_ZOOM_MAX);
    expect(nextFontSize(1, "out")).toBe(FONT_ZOOM_MIN);
  });
});

// 无 DOM 环境下的最小替身：closest 沿 parent 向上找「正在录制」的祖先。
// 选择器与 SettingsPanel 里 ShortcutRecorder 容器上的 data 属性保持一致
const RECORDING_SELECTOR = '[data-shortcut-recorder-recording="true"]';

class FakeElement {
  parent: FakeElement | null;
  recording: boolean;

  constructor(parent: FakeElement | null = null, recording = false) {
    this.parent = parent;
    this.recording = recording;
  }

  closest(selector: string): FakeElement | null {
    if (selector !== RECORDING_SELECTOR) return null;
    if (this.recording) return this;
    return this.parent?.closest(selector) ?? null;
  }
}

const asTarget = (element: FakeElement | null): EventTarget => element as unknown as EventTarget;

describe("isFontZoomEventTargetBlocked", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("never blocks without a DOM (Node / Vitest)", () => {
    vi.stubGlobal("HTMLElement", undefined);

    expect(isFontZoomEventTargetBlocked(null)).toBe(false);
    expect(isFontZoomEventTargetBlocked(asTarget(new FakeElement(null, true)))).toBe(false);
  });

  test("blocks zoom while a shortcut is being recorded", () => {
    vi.stubGlobal("HTMLElement", FakeElement);
    const recorder = new FakeElement(null, true);

    expect(isFontZoomEventTargetBlocked(asTarget(recorder))).toBe(true);
    expect(isFontZoomEventTargetBlocked(asTarget(new FakeElement(new FakeElement(recorder))))).toBe(
      true,
    );
  });

  test("does not block once recording has stopped", () => {
    vi.stubGlobal("HTMLElement", FakeElement);
    const recorder = new FakeElement(null, false);

    expect(isFontZoomEventTargetBlocked(asTarget(new FakeElement(recorder)))).toBe(false);
    expect(isFontZoomEventTargetBlocked(asTarget(new FakeElement()))).toBe(false);
  });

  test("ignores null and non-element targets", () => {
    vi.stubGlobal("HTMLElement", FakeElement);

    expect(isFontZoomEventTargetBlocked(null)).toBe(false);
    expect(
      isFontZoomEventTargetBlocked({
        closest: () => new FakeElement(null, true),
      } as unknown as EventTarget),
    ).toBe(false);
  });
});
