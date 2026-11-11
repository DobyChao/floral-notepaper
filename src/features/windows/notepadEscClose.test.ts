import { describe, expect, test } from "vitest";
import { shouldCloseOnEsc } from "./notepadEscClose";

describe("notepad esc close policy", () => {
  test("closes the quick notepad on Esc when enabled in pad mode", () => {
    expect(shouldCloseOnEsc({ enabled: true, surfaceMode: "pad", editExpanded: false })).toBe(true);
  });

  test("does not close when the setting is turned off", () => {
    expect(shouldCloseOnEsc({ enabled: false, surfaceMode: "pad", editExpanded: false })).toBe(
      false,
    );
  });

  test("does not close tile mode even when enabled", () => {
    expect(shouldCloseOnEsc({ enabled: true, surfaceMode: "tile", editExpanded: false })).toBe(
      false,
    );
  });

  test("does not close a pad surface expanded from tile editing", () => {
    expect(shouldCloseOnEsc({ enabled: true, surfaceMode: "pad", editExpanded: true })).toBe(false);
    expect(shouldCloseOnEsc({ enabled: false, surfaceMode: "pad", editExpanded: true })).toBe(
      false,
    );
  });
});
