import { describe, expect, test, vi } from "vitest";
import { callJev, JevError } from "../../convex/lib/jev";

const OK_BODY = {
  model: "jev-1.13.0",
  answers: {
    inbox: { type: "choice", choice: "primary", confidence: 0.78 },
  },
  usage: {},
};

function mockFetch(impl: (...args: unknown[]) => unknown) {
  return vi.fn(impl) as unknown as typeof fetch;
}

async function errOf(p: Promise<unknown>): Promise<JevError> {
  return (await p.catch((e) => e)) as JevError;
}

describe("callJev", () => {
  test("posts to the Jev endpoint with bearer auth and model", async () => {
    const f = mockFetch(async () => new Response(JSON.stringify(OK_BODY)));
    const res = await callJev<typeof OK_BODY>(
      { state: {}, questions: [] },
      { apiKey: "k", model: "jev-latest", fetchImpl: f },
    );
    expect(res).toEqual(OK_BODY);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.experientiallabs.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer k",
    );
    expect(JSON.parse(init.body as string).model).toBe("jev-latest");
  });

  test("http errors throw typed JevError with status", async () => {
    const f = mockFetch(async () => new Response("nope", { status: 429 }));
    const err = await errOf(callJev({}, { apiKey: "k", fetchImpl: f }));
    expect(err).toBeInstanceOf(JevError);
    expect(err.kind).toBe("http");
    expect(err.status).toBe(429);
  });

  test("network failure throws kind network", async () => {
    const f = mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await errOf(callJev({}, { apiKey: "k", fetchImpl: f }));
    expect(err).toBeInstanceOf(JevError);
    expect(err.kind).toBe("network");
  });

  test("invalid JSON throws kind bad_response", async () => {
    const f = mockFetch(async () => new Response("not json"));
    const err = await errOf(callJev({}, { apiKey: "k", fetchImpl: f }));
    expect(err.kind).toBe("bad_response");
  });

  test("timeout abort throws kind timeout", async () => {
    const f = mockFetch(async () => {
      const e = new Error("aborted");
      e.name = "TimeoutError";
      throw e;
    });
    const err = await errOf(callJev({}, { apiKey: "k", fetchImpl: f }));
    expect(err.kind).toBe("timeout");
  });
});
