// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { handleMenuKeyDown } from "./menuKeyboard";

function buildMenu(buttons: Array<{ label: string; disabled?: boolean }>) {
  const menu = document.createElement("div");
  for (const { label, disabled } of buttons) {
    const button = document.createElement("button");
    button.textContent = label;
    if (disabled) button.disabled = true;
    menu.append(button);
  }
  document.body.append(menu);
  return menu;
}

const focusedLabel = () => document.activeElement?.textContent;

afterEach(() => {
  document.body.replaceChildren();
});

describe("menu keyboard", () => {
  test("ArrowDown / ArrowUp move focus between enabled items and stop at the ends", () => {
    const menu = buildMenu([
      { label: "剪切", disabled: true },
      { label: "复制", disabled: true },
      { label: "粘贴" },
      { label: "全选" },
    ]);

    expect(handleMenuKeyDown(menu, "ArrowDown", () => {})).toBe(true);
    // 焦点原本不在任何菜单项上：落到首个可用项，跳过禁用项
    expect(focusedLabel()).toBe("粘贴");

    handleMenuKeyDown(menu, "ArrowDown", () => {});
    expect(focusedLabel()).toBe("全选");

    handleMenuKeyDown(menu, "ArrowDown", () => {});
    expect(focusedLabel()).toBe("全选");

    handleMenuKeyDown(menu, "ArrowUp", () => {});
    expect(focusedLabel()).toBe("粘贴");

    handleMenuKeyDown(menu, "ArrowUp", () => {});
    expect(focusedLabel()).toBe("粘贴");
  });

  test("ArrowUp from outside the menu also lands on the first enabled item", () => {
    const menu = buildMenu([{ label: "重命名" }, { label: "删除分类" }]);

    handleMenuKeyDown(menu, "ArrowUp", () => {});

    expect(focusedLabel()).toBe("重命名");
  });

  test("Escape closes the menu without moving focus", () => {
    const menu = buildMenu([{ label: "导出" }, { label: "删除" }]);
    const close = vi.fn();
    handleMenuKeyDown(menu, "ArrowDown", close);
    const focused = document.activeElement;

    expect(handleMenuKeyDown(menu, "Escape", close)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(focused);
  });

  test("other keys are left to their default behavior", () => {
    const menu = buildMenu([{ label: "导出" }]);
    const close = vi.fn();

    expect(handleMenuKeyDown(menu, "Enter", close)).toBe(false);
    expect(handleMenuKeyDown(menu, "Tab", close)).toBe(false);
    expect(handleMenuKeyDown(menu, "a", close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(menu.firstElementChild);
  });

  test("an all-disabled menu is a no-op for the arrow keys", () => {
    const menu = buildMenu([{ label: "剪切", disabled: true }]);

    expect(handleMenuKeyDown(menu, "ArrowDown", () => {})).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });
});
