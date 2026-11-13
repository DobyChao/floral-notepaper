// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { EditorState, type StateField } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview, type LivePreviewOptions } from "./livePreview";

function viewFor(
  doc: string,
  options: LivePreviewOptions,
  anchor = doc.length,
): { view: EditorView; field: StateField<DecorationSet>; deco: DecorationSet } {
  // livePreview 的返回类型声明为 Extension（上游签名），此处作为字段读取需收窄
  const field = livePreview(options) as StateField<DecorationSet>;
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), field, EditorView.editable.of(false)],
      selection: { anchor },
    }),
    parent: document.body,
  });
  // 字段在 state 创建时用「尚未解析」的语法树建过一次装饰；确保解析完成后
  // dispatch 一次 selection（livePreview 的 update 触发条件）让它重建，
  // 这与真实编辑器里用户首次移动光标时的行为一致
  ensureSyntaxTree(view.state, doc.length, 1000);
  view.dispatch({ selection: { anchor } });
  return { view, field, deco: view.state.field(field) as DecorationSet };
}

interface DecoEntry {
  from: number;
  to: number;
  spec: {
    class?: string;
    widget?: { constructor: { name: string } };
    block?: boolean;
  };
}

function allDecos(deco: DecorationSet): DecoEntry[] {
  const out: DecoEntry[] = [];
  deco.between(0, 1_000_000, (from, to, value) => {
    out.push({ from, to, spec: value.spec as DecoEntry["spec"] });
  });
  return out;
}

function classNames(deco: DecorationSet): string[] {
  return allDecos(deco)
    .flatMap((d) => (d.spec.class ?? "").split(/\s+/))
    .filter(Boolean);
}

function hasReplaceCovering(deco: DecorationSet, from: number, to: number): boolean {
  // 隐藏记号的 replace 装饰：无 class、无 widget、区间精确覆盖
  return allDecos(deco).some(
    (d) => d.from === from && d.to === to && !d.spec.class && !d.spec.widget && !d.spec.block,
  );
}

function widgetNames(deco: DecorationSet): string[] {
  return allDecos(deco).flatMap((d) => (d.spec.widget ? [d.spec.widget.constructor.name] : []));
}

function hasMarkClass(deco: DecorationSet, cls: string, from: number, to: number): boolean {
  return allDecos(deco).some((d) => d.spec.class === cls && d.from === from && d.to === to);
}

