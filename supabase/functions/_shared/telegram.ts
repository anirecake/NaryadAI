// Telegram Bot API — push-уведомления исполнителям и мастерам (п. 9.2 ТЗ разрешает бота)
export const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

export async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Секрет вебхука выводится из токена: Telegram присылает его в заголовке каждого апдейта
export async function webhookSecret(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`narad:${BOT_TOKEN}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}
