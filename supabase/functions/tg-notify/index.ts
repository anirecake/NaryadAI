// Уведомление в Telegram. Вызывается триггером БД на вставку в notifications.
// Наряд приходит карточкой: оформление, фото неисправности, кнопки следующего шага под роль.
import { admin, cors, isHookCall, json } from "../_shared/common.ts";
import { BOT_TOKEN, tg } from "../_shared/telegram.ts";
import { beforePhotoUrl, esc, keyboard, loadOrder, orderText } from "../_shared/tgui.ts";

// Заголовок карточки по виду уведомления
const HEADLINE: Record<string, (role: string) => string | undefined> = {
  new_order: () => undefined,
  remind: () => "⏰ Скоро срок",
  overdue: () => "❗ Наряд просрочен",
  manager_overdue: () => "⚠️ Долгая просрочка",
  accept_timeout: () => "⌛ Исполнитель не принял наряд",
  rejected: () => "✖ Исполнитель отклонил наряд — нужно переназначить",
  rework: () => "↩ Наряд возвращён на доработку",
  verdict: (role) => role === "worker" ? "🤖 Оценка ИИ" : "🤖 ИИ проверил наряд",
};

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
    // пояснение из уведомления (причина возврата, вердикт, кандидат на замену) — под карточкой
    const note = n.kind === "new_order" ? undefined : `<i>${esc(n.text.replace(/^[^\wА-Яа-яЁё№]+/u, ""))}</i>`;
    const text = orderText(order, HEADLINE[n.kind]?.(role), note);
    const markup = { inline_keyboard: keyboard(order, role) };

    // новому наряду прикладываем фото неисправности (мастер загружает его сразу после выдачи)
    let photo: string | null = null;
    if (n.kind === "new_order") {
      for (let i = 0; i < 6 && !photo; i++) {
        photo = await beforePhotoUrl(order.id);
        if (!photo) await new Promise((r) => setTimeout(r, 500));
      }
    }
    res = photo
      ? await tg("sendPhoto", { chat_id: chatId, photo, caption: text.slice(0, 1024), parse_mode: "HTML", reply_markup: markup })
      : await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: markup, link_preview_options: { is_disabled: true } });
    if (!res.ok && photo) {   // фото не отдалось — шлём без него
      res = await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: markup });
    }
  }
  if (res.ok) await admin.from("notifications").update({ sent_tg_at: new Date().toISOString() }).eq("id", n.id);
  return json({ ok: res.ok, error: res.description });
});
