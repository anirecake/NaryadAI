// Вебхук Telegram-бота НарядAI.
//   /start <код> — привязка к сотруднику; /my — мои наряды; /help — подсказка.
//   Кнопки под карточкой наряда: исполнитель проходит цикл (принять → начать → пауза),
//   мастер подтверждает проверенный наряд и переназначает по подсказке ИИ.
// verify_jwt выключен: Telegram не шлёт JWT, вместо этого проверяется секрет вебхука.
import { admin, APP_URL, json } from "../_shared/common.ts";
import { BOT_TOKEN, tg, webhookSecret } from "../_shared/telegram.ts";
import { candidatesKeyboard, esc, keyboard, loadOrder, orderText, REASONS, type TgOrder } from "../_shared/tgui.ts";

const DONE_TOAST: Record<string, string> = {
  accept: "✅ Принят в работу", queue: "⏳ Поставлен в очередь", start: "▶ Исполнение начато",
  pause: "⏸ Пауза", reject: "✖ Отклонён — мастер получит уведомление", approve: "✔ Наряд закрыт",
};

const HELP = `<b>НарядAI — бот смены</b>
Сюда приходят наряды и напоминания. Кнопки под нарядом:
• <b>Принять / В очередь / Отклонить</b> — новый наряд
• <b>Начать</b>, <b>Пауза</b> — по ходу работы
• <b>Закрыть наряд</b> — откроет приложение: работы, материалы, фото
Мастеру: <b>Подтвердить</b> проверенный ИИ наряд и <b>Переназначить</b>.

/my — мои открытые наряды
/help — эта подсказка`;

async function employeeByChat(chatId: number) {
  const { data } = await admin.from("employees").select("id, full_name, role, active").eq("telegram_chat_id", chatId).maybeSingle();
  return data?.active ? data : null;
}

// Обновить карточку на месте (текст или подпись к фото)
async function refresh(msg: { chat: { id: number }; message_id: number; photo?: unknown }, o: TgOrder, role: string, headline?: string, markup?: unknown) {
  const text = orderText(o, headline)
  const reply_markup = markup ?? { inline_keyboard: keyboard(o, role) };
  if (msg.photo) {
    return tg("editMessageCaption", { chat_id: msg.chat.id, message_id: msg.message_id, caption: text.slice(0, 1024), parse_mode: "HTML", reply_markup });
  }
  return tg("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text, parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } });
}

async function myOrders(chatId: number, emp: { id: string; role: string }) {
  const open = ["issued", "accepted", "queued", "in_progress", "paused", "rework", "done", "ai_review", "rejected"];
  const q = admin.from("orders").select("id").in("status", open).order("due_at").limit(5);
  const { data } = emp.role === "worker" ? await q.eq("assignee_id", emp.id) : await q.or(`is_overdue.eq.true,status.in.(rejected,ai_review)`);
  if (!data?.length) {
    return tg("sendMessage", { chat_id: chatId, text: emp.role === "worker" ? "Открытых нарядов нет 👍" : "Срочных вопросов нет: просрочек, отказов и нарядов на подтверждение нет 👍" });
  }
  await tg("sendMessage", { chat_id: chatId, text: emp.role === "worker" ? `Ваши открытые наряды (${data.length}):` : `Требуют внимания (${data.length}):` });
  for (const row of data) {
    const o = await loadOrder(row.id);
    if (o) await tg("sendMessage", { chat_id: chatId, text: orderText(o), parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard(o, emp.role) }, link_preview_options: { is_disabled: true } });
  }
}

