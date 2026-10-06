// Подключение Telegram-бота: регистрирует вебхук и сохраняет имя бота для ссылок привязки.
// Вызывает мастер или администратор из приложения (кнопка в настройках).
import { admin, callerEmployee, cors, json, SUPABASE_URL } from "../_shared/common.ts";
import { BOT_TOKEN, tg, webhookSecret } from "../_shared/telegram.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const me = await callerEmployee(req);
  if (!me || !["master", "admin", "manager"].includes(me.role)) return json({ error: "forbidden" }, 403);
  if (!BOT_TOKEN) return json({ ok: false, reason: "no_token" });

  const bot = await tg("getMe", {});
  if (!bot.ok) return json({ ok: false, reason: "bad_token" });
  const hook = await tg("setWebhook", {
    url: `${SUPABASE_URL}/functions/v1/tg-webhook`,
    secret_token: await webhookSecret(),
    allowed_updates: ["message", "callback_query"],
  });
  // меню команд и описание бота
  await tg("setMyCommands", { commands: [
    { command: "my", description: "Мои открытые наряды" },
    { command: "help", description: "Как пользоваться ботом" },
  ] });
  await tg("setMyDescription", { description: "НарядAI — наряды смены: новые наряды с кнопками «Принять», напоминания о сроках, оценки ИИ. Подключение: приложение → Настройки → Подключить Telegram." });
  await tg("setMyShortDescription", { short_description: "Наряд выдан — ИИ на контроле" });
  await admin.from("app_config").upsert({ key: "bot_username", value: bot.result.username });
  return json({ ok: hook.ok, bot: bot.result.username });
});
