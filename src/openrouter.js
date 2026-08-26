const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.body = body;
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new OpenRouterError(`${name} is required`);
  return value;
}

function parseResponseBody(text) {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function chat({ messages, model = process.env.OPENROUTER_MODEL, responseFormat } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new OpenRouterError("messages must be a non-empty array");
  }
  if (!model?.trim()) throw new OpenRouterError("OPENROUTER_MODEL is required");

  const baseUrl = (process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/u, "");
  const headers = {
    Authorization: `Bearer ${requiredEnv("OPENROUTER_API_KEY")}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME?.trim() || "yukon-kg",
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  if (referer) headers["HTTP-Referer"] = referer;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
    }),
  });
  const body = parseResponseBody(await response.text());
  if (!response.ok) {
    throw new OpenRouterError(`OpenRouter request failed with HTTP ${response.status}`, {
      status: response.status,
      body,
    });
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new OpenRouterError("OpenRouter returned no text content", { body });
  }
  return {
    id: typeof body.id === "string" ? body.id : null,
    model: typeof body.model === "string" ? body.model : model,
    content,
    usage: body.usage ?? null,
  };
}
