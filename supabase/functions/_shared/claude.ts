// Обёртка над Claude API для ИИ-модулей НарядAI.
// Без ANTHROPIC_API_KEY функции работают в режиме правил (ask* возвращают null).
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
const client = apiKey ? new Anthropic({ apiKey }) : null;

export const aiEnabled = client !== null;
export const MODEL = "claude-opus-5-5";

type Content = string | Anthropic.Beta.BetaContentBlockParam[];

interface AskOptions {
  system: string;
  content: Content;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

// Общие параметры: fallbacks "default" — при отказе классификатора запрос
// автоматически выполняет рекомендованная модель вместо возврата отказа.
function request(opts: AskOptions, extra: Record<string, unknown> = {}) {
  return client!.beta.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    ...extra,
    output_config: { effort: opts.effort ?? "low", ...(extra.output_config as object ?? {}) },
  } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
}

function textOf(res: Anthropic.Beta.BetaMessage): string | null {
  if (res.stop_reason === "refusal") return null;
  const block = res.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : null;
}

// Ответ строго по JSON-схеме (structured outputs)
export async function askJson<T>(opts: AskOptions & { schema: Record<string, unknown> }): Promise<T | null> {
  if (!client) return null;
  try {
    const res = await request(opts, { output_config: { format: { type: "json_schema", schema: opts.schema } } });
    const text = textOf(res);
    return text ? JSON.parse(text) as T : null;
  } catch (e) {
    console.error("Claude askJson:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return null;
  }
}

// Свободный текст (сводки, ответы ассистента)
export async function askText(opts: AskOptions): Promise<string | null> {
  if (!client) return null;
  try {
    return textOf(await request(opts));
  } catch (e) {
    console.error("Claude askText:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return null;
  }
}

export function imageBlock(base64: string, mediaType = "image/jpeg"): Anthropic.Beta.BetaContentBlockParam {
  return { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: base64 } };
}
