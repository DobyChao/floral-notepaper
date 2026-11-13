import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { foldEffect, foldedRanges, syntaxTree, unfoldEffect } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { BOUNDARY_CHAR, HIGHLIGHT_PATTERN, INLINE_CHAR } from "../rehypeHighlight";
import {
  BulletWidget,
  CheckboxWidget,
  CodeToolbarWidget,
  HorizontalRuleWidget,
  ImageWidget,
  TableWidget,
} from "./widgets";

export interface LivePreviewOptions {
  /** Maps a markdown image src to a URL usable in an <img> tag. */
  resolveImageSrc: (src: string) => string;
  /** Show 1-based line numbers inside fenced code blocks. */
  showCodeLineNumbers?: boolean;
  /** Highlight the whole markdown block the cursor sits in. */
  activeBlock?: boolean;
  /** Within the active block, give the cursor's own line a stronger tint ("block-line" mode). */
  activeLineInBlock?: boolean;
}

const LIST_LEVEL_INDENT_EM = 1.5;
const activeBlockLine = Decoration.line({ class: "cm-md-active-block" });
// 块内当前行的更强高光（“块+行”模式）。CSS 定义晚于 active-block，同类同优先级时胜出。
const activeBlockCurrentLine = Decoration.line({ class: "cm-md-active-block-line" });
// Block-level nodes whose extent defines "the current block" for highlighting.
const BLOCK_NAMES = new Set([
  "Paragraph",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "FencedCode",
  "Blockquote",
  "ListItem",
  "Table",
  "HorizontalRule",
]);
const hideMark = Decoration.replace({});
const strong = Decoration.mark({ class: "cm-md-strong" });
const em = Decoration.mark({ class: "cm-md-em" });
const strike = Decoration.mark({ class: "cm-md-strike" });
const inlineCode = Decoration.mark({ class: "cm-md-inline-code" });
const linkText = Decoration.mark({ class: "cm-md-link" });
const fenceMark = Decoration.mark({ class: "cm-md-fence-mark" });
const bulletRaw = Decoration.mark({ class: "cm-md-bullet-raw" });
const quoteLine = Decoration.line({ class: "cm-md-quote" });
const tableSourceLine = Decoration.line({ class: "cm-md-table-source" });
const highlight = Decoration.mark({ class: "cm-md-highlight" });
const headingLine = [
  null,
  Decoration.line({ class: "cm-md-h1" }),
  Decoration.line({ class: "cm-md-h2" }),
  Decoration.line({ class: "cm-md-h3" }),
  Decoration.line({ class: "cm-md-h4" }),
  Decoration.line({ class: "cm-md-h5" }),
  Decoration.line({ class: "cm-md-h6" }),
];

function directChildren(node: SyntaxNode): Array<{ name: string; from: number; to: number }> {
  const out: Array<{ name: string; from: number; to: number }> = [];
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      out.push({ name: cursor.name, from: cursor.from, to: cursor.to });
    } while (cursor.nextSibling());
  }
  return out;
}

// ── ==text== 高亮（与预览的 rehypeHighlight 同一套配对规则） ──
// lezer 的 markdown 语法没有这个方言节点，改为按“容器”（段落/标题/行内
// 格式）扫描：结构化子节点里的行内格式节点（可整体落进高亮里）占一个内联
// 占位符，其余节点（行内代码、图片、URL 等）占边界符，子节点之间的缺口
// 直接取原文。两个 == 都完整落在同一段纯文本里才配对；内容首尾不能是空白
// 或 =。光标所在行还原原始语法，行为与标题/强调等行内标记一致。
const HIGHLIGHT_INLINE_NODES = new Set(["Emphasis", "StrongEmphasis", "Strikethrough", "Link"]);
const HIGHLIGHT_CONTAINERS = new Set([
  "Paragraph",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  ...HIGHLIGHT_INLINE_NODES,
]);

interface HighlightPair {
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
}