Deno.serve(async (req) => {
  if (!BOT_TOKEN) return json({ ok: false });
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret())) {
    return json({ error: "forbidden" }, 403);
  }
  const update = await req.json();

  // ───── команды ─────
  const msg = update.message;
  if (msg?.text) {
    const [cmd, arg] = msg.text.trim().split(/\s+/);
    if (cmd === "/start" && arg) {
      const { data: link } = await admin.from("telegram_links").select("employee_id, employees(full_name, role)").eq("code", arg).maybeSingle();
      if (!link) {
        await tg("sendMessage", { chat_id: msg.chat.id, text: "Ссылка устарела. Откройте приложение НарядAI → «Настройки» → «Подключить Telegram» ещё раз." });
      } else {
        await admin.from("employees").update({ telegram_chat_id: null }).eq("telegram_chat_id", msg.chat.id);
        await admin.from("employees").update({ telegram_chat_id: msg.chat.id }).eq("id", link.employee_id);
        await admin.from("telegram_links").delete().eq("code", arg);
        // @ts-ignore: связанная запись
        await tg("sendMessage", { chat_id: msg.chat.id, parse_mode: "HTML", text: `✅ Подключено: <b>${esc(link.employees?.full_name)}</b>.\n\n${HELP}` });
      }
      return json({ ok: true });
    }
    const emp = await employeeByChat(msg.chat.id);
    if (!emp) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Telegram ещё не привязан. Откройте приложение НарядAI → «Настройки» → «Подключить Telegram»." });
      return json({ ok: true });
    }
    if (cmd === "/my") await myOrders(msg.chat.id, emp);
    else await tg("sendMessage", { chat_id: msg.chat.id, text: HELP, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "📱 Открыть приложение", url: APP_URL }]] } });
    return json({ ok: true });
  }

  // ───── кнопки ─────
  const cb = update.callback_query;
  if (!cb?.data || !cb.message) return json({ ok: true });
  const emp = await employeeByChat(cb.from.id);
  if (!emp) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Telegram не привязан к сотруднику", show_alert: true });
    return json({ ok: true });
  }
  const [kind, idStr, extra] = cb.data.split(":");
  const o = await loadOrder(Number(idStr));
  if (!o) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Наряд не найден" });
    return json({ ok: true });
  }

  let toast = "";
  let error = "";
  if (kind === "R") {                                   // показать причины отказа / паузы
    const action = extra === "pause" ? "pause" : "reject";
    await refresh(cb.message, o, emp.role, action === "pause" ? "Почему пауза?" : "Почему отклоняете?", {
      inline_keyboard: [...REASONS[action].map((r, i) => [{ text: r, callback_data: `${action === "pause" ? "p" : "j"}:${o.id}:${i}` }]),
        [{ text: "← Назад", callback_data: `k:${o.id}` }]],
    });
  } else if (kind === "k") {                            // назад к обычным кнопкам
    await refresh(cb.message, o, emp.role);
  } else if (kind === "r") {                            // мастер: выбрать, кому переназначить
    await refresh(cb.message, o, emp.role, "Кому передать? ИИ предлагает:", { inline_keyboard: await candidatesKeyboard(o) });
  } else {
    let r;
    if (kind === "a" || kind === "m") r = await admin.rpc("act_as", { p_actor: emp.id, p_order_id: o.id, p_action: extra });
    else if (kind === "j" || kind === "p") {
      const action = kind === "j" ? "reject" : "pause";
      r = await admin.rpc("act_as", { p_actor: emp.id, p_order_id: o.id, p_action: action, p_reason: REASONS[action][Number(extra)] });
      toast = DONE_TOAST[action];
    } else if (kind === "rc") {
      r = await admin.rpc("reassign_as", { p_actor: emp.id, p_order_id: o.id, p_assignee: extra });
      toast = "🔁 Переназначено — новый исполнитель получил наряд";
    }
    if (r?.error) error = r.error.message;
    else toast ||= DONE_TOAST[extra] ?? "Готово";
    const fresh = await loadOrder(o.id);
    if (fresh) await refresh(cb.message, fresh, emp.role, error ? undefined : toast);
  }
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: error ? `Не выполнено: ${error}` : toast || undefined, show_alert: Boolean(error) });
  return json({ ok: true });
});
