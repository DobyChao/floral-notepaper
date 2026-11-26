import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Esc：有选区时先由 defaultKeymap 的 simplifySelection 收起选区（同一按键的绑定按顺序
 * 尝试，前一个返回 false 才轮到下一个）；只剩单个光标时退出输入，把焦点交还给页面。
 * 输入法组合中的 Esc 是在取消候选，不处理，照常交给输入法。
 */
function blurOnEscape(view: EditorView): boolean {
  if (view.compositionStarted) return false;
  view.contentDOM.blur();
  return true;
}

export const liveEditorKeymap = keymap.of([
  ...markdownKeymap,
  indentWithTab,
  ...defaultKeymap,
  { key: "Escape", run: blurOnEscape },
  ...historyKeymap,
]);
