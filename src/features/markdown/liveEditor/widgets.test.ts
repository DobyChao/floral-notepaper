import { describe, expect, test } from "vitest";
import { parseTable } from "./widgets";

describe("parseTable", () => {
  test("parses header, alignment row and body rows", () => {
    const model = parseTable("| A | B | C |\n| --- | :--- | ---: |\n| 1 | 2 | 3 |");

    expect(model).not.toBeNull();
    expect(model!.header).toEqual(["A", "B", "C"]);
    expect(model!.aligns).toEqual([null, "left", "right"]);
    expect(model!.rows).toEqual([["1", "2", "3"]]);
  });

  test("recognizes centered columns", () => {
    const model = parseTable("| A |\n| :---: |\n| x |");

    expect(model!.aligns).toEqual(["center"]);
  });

  test("keeps escaped pipes inside cells (backslash retained, no extra split)", () => {
    const model = parseTable("| a\\|b | c |\n| --- | --- |\n| 1 | 2 |");

    expect(model!.header).toEqual(["a\\|b", "c"]);
    expect(model!.rows).toEqual([["1", "2"]]);
  });

  test("trims cell content and tolerates missing edge pipes", () => {
    const model = parseTable("A | B\n--- | ---\n 1 | 2 ");

    expect(model!.header).toEqual(["A", "B"]);
    expect(model!.rows).toEqual([["1", "2"]]);
  });

  test("keeps short body rows as-is (rendering pads to header width)", () => {
    const model = parseTable("| A | B | C |\n| --- | --- | --- |\n| only-first |");

    expect(model!.rows[0]).toEqual(["only-first"]);
  });

  test("returns null for non-table sources", () => {
    expect(parseTable("just text")).toBeNull();
    expect(parseTable("")).toBeNull();
  });
});
