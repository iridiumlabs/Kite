import { expect, test } from "vitest";
import { readerNavigationOptions } from "../../lib/ui/readerNavigation";

test("pointer reader navigation crossfades without scrolling the page", () => {
  expect(readerNavigationOptions("pointer")).toEqual({ scroll: false, transitionTypes: ["mail-reader"] });
});

test.each(["keyboard", null])("keyboard and initial navigation stay instant (%s)", input => {
  expect(readerNavigationOptions(input)).toEqual({ scroll: false, transitionTypes: [] });
});
