import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { EditorView } from "@codemirror/view";
import { getConfig } from "../features/settings/api";
import type { AppConfig } from "../features/settings/types";
import { requestSurfaceAction } from "../features/windows/surfaceActions";
import { getTileContextMenuItems } from "../features/windows/tileContextMenu";
import { focusFirstMenuItem, handleMenuKeyDown } from "./menuKeyboard";
import { POPUP_VIEWPORT_MARGIN, useViewportPopupPosition } from "./popupPosition";

interface MenuState {
  x: number;
  y: number;
  hasSelection: boolean;
  type: "edit" | "tile";
}

const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

/**
 * 把焦点交还给右键菜单的目标可编辑元素。target 可能是 contenteditable 里的子节点
 * （如 CodeMirror 的 span，自身不可聚焦），此时聚焦它所在的可编辑宿主。
 */
function focusEditableTarget(target: HTMLElement | null): void {
  if (!target) return;
  const editableHost = target.closest<HTMLElement>(
    '[contenteditable]:not([contenteditable="false"])',
  );
  (editableHost ?? target).focus();
}

/**
 * 对 CodeMirror（即时视图）执行右键菜单命令：按文档选区读写剪贴板，用事务改文档。
 * 不能沿用 execCommand——菜单打开时焦点已被自动聚焦抢到菜单项上，CodeMirror 失焦后就
 * 不再接管 copy/cut 事件，会退化成按 DOM 选区复制，丢掉即时视图里隐藏的 Markdown 记号；
 * 立刻重新聚焦也来不及（它的选区缓存要到之后的焦点更新才恢复），cut 还会让文档与 DOM 失同步。
 */
