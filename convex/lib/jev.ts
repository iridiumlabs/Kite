const JEV_URL = "https://api.experientiallabs.ai/v1/systemone";

export type JevErrorKind = "http" | "timeout" | "network" | "bad_response";

export class JevError extends Error {
  constructor(
    public kind: JevErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export interface CallJevOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// Single attempt, no retries. The caller decides between retry and the
// heuristic fallback.
export async function callJev<T = unknown>(
  body: Record<string, unknown>,
  options: CallJevOptions,
): Promise<T> {
  const { apiKey, model, timeoutMs = 15000, fetchImpl = fetch } = options;
  const payload = model ? { ...body, model } : body;

  let res: Response;
  try {
    res = await fetchImpl(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new JevError(
      isTimeout ? "timeout" : "network",
      isTimeout ? "Jev request timed out" : `Jev request failed: ${err}`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new JevError(
      "http",
      `Jev returned ${res.status}: ${text.slice(0, 300)}`,
      res.status,
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new JevError("bad_response", "Jev returned invalid JSON");
  }
}