describe("livePreview decorations", () => {
  test("styles heading lines and hides the leading marks when the cursor is elsewhere", () => {
    // 光标停在末尾“正文段落”行
    const { view, deco } = viewFor("# 标题\n\n正文段落", { resolveImageSrc: (s) => s });

    expect(classNames(deco)).toContain("cm-md-h1");
    // “# ”记号 + 后随空格被隐藏（replace 装饰 0..2）
    expect(hasReplaceCovering(deco, 0, 2)).toBe(true);
    view.destroy();
  });

  test("reveals heading marks on the cursor's own line", () => {
    // 光标放在标题行内
    const { view, deco } = viewFor("# 标题\n\n正文", { resolveImageSrc: (s) => s }, 2);

    expect(hasReplaceCovering(deco, 0, 2)).toBe(false);
    view.destroy();
  });

  test("applies emphasis classes to bold and italic text", () => {
    const { view, deco } = viewFor("**加粗** 和 *斜体*", { resolveImageSrc: (s) => s });

    const classes = classNames(deco);
    expect(classes).toContain("cm-md-strong");
    expect(classes).toContain("cm-md-em");
    view.destroy();
  });

  test("styles fenced code lines and attaches the toolbar widget", () => {
    const doc = "```js\nconst a = 1;\nconst b = 2;\n```";
    const { view, deco } = viewFor(doc, { resolveImageSrc: (s) => s });

    const classes = classNames(deco);
    expect(classes).toContain("cm-md-code-block");
    expect(classes).toContain("cm-md-code-block-first");
    expect(classes).toContain("cm-md-code-block-last");
    expect(widgetNames(deco)).toContain("CodeToolbarWidget");
    view.destroy();
  });

  test("numbers code content lines only when showCodeLineNumbers is on", () => {
    const doc = "```js\nconst a = 1;\n```";
    const withNumbers = viewFor(doc, { resolveImageSrc: (s) => s, showCodeLineNumbers: true });
    expect(classNames(withNumbers.deco)).toContain("cm-md-code-content");
    withNumbers.view.destroy();

    const withoutNumbers = viewFor(doc, { resolveImageSrc: (s) => s });
    expect(classNames(withoutNumbers.deco)).not.toContain("cm-md-code-content");
    withoutNumbers.view.destroy();
  });

  test("replaces an inactive table with a block widget", () => {
    // 光标在表格之外的末行
    const doc = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n后记";
    const { view, deco } = viewFor(doc, { resolveImageSrc: (s) => s });

    expect(widgetNames(deco)).toContain("TableWidget");
    view.destroy();
  });

  test("keeps the table as source lines while the cursor is inside it", () => {
    const doc = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n后记";
    const { view, deco } = viewFor(doc, { resolveImageSrc: (s) => s }, 3);

    expect(classNames(deco)).toContain("cm-md-table-source");
    expect(widgetNames(deco)).not.toContain("TableWidget");
    view.destroy();
  });

  test("highlights the active block lines in block mode", () => {
    const doc = "第一段\n继续行\n\n第二段";
    // 光标放在首段内部（两行同属一个 Paragraph 块）
    const { view, deco } = viewFor(doc, { resolveImageSrc: (s) => s, activeBlock: true }, 2);

    const activeLines = allDecos(deco)
      .filter((d) => (d.spec as { class?: string }).class === "cm-md-active-block")
      .map((d) => view.state.doc.lineAt(d.from).number)
      .sort();
    expect(activeLines).toEqual([1, 2]);
    view.destroy();
  });

  test("styles blockquote lines", () => {
    const { view, deco } = viewFor("> 引用内容", { resolveImageSrc: (s) => s });

    expect(classNames(deco)).toContain("cm-md-quote");
    view.destroy();
  });

  // ── ==text== 高亮 ──
  test("highlights ==text== and hides the markers when the cursor is elsewhere", () => {
    // 光标停在末行
    const doc = "==重点==\n\n正文";
    const { view, deco } = viewFor(doc, { resolveImageSrc: (s) => s });

    // 内容区间 [2,4) 有高亮，两段 == 记号（0..2 / 4..6）被隐藏
    expect(hasMarkClass(deco, "cm-md-highlight", 2, 4)).toBe(true);
    expect(hasReplaceCovering(deco, 0, 2)).toBe(true);
    expect(hasReplaceCovering(deco, 4, 6)).toBe(true);
    view.destroy();
  });

  test("reveals the raw ==markers== on the cursor's own line", () => {
    const doc = "==重点==\n\n正文";
    // 光标放进高亮所在行
    const { view, deco } = viewFor(doc, { resolveImageSrc: (s) => s }, 3);

    expect(classNames(deco)).not.toContain("cm-md-highlight");
    expect(hasReplaceCovering(deco, 0, 2)).toBe(false);
    view.destroy();
  });

  test("keeps comparison and empty markers unstyled", () => {
    const doc = "a == b\n\n====";
    const { view, deco } = viewFor(doc, { resolveImageSrc: (s) => s });

    expect(classNames(deco)).not.toContain("cm-md-highlight");
    view.destroy();
  });

  test("highlights a span across wrapped lines and reveals it when the cursor joins", () => {
    // 同一段落内的两行被一对 == 包住；光标先在末段
    const doc = "==第一行\n第二行==\n\n后文";
    const away = viewFor(doc, { resolveImageSrc: (s) => s });
    expect(classNames(away.deco)).toContain("cm-md-highlight");
    away.view.destroy();

    // 光标进入高亮跨到的行：还原原始语法
    const inside = viewFor(doc, { resolveImageSrc: (s) => s }, 2);
    expect(classNames(inside.deco)).not.toContain("cm-md-highlight");
    inside.view.destroy();
  });

  test.each([
    ["行内代码", "行内代码 `==x==`"],
    ["代码块", "```text\n==x==\n```"],
    ["行内公式", "$==x==$ 后文"],
    ["块公式", "$$\n==x==\n$$"],
  ])("keeps == inside %s literal", (_name, docText) => {
    const { view, deco } = viewFor(docText, { resolveImageSrc: (s) => s });

    expect(classNames(deco)).not.toContain("cm-md-highlight");
    view.destroy();
  });

  test("keeps a lone $ from suppressing a later highlight", () => {
    const doc = "价格 $5 与 ==重点==\n\n后文";
    const { view, deco } = viewFor(doc, { resolveImageSrc: (s) => s });

    expect(classNames(deco)).toContain("cm-md-highlight");
    view.destroy();
  });

  test("keeps bold inside a highlight and vice versa", () => {
    const outer = viewFor("==a **b** c==\n\n后文", { resolveImageSrc: (s) => s });
    const outerClasses = classNames(outer.deco);
    expect(outerClasses).toContain("cm-md-highlight");
    expect(outerClasses).toContain("cm-md-strong");
    outer.view.destroy();

    const inner = viewFor("**==b==**\n\n后文", { resolveImageSrc: (s) => s });
    const innerClasses = classNames(inner.deco);
    expect(innerClasses).toContain("cm-md-highlight");
    expect(innerClasses).toContain("cm-md-strong");
    inner.view.destroy();
  });

  test("highlights inside headings and links", () => {
    const heading = viewFor("# ==标题==\n\n后文", { resolveImageSrc: (s) => s });
    const headingClasses = classNames(heading.deco);
    expect(headingClasses).toContain("cm-md-h1");
    expect(headingClasses).toContain("cm-md-highlight");
    heading.view.destroy();

    const link = viewFor("[==链接==](https://example.com)\n\n后文", { resolveImageSrc: (s) => s });
    expect(classNames(link.deco)).toContain("cm-md-highlight");
    link.view.destroy();
  });
});
