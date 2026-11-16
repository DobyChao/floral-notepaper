import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("MarkdownPreview", () => {
  test("marks rendered Markdown content as selectable", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="# 花笺\n\n正文" />);

    expect(markup).toContain("markdown-selectable");
    expect(markup).toContain("<h1");
    expect(markup).toContain("花笺");
    expect(markup).toContain("正文");
  });

  test("renders ==highlight== as a themed mark element", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="前 ==重点== 后" />);

    expect(markup).toContain('<mark class="markdown-highlight">重点</mark>');
  });

  test("renders ==highlight== alongside raw <mark> in the HTML pipeline", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"==重点== 与 <mark>原生</mark>"} renderHtml />,
    );

    expect(markup).toContain('<mark class="markdown-highlight">重点</mark>');
    expect(markup).toContain("<mark>原生</mark>");
  });

  test("keeps ==highlight== markers literal inside code blocks", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content={"```text\n==x==\n```"} />);

    expect(markup).not.toContain("markdown-highlight");
    expect(markup).toContain("==x==");
  });

  test("keeps ==highlight== markers literal inside inline math", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="$==x==$" />);

    expect(markup).not.toContain("markdown-highlight");
  });

  test("keeps comparison and empty markers as plain text", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content={"a == b\n\n===="} />);

    expect(markup).not.toContain("markdown-highlight");
    expect(markup).toContain("a == b");
    expect(markup).toContain("====");
  });

  test("keeps bold inside a highlight", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="==重点 **加粗**==" />);

    // strong 组件自带字体样式类，只断言嵌套顺序与 mark 类名
    expect(markup).toContain('<mark class="markdown-highlight">重点 <strong');
    expect(markup).toContain("加粗</strong></mark>");
  });

  test("keeps code block controls outside the horizontally scrollable pre", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```text\nvery long code line\n```"} />,
    );

    const preCloseIndex = markup.indexOf("</pre>");
    const buttonIndex = markup.indexOf("<button");

    expect(markup).toContain("markdown-code-block");
    expect(markup).toContain("markdown-code-scroll");
    expect(preCloseIndex).toBeGreaterThan(-1);
    expect(buttonIndex).toBeGreaterThan(preCloseIndex);
  });

  test("renders the unified code toolbar with wrap on by default", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content={"```js\nconst a = 1;\n```"} />);

    // 与即时模式同款工具栏（语言 · 复制 · 折叠）
    expect(markup).toContain("cm-md-code-toolbar");
    expect(markup).toContain("cm-md-code-lang");
    expect(markup).toContain("js");
    // 默认开启自动换行
    expect(markup).toContain("whitespace-pre-wrap");
    expect(markup).not.toContain("overflow-x-auto");
  });

  test("makes code blocks scroll horizontally when codeWrap is off", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```js\nconst a = 1;\n```"} codeWrap={false} />,
    );

    expect(markup).toContain("overflow-x-auto");
    expect(markup).not.toContain("whitespace-pre-wrap");
  });

  test.each([false, true])("recognizes Mermaid fences with renderHtml=%s", (renderHtml) => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```mermaid\ngraph TD\nA --> B\n```"} renderHtml={renderHtml} />,
    );
    expect(markup).toContain("markdown-mermaid");
    expect(markup).toContain("A --&gt; B");
    expect(markup).toContain("复制");
  });

  test.each(["```js\ngraph TD\n```", "```\ngraph TD\n```", "`mermaid`"])(
    "keeps ordinary and inline code unchanged: %s",
    (content) => {
      const markup = renderToStaticMarkup(<MarkdownPreview content={content} />);
      expect(markup).not.toContain("markdown-mermaid");
      expect(markup).toContain("<code");
    },
  );

  test("renders file links with their href preserved for navigation", () => {
    // react-markdown 会把 href 中的非 ASCII 字符百分号编码，
    // 预览点击侧再由 classifyMarkdownLink 解码
    const markup = renderToStaticMarkup(
      <MarkdownPreview content="[周报](./周报.md#概述)\n\n[官网](https://example.com)" />,
    );

    expect(markup).toContain('href="./%E5%91%A8%E6%8A%A5.md#%E6%A6%82%E8%BF%B0"');
    expect(markup).toContain('href="https://example.com"');
  });

  test("keeps file url hrefs that react-markdown would blank out by default", () => {
    const content = "[笔记](file:///D:/docs/笔记.md)";
    for (const renderHtml of [false, true]) {
      const markup = renderToStaticMarkup(
        <MarkdownPreview content={content} renderHtml={renderHtml} />,
      );
      expect(markup).toContain('href="file:///D:/docs/%E7%AC%94%E8%AE%B0.md"');
    }
  });
});