// 数学公式段（$…$ / $$…$$）lezer 同样不识别，若不处理，公式里的 == 会被
// 误配成高亮（预览里 remark-math 先行、不会）。这里按与 remark-math 对齐的
// 近似规则把公式段整体改写为边界符：行内公式内容不含 $、不跨行、首尾非空白；
// $$…$$ 块公式可跨行。转义过的 \$ 在语法树里是独立的 Escape 节点（边界符），
// 不会进入公式配对。
function maskMathSpans(chars: string[], posAt: Array<number | null>): void {
  const apply = (pattern: RegExp, allow: (content: string) => boolean) => {
    const text = chars.join("");
    for (const match of text.matchAll(pattern)) {
      if (!allow(match[1])) continue;
      const start = match.index ?? 0;
      const end = start + match[0].length;
      for (let i = start; i < end; i++) {
        chars[i] = BOUNDARY_CHAR;
        posAt[i] = null;
      }
    }
  };
  apply(/\$\$([^$\uE000]+?)\$\$/g, () => true);
  apply(/\$([^$\uE000\n]+)\$/g, (content) => content.length > 0 && !/^\s|\s$/.test(content));
}

// 在一个容器节点的行内内容里寻找所有可配对的 == 标记，返回文档区间。
// lezer 树不会为纯文本生成 Text 子节点（纯文本段落甚至是叶子），所以这里
// 用「结构化子节点占位 + 子节点之间的缺口取原文」重建虚拟文本——等价于
// hast 树里的文本节点序列。
function findHighlightPairs(node: SyntaxNode, doc: Text): HighlightPair[] {
  const chars: string[] = [];
  const posAt: Array<number | null> = [];

  const pushText = (from: number, to: number) => {
    if (to <= from) return;
    const value = doc.sliceString(from, to);
    for (let index = 0; index < value.length; index += 1) {
      chars.push(value[index]);
      posAt.push(from + index);
    }
  };

  let cursor = node.from;
  for (const child of directChildren(node)) {
    pushText(cursor, child.from);
    chars.push(HIGHLIGHT_INLINE_NODES.has(child.name) ? INLINE_CHAR : BOUNDARY_CHAR);
    posAt.push(null);
    cursor = child.to;
  }
  pushText(cursor, node.to);
  maskMathSpans(chars, posAt);

  const pairs: HighlightPair[] = [];
  const pattern = new RegExp(HIGHLIGHT_PATTERN.source, "g");
  const text = chars.join("");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const openStart = match.index;
    const closeStart = openStart + match[0].length - 2;
    const openPos = posAt[openStart];
    const openNext = posAt[openStart + 1];
    const closePos = posAt[closeStart];
    const closeNext = posAt[closeStart + 1];
    // 两个 == 都必须完整落在同一段纯文本里（相邻的真实文档位置）
    if (openPos === null || openNext !== openPos + 1) continue;
    if (closePos === null || closeNext !== closePos + 1) continue;
    pairs.push({
      openFrom: openPos,
      openTo: openPos + 2,
      closeFrom: closePos,
      closeTo: closePos + 2,
    });
  }
  return pairs;
}