async function runViewCommand(view: EditorView, command: string): Promise<void> {
  const { from, to } = view.state.selection.main;
  view.focus();

  switch (command) {
    case "copy":
      if (to > from) await writeText(view.state.sliceDoc(from, to));
      break;
    case "cut":
      if (to > from) {
        await writeText(view.state.sliceDoc(from, to));
        if (!view.state.readOnly) {
          view.dispatch({ changes: { from, to }, userEvent: "delete.cut", scrollIntoView: true });
        }
      }
      break;
    case "paste":
      if (!view.state.readOnly) {
        const text = await readText();
        view.dispatch(view.state.replaceSelection(text), {
          userEvent: "input.paste",
          scrollIntoView: true,
        });
      }
      break;
    case "selectAll":
      view.dispatch({
        selection: { anchor: 0, head: view.state.doc.length },
        userEvent: "select",
      });
      break;
  }
}

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuClosing, setMenuClosing] = useState(false);
  const { popupRef: menuRef, popupPosition: menuPosition } = useViewportPopupPosition(
    menu,
    menu?.type,
  );
  const editableTargetRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLElement | null>(
    null,
  );
  const tileCtrlCloseRef = useRef(true);
  const tileContextMenuItems = useMemo(() => getTileContextMenuItems(t), [t]);

  useEffect(() => {
    getConfig()
      .then((c) => {
        tileCtrlCloseRef.current = c.tileCtrlClose ?? true;
      })
      .catch(() => {});
    const unlisten = listen<AppConfig>("config-changed", (event) => {
      tileCtrlCloseRef.current = event.payload.tileCtrlClose ?? true;
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    function handleContextMenu(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const isEditable =
        target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
      const tileTarget = target.closest<HTMLElement>('[data-context-menu="tile"]');

      if (!isEditable && !tileTarget) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      if (tileTarget && event.ctrlKey && tileCtrlCloseRef.current) {
        requestSurfaceAction("close");
        return;
      }
      let selection = window.getSelection()?.toString() || "";
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        selection = target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
      }

      if (tileTarget) {
        editableTargetRef.current = null;
        setMenuClosing(false);
        setMenu({
          x: event.clientX,
          y: event.clientY,
          hasSelection: false,
          type: "tile",
        });
        return;
      }

      editableTargetRef.current = target;
      setMenuClosing(false);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        hasSelection: selection.length > 0,
        type: "edit",
      });
    }

    function handleClick() {
      setMenuClosing(true);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuClosing(true);
    }

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!menuClosing || !menu) return;
    const timer = window.setTimeout(() => {
      setMenu(null);
      setMenuClosing(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [menuClosing, menu]);

  const dismissMenu = useCallback(() => {
    setMenuClosing(true);
  }, []);

  // Esc 关闭：焦点交还给唤出菜单的可编辑目标（菜单打开时的自动聚焦把焦点抢到了菜单上）
  const cancelMenu = useCallback(() => {
    focusEditableTarget(editableTargetRef.current);
    dismissMenu();
  }, [dismissMenu]);

  // 菜单打开时自动聚焦第一个可用的菜单项
  useEffect(() => {
    if (!menu || menuClosing) return;
    const frame = requestAnimationFrame(() => focusFirstMenuItem(menuRef.current));
    return () => cancelAnimationFrame(frame);
  }, [menu, menuClosing]);

  // 键盘方向键导航与 Esc
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (menuClosing) return;
      if (handleMenuKeyDown(e.currentTarget, e.key, cancelMenu)) e.preventDefault();
    },
    [cancelMenu, menuClosing],
  );

  const runCommand = async (command: string) => {
    const target = editableTargetRef.current;

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? 0;
      const value = target.value;
      const selected = value.slice(start, end);
      const before = value.slice(0, start);
      const after = value.slice(end);

      target.focus();

      const nativeSetter = target instanceof HTMLTextAreaElement ? textareaSetter : inputSetter;
      const setValue = (newValue: string, cursorPos: number) => {
        nativeSetter?.call(target, newValue);
        target.selectionStart = target.selectionEnd = cursorPos;
        target.dispatchEvent(new Event("input", { bubbles: true }));
      };

      switch (command) {
        case "copy":
          if (selected) await writeText(selected);
          break;
        case "cut":
          if (selected) {
            await writeText(selected);
            setValue(before + after, start);
          }
          break;
        case "paste": {
          const text = await readText();
          setValue(before + text + after, start + text.length);
          break;
        }
        case "selectAll":
          target.select();
          break;
      }
    } else {
      // 编辑器在菜单打开期间被卸载（如切换笔记）时不再走它的命令
      const view = target instanceof HTMLElement ? EditorView.findFromDOM(target) : null;
      if (view?.dom.isConnected) {
        await runViewCommand(view, command);
      } else {
        focusEditableTarget(target);
        document.execCommand(command);
      }
    }

    dismissMenu();
  };

  const runSurfaceAction = (action: (typeof tileContextMenuItems)[number]["action"]) => {
    requestSurfaceAction(action);
    dismissMenu();
  };

  const items = useMemo(
    () =>
      menu
        ? menu.type === "tile"
          ? tileContextMenuItems.map((item) => ({
              ...item,
              shortcut: "",
              action: () => runSurfaceAction(item.action),
              disabled: false,
            }))
          : [
              {
                label: t("contextMenu.edit.cut", { defaultValue: "剪切" }),
                shortcut: "Ctrl+X",
                action: () => runCommand("cut"),
                disabled: !menu.hasSelection,
              },
              {
                label: t("contextMenu.edit.copy", { defaultValue: "复制" }),
                shortcut: "Ctrl+C",
                action: () => runCommand("copy"),
                disabled: !menu.hasSelection,
              },
              {
                label: t("contextMenu.edit.paste", { defaultValue: "粘贴" }),
                shortcut: "Ctrl+V",
                action: () => runCommand("paste"),
                disabled: false,
              },
              { separator: true as const },
              {
                label: t("contextMenu.edit.selectAll", { defaultValue: "全选" }),
                shortcut: "Ctrl+A",
                action: () => runCommand("selectAll"),
                disabled: false,
              },
            ]
        : [],
    [menu, runCommand, t, tileContextMenuItems],
  );

  return (
    <>
      {children}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className={`fixed z-[9999] min-w-[152px] py-1.5 bg-cloud/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-x-hidden overflow-y-auto select-none ${menuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{
            left: menuPosition?.x ?? menu.x,
            top: menuPosition?.y ?? menu.y,
            maxWidth: `calc(100vw - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
            maxHeight: `calc(100vh - ${POPUP_VIEWPORT_MARGIN * 2}px)`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {items.map((item, index) =>
            "separator" in item ? (
              <div key={index} className="mx-2 my-1 h-px bg-paper-deep/40" />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => void item.action()}
                disabled={item.disabled}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] font-body transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bamboo/50 disabled:text-ink-ghost/40 disabled:cursor-default disabled:hover:bg-transparent ${
                  "tone" in item && item.tone === "danger"
                    ? "text-red-400 hover:bg-danger-bg hover:text-red-500"
                    : "text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo"
                }`}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="text-[10px] text-ink-ghost/60 font-mono ml-6">
                    {item.shortcut}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
