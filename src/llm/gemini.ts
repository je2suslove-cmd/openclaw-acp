type GeminiCallOpts = {
  systemInstruction?: string;
  model?: string;
  timeoutMs?: number;
  retries?: number;
  maxInputChars?: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickTextFromResponse(json: any): string {
  const t =
    json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text)
      .filter(Boolean)
      .join("") ?? "";
  return String(t || "").trim();
}

function toAsciiSafe(s: string): string {
  // ASCII 범위(0-127)만 허용 — 헤더 ByteString 오류 방지
  return s.replace(/[^\x00-\x7F]/g, "").trim();
}

export async function geminiGenerate(userText: string, opts: GeminiCallOpts = {}): Promise<string> {
  const rawKey = process.env.GEMINI_API_KEY ?? "";
  const apiKey = toAsciiSafe(rawKey);
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set or contains invalid characters");

  const model = toAsciiSafe(opts.model ?? process.env.GEMINI_MODEL ?? "gemini-2.0-flash");
  const timeoutMs = Number(opts.timeoutMs ?? process.env.GEMINI_TIMEOUT_MS ?? 25000);
  const retries = Number(opts.retries ?? 2);
  const maxInputChars = Number(opts.maxInputChars ?? 6000);

  const input = (userText ?? "").toString().slice(0, maxInputChars);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const payload: any = {
    contents: [{ role: "user", parts: [{ text: input }] }],
  };

  if (opts.systemInstruction?.trim()) {
    payload.system_instruction = { parts: [{ text: opts.systemInstruction.trim() }] };
  }

  let lastErr: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await res.text();
      const json = text ? JSON.parse(text) : {};

      if (!res.ok) {
        const status = res.status;
        if ((status === 429 || status === 503 || status === 502) && attempt < retries) {
          await sleep(600 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(json?.error?.message || `Gemini HTTP ${status}`);
      }

      return pickTextFromResponse(json) || "(empty response)";
    } catch (e: any) {
      lastErr = e;
      if (e?.name !== "AbortError" && attempt < retries) {
        await sleep(600 * Math.pow(2, attempt));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr ?? new Error("Unknown Gemini error");
}
