// Отправка уведомления в Telegram. Вызывается триггером БД на вставку в notifications.
// Новый наряд исполнителю приходит с кнопками «Принять» / «В очередь».
import { admin, APP_URL, cors, isHookCall, json } from "../_shared/common.ts";
import { BOT_TOKEN, tg } from "../_shared/telegram.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await isHookCall(req))) return json({ error: "forbidden" }, 403);
  if (!BOT_TOKEN) return json({ skipped: "no TELEGRAM_BOT_TOKEN" });

  const { notification_id } = await req.json();
  const { data: n } = await admin.from("notifications")
    .select("id, kind, text, order_id, sent_tg_at, employee:employees(telegram_chat_id, role)")
    .eq("id", notification_id).single();
  // @ts-ignore: связанная запись
  const chatId = n?.employee?.telegram_chat_id;
  if (!n || n.sent_tg_at || !chatId) return json({ skipped: true });

  const buttons: { text: string; callback_data?: string; url?: string }[][] = [];
  // @ts-ignore: связанная запись
  if (n.kind === "new_order" && n.employee?.role === "worker" && n.order_id) {
    buttons.push([
      { text: "✅ Принять", callback_data: `a:${n.order_id}:accept` },
      { text: "⏳ В очередь", callback_data: `a:${n.order_id}:queue` },
    ]);
  }
  if (n.order_id) buttons.push([{ text: "Открыть наряд", url: `${APP_URL}/order/${n.order_id}` }]);

  const res = await tg("sendMessage", {
    chat_id: chatId,
    text: n.text,
    disable_notification: false,
    reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
  });
  if (res.ok) await admin.from("notifications").update({ sent_tg_at: new Date().toISOString() }).eq("id", n.id);
  return json({ ok: res.ok });
});
