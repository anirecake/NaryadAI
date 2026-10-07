// Уведомление в Telegram. Вызывается триггером БД на вставку в notifications.
// Приходит коротким: в пуше видно «🚨 Аварийная поломка» и что/до скольки; «Подробнее» разворачивает карточку.
import { admin, cors, isHookCall, json } from "../_shared/common.ts";
import { BOT_TOKEN, tg } from "../_shared/telegram.ts";
import { beforePhotoUrl, compactText, headline, keyboard, loadOrder } from "../_shared/tgui.ts";

// Без звука: то, что не требует действия прямо сейчас
const SILENT = (kind: string, priority: string, role: string) =>
  (kind === "verdict" && role === "worker") || (kind === "new_order" && priority === "planned");

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
  // @ts-ignore: связанная запись
  const role: string = n?.employee?.role ?? "worker";
  if (!n || n.sent_tg_at || !chatId) return json({ skipped: true });

  let res;
  const order = n.order_id ? await loadOrder(n.order_id) : null;
  if (!order) {
    res = await tg("sendMessage", { chat_id: chatId, text: n.text });
  } else {
    const text = compactText(order, headline(n.kind, order, role));
    const common = { chat_id: chatId, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard(order, role) },
      disable_notification: SILENT(n.kind, order.priority, role) };

    // новому наряду прикладываем фото неисправности (мастер загружает его сразу после выдачи)
    let photo: string | null = null;
    if (n.kind === "new_order") {
      for (let i = 0; i < 6 && !photo; i++) {
        photo = await beforePhotoUrl(order.id);
        if (!photo) await new Promise((r) => setTimeout(r, 500));
      }
    }
    res = photo
      ? await tg("sendPhoto", { ...common, photo, caption: text })
      : await tg("sendMessage", { ...common, text, link_preview_options: { is_disabled: true } });
    if (!res.ok && photo) res = await tg("sendMessage", { ...common, text });   // фото не отдалось — шлём без него
  }
  if (res.ok) await admin.from("notifications").update({ sent_tg_at: new Date().toISOString() }).eq("id", n.id);
  return json({ ok: res.ok, error: res.description });
});