function buildDecorations(state: EditorState, options: LivePreviewOptions): DecorationSet {
  const { doc } = state;
  if (doc.length === 0) return Decoration.none;
  const decorations: Array<Range<Decoration>> = [];

  // A construct is "active" (show raw source) when any selection range sits on
  // one of the lines it spans — the Typora / Obsidian active-line behaviour.
  const isActive = (from: number, to: number): boolean => {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    for (const range of state.selection.ranges) {
      const a = doc.lineAt(range.from).number;
      const b = doc.lineAt(range.to).number;
      if (a <= endLine && b >= startLine) return true;
    }
    return false;
  };

  const hideWithTrailingSpace = (from: number, to: number) => {
    let end = to;
    if (doc.sliceString(end, end + 1) === " ") end += 1;
    decorations.push(hideMark.range(from, end));
  };

  // Highlight every line of the block the cursor currently sits in. In "block-line"
  // mode also give the cursor's own line a stronger tint inside that block.
  if (options.activeBlock) {
    const pos = state.selection.main.head;
    const cursorLine = doc.lineAt(pos).number;
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0);
    while (node && !BLOCK_NAMES.has(node.name)) node = node.parent;
    // 空行 / 段落间隙没有块级祖先（resolveInner 落到 Document）→ 退而高亮光标当前行，
    // 保证当前行始终被“覆盖”（修“单行不显示高光”）。
    const startLine = node ? doc.lineAt(node.from).number : cursorLine;
    const endLine = node ? doc.lineAt(Math.min(node.to, doc.length)).number : cursorLine;
    for (let l = startLine; l <= endLine; l++) {
      decorations.push(activeBlockLine.range(doc.line(l).from));
      if (options.activeLineInBlock && l === cursorLine) {
        decorations.push(activeBlockCurrentLine.range(doc.line(l).from));
      }
    }
  }

  try {
    syntaxTree(state).iterate({
      enter: (nodeRef) => {
        const { name, from, to } = nodeRef;

        if (HIGHLIGHT_CONTAINERS.has(name)) {
          for (const pair of findHighlightPairs(nodeRef.node, doc)) {
            // 光标落在高亮跨到的行上时还原原始语法（与标题/强调一致）
            if (!isActive(pair.openFrom, pair.closeTo)) {
              decorations.push(highlight.range(pair.openTo, pair.closeFrom));
              decorations.push(hideMark.range(pair.openFrom, pair.openTo));
              decorations.push(hideMark.range(pair.closeFrom, pair.closeTo));
            }
          }
        }

        const headingMatch = /^ATXHeading(\d)$/.exec(name);
        if (headingMatch) {
          const level = Number(headingMatch[1]);
          decorations.push(headingLine[level]!.range(doc.lineAt(from).from));
          if (!isActive(from, to)) {
            for (const mark of directChildren(nodeRef.node)) {
              if (mark.name === "HeaderMark") hideWithTrailingSpace(mark.from, mark.to);
            }
          }
          return undefined;
        }

        if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough") {
          const style = name === "StrongEmphasis" ? strong : name === "Emphasis" ? em : strike;
          decorations.push(style.range(from, to));
          if (!isActive(from, to)) {
            for (const mark of directChildren(nodeRef.node)) {
              if (mark.name === "EmphasisMark" || mark.name === "StrikethroughMark") {
                decorations.push(hideMark.range(mark.from, mark.to));
              }
            }
          }
          return undefined;
        }

        if (name === "InlineCode") {
          decorations.push(inlineCode.range(from, to));
          if (!isActive(from, to)) {
            for (const mark of directChildren(nodeRef.node)) {
              if (mark.name === "CodeMark") decorations.push(hideMark.range(mark.from, mark.to));
            }
          }
          return false;
        }

        if (name === "Link") {
          if (!isActive(from, to)) {
            const marks = directChildren(nodeRef.node).filter((k) => k.name === "LinkMark");
            if (marks.length >= 2) {
              const open = marks[0];
              const close = marks[1];
              if (close.from > open.to) decorations.push(linkText.range(open.to, close.from));
              decorations.push(hideMark.range(open.from, open.to));
              decorations.push(hideMark.range(close.from, to));
            }
          }
          return undefined;
        }

        if (name === "Image") {
          if (!isActive(from, to)) {
            const kids = directChildren(nodeRef.node);
            const urlNode = kids.find((k) => k.name === "URL");
            const marks = kids.filter((k) => k.name === "LinkMark");
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
            const src = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : "";
            if (src) {
              decorations.push(
                Decoration.replace({
                  widget: new ImageWidget(src, alt, options.resolveImageSrc),
                }).range(from, to),
              );
              return false;
            }
          }
          return undefined;
        }

        if (name === "HorizontalRule") {
          if (!isActive(from, to)) {
            decorations.push(
              Decoration.replace({ widget: new HorizontalRuleWidget() }).range(from, to),
            );
          }
          return false;
        }

        if (name === "FencedCode") {
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(to).number;
          for (let l = startLine; l <= endLine; l++) {
            const line = doc.line(l);
            const classes = ["cm-md-code-block"];
            if (l === startLine) classes.push("cm-md-code-block-first");
            if (l === endLine) classes.push("cm-md-code-block-last");
            decorations.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
            // Number only the code content lines, not the ``` fence lines.
            if (options.showCodeLineNumbers && l > startLine && l < endLine) {
              decorations.push(
                Decoration.line({
                  class: "cm-md-code-content",
                  attributes: { "data-ln": String(l - startLine) },
                }).range(line.from),
              );
            }
          }
          // Top-right toolbar (language · copy · fold) anchored on the opening
          // fence line, outside the foldable range so it survives folding.
          const firstLine = doc.line(startLine);
          const kids = directChildren(nodeRef.node);
          const info = kids.find((k) => k.name === "CodeInfo");
          const text = kids.find((k) => k.name === "CodeText");
          const lang = info ? doc.sliceString(info.from, info.to).trim() : "";
          const foldTo = Math.min(to, doc.length);
          const codeFrom = text ? text.from : firstLine.to;
          const codeTo = text ? text.to : foldTo;
          let folded = false;
          foldedRanges(state).between(firstLine.to, foldTo, () => {
            folded = true;
          });
          decorations.push(
            Decoration.widget({
              widget: new CodeToolbarWidget(lang, firstLine.to, foldTo, codeFrom, codeTo, folded),
              side: -1,
            }).range(firstLine.from),
          );
          return undefined;
        }

        if (
          (name === "CodeMark" || name === "CodeInfo") &&
          nodeRef.node.parent?.name === "FencedCode"
        ) {
          decorations.push(fenceMark.range(from, to));
          return undefined;
        }

        if (name === "Blockquote") {
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(to).number;
          for (let l = startLine; l <= endLine; l++) {
            decorations.push(quoteLine.range(doc.line(l).from));
          }
          return undefined;
        }

        if (name === "QuoteMark") {
          // Always collapse the ">" marker (no active-line reveal) so the quote
          // reads as one continuous block and the text never shifts horizontally.
          hideWithTrailingSpace(from, to);
          return undefined;
        }

        if (name === "ListItem") {
          // Normalize indentation: collapse the source's leading whitespace and
          // re-apply a consistent per-depth indent with a hanging indent so
          // wrapped lines align under the text instead of the marker.
          const line = doc.lineAt(from);
          let depth = 0;
          for (let p = nodeRef.node.parent; p; p = p.parent) {
            if (p.name === "BulletList" || p.name === "OrderedList") depth += 1;
          }
          const lineText = doc.sliceString(line.from, line.to);
          const leading = lineText.length - lineText.trimStart().length;
          if (leading > 0) decorations.push(hideMark.range(line.from, line.from + leading));
          const markerEm = 1.4;
          const padLeft = Math.max(0, depth - 1) * LIST_LEVEL_INDENT_EM + markerEm;
          decorations.push(
            Decoration.line({
              attributes: { style: `padding-left:${padLeft}em;text-indent:-${markerEm}em;` },
            }).range(line.from),
          );
          return undefined;
        }

        if (name === "ListMark") {
          // On the active line show the raw marker (-, *, +) for consistency with
          // other elements; otherwise render a round bullet. Both occupy the same
          // fixed width so toggling never shifts the text horizontally.
          if (/^[-*+]$/.test(doc.sliceString(from, to))) {
            if (isActive(from, to)) {
              decorations.push(bulletRaw.range(from, to));
            } else {
              decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
            }
          }
          return undefined;
        }

        if (name === "TaskMarker") {
          if (!isActive(from, to)) {
            const checked = /[xX]/.test(doc.sliceString(from, to));
            decorations.push(
              Decoration.replace({ widget: new CheckboxWidget(checked, from + 1) }).range(from, to),
            );
          }
          return false;
        }

        if (name === "Table") {
          const lineFrom = doc.lineAt(from).from;
          const lineTo = doc.lineAt(to).to;
          if (!isActive(lineFrom, lineTo)) {
            const source = doc.sliceString(lineFrom, lineTo);
            decorations.push(
              Decoration.replace({
                widget: new TableWidget(source, lineFrom),
                block: true,
              }).range(lineFrom, lineTo),
            );
            return false;
          }
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(to).number;
          for (let l = startLine; l <= endLine; l++) {
            decorations.push(tableSourceLine.range(doc.line(l).from));
          }
          return undefined;
        }

        return undefined;
      },
    });
  } catch (error) {
    console.error("[liveEditor] failed to build decorations", error);
    return Decoration.none;
  }

  return Decoration.set(decorations, true);
}

export function livePreview(options: LivePreviewOptions): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, options),
    update: (value, tr) => {
      const foldChanged = tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect));
      if (tr.docChanged || tr.selection || foldChanged) {
        return buildDecorations(tr.state, options);
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
