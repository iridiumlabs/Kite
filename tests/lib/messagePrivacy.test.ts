// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MessageBody } from "../../components/mail/MessageBody";

test("the reader CSP blocks remote CSS images unless the user opted in", () => {
  const html = '<div style="background-image:url(https://tracker/open.png)">Mail</div>';
  const blocked = renderToStaticMarkup(createElement(MessageBody, { content: { html } }));
  expect(blocked).toContain("img-src data:");
  expect(blocked).not.toContain("img-src https:");
  const allowed = renderToStaticMarkup(createElement(MessageBody, { content: { html, loadRemoteImages: true } }));
  expect(allowed).toContain("img-src https: data:");
});
