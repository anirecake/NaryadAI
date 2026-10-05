// Вебхук Telegram-бота: привязка аккаунта по коду (/start <код>) и кнопки действий по наряду.
// verify_jwt выключен: Telegram не шлёт JWT, вместо этого проверяется секрет вебхука.
import { admin, json } from "../_shared/common.ts";
import { BOT_TOKEN, tg, webhookSecret } from "../_shared/telegram.ts";

const ACTION_RU: Record<string, string> = { accept: "Принят в работу", queue: "Поставлен в очередь" };

Deno.serve(async (req) => {
  if (!BOT_TOKEN) return json({ ok: false });
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret())) {
    return json({ error: "forbidden" }, 403);
  }
  const update = await req.json();

  // /start <код> — привязка Telegram к сотруднику
  const msg = update.message;
  if (msg?.text?.startsWith("/start")) {
    const code = msg.text.split(" ")[1]?.trim();
    const { data: link } = code
      ? await admin.from("telegram_links").select("employee_id, employees(full_name)").eq("code", code).maybeSingle()
      : { data: null };
    if (!link) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Откройте приложение НарядAI → «Подключить Telegram», чтобы получить ссылку." });
    } else {
      await admin.from("employees").update({ telegram_chat_id: null }).eq("telegram_chat_id", msg.chat.id);
      await admin.from("employees").update({ telegram_chat_id: msg.chat.id }).eq("id", link.employee_id);
      await admin.from("telegram_links").delete().eq("code", code);
      // @ts-ignore: связанная запись
      await tg("sendMessage", { chat_id: msg.chat.id, text: `✅ Подключено: ${link.employees?.full_name}. Наряды будут приходить сюда.` });
    }
    return json({ ok: true });
  }

  // Кнопка «Принять» / «В очередь» под нарядом
  const cb = update.callback_query;
  if (cb?.data?.startsWith("a:")) {
    const [, orderId, action] = cb.data.split(":");
    const { data: emp } = await admin.from("employees").select("id").eq("telegram_chat_id", cb.from.id).maybeSingle();
    let answer = "Аккаунт не привязан";
    if (emp) {
      const { error } = await admin.rpc("act_as", { p_actor: emp.id, p_order_id: Number(orderId), p_action: action });
      answer = error ? `Не выполнено: ${error.message}` : ACTION_RU[action] ?? "Готово";
      if (!error) {
        await tg("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
        await tg("sendMessage", { chat_id: cb.message.chat.id, reply_to_message_id: cb.message.message_id, text: `✔ ${answer}` });
      }
    }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: answer });
  }
  return json({ ok: true });
});
