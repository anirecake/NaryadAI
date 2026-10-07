// Карточка наряда для Telegram: оформление и кнопки под роль и статус.
// Один формат и для новых уведомлений (tg-notify), и для обновления после нажатия кнопки (tg-webhook).
// Сообщение приходит коротким (в пуше видно «🚨 Аварийная поломка» и что/до скольки),
// кнопка «Подробнее» разворачивает полную карточку в том же сообщении.
import { admin, APP_URL } from "./common.ts";

export const ORDER_FIELDS = `id, number, type, priority, status, description, due_at, started_at, equipment_id, is_overdue, rework_count, last_comment,
  assignee_id, master_id, equipment(name), sites(name),
  assignee:employees!orders_assignee_id_fkey(full_name, specialty), master:employees!orders_master_id_fkey(full_name)`;

// deno-lint-ignore no-explicit-any
export type TgOrder = any;
type Button = { text: string; callback_data?: string; url?: string };

const STATUS: Record<string, string> = {
  issued: "🆕 Выдан", accepted: "👍 Принят", queued: "⏳ В очереди", rejected: "✖ Отклонён", in_progress: "🔧 В работе",
  paused: "⏸ На паузе", done: "🤖 На проверке ИИ", ai_review: "🤖 Проверен ИИ — ждёт мастера", rework: "↩ На доработке",
  closed: "✅ Закрыт", cancelled: "🚫 Отменён",
};
const PRIORITY: Record<string, string> = { emergency: "🚨 АВАРИЙНЫЙ", high: "🔶 Высокий", normal: "Обычный", planned: "📅 Плановый" };
const VERDICT: Record<string, string> = {
  accepted: "принято", accepted_with_remarks: "принято с замечаниями", rework: "требует доработки", needs_master_review: "нужна проверка мастером",
};

export const REASONS = {
  reject: ["Нет материалов", "Нет допуска", "Занят аварийным нарядом"],
  pause: ["Ждёт запчасти", "Ждёт остановки оборудования", "Ждёт допуска"],
};

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (full?: string) => { if (!full) return "—"; const [a, b] = full.split(" "); return b ? `${a} ${b[0]}.` : a; };
const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qostanay" });
const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60 ? `${m % 60} мин` : ""}`.trim() : `${m} мин`;
const minsLeft = (o: TgOrder) => Math.round((new Date(o.due_at).getTime() - Date.now()) / 60000);
const isOpen = (o: TgOrder) => !["done", "ai_review", "closed", "cancelled"].includes(o.status);

export async function loadOrder(id: number): Promise<TgOrder | null> {
  const { data } = await admin.from("orders").select(ORDER_FIELDS).eq("id", id).single();
  if (!data) return null;
  const { data: rev } = await admin.from("ai_reviews").select("verdict, score, master_score, explanation")
    .eq("order_id", id).order("created_at", { ascending: false }).limit(1);
  return { ...data, review: rev?.[0] ?? null };
}

// ───── Заголовок: первая строка сообщения, её и видно в пуше ─────
export function headline(kind: string, o: TgOrder, role: string): string {
  const score = o.review ? `${o.review.master_score ?? o.review.score}/5` : "";
  switch (kind) {
    case "new_order":
      return o.priority === "emergency" ? "🚨 Аварийная поломка"
        : o.priority === "high" ? "🔶 Срочный наряд"
        : o.priority === "planned" ? "📅 Плановая работа" : "🛠 Новый наряд";
    case "remind": return `⏰ Через ${fmtMin(Math.max(minsLeft(o), 1))} срок`;
    case "overdue": return "❗ Наряд просрочен";
    case "manager_overdue": return "⚠️ Долгая просрочка";
    case "accept_timeout": return "⌛ Наряд никто не принял";
    case "rejected": return "✖ Исполнитель отказался";
    case "rework": return "↩ Вернули на доработку";
    case "verdict":
      return role === "worker" ? `🤖 Ваша оценка: ${score}`
        : `🤖 ИИ: ${VERDICT[o.review?.verdict] ?? "проверено"}${score ? `, ${score}` : ""}`;
    default: return statusHeadline(o);
  }
}

// Заголовок «по текущему состоянию» — когда повод уведомления уже неизвестен
export function statusHeadline(o: TgOrder) {
  const s = STATUS[o.status] ?? o.status;
  return o.priority === "emergency" && isOpen(o) ? `🚨 Авария · ${s.replace(/^\S+\s/, "")}` : s;
}

// Вторая строка: что и до скольки
function subline(o: TgOrder) {
  const what = `${esc(o.equipment?.name)} · ${esc(o.sites?.name)}`;
  if (!isOpen(o)) return what;
  const m = minsLeft(o);
  return `${what} · ${m < 0 ? `<b>просрочен на ${fmtMin(-m)}</b>` : `до ${time(o.due_at)}`}`;
}

// Короткая версия: заголовок + одна строка
export function compactText(o: TgOrder, head: string) {
  return `<b>${esc(head)}</b>\n${subline(o)}`;
}

// Полная версия: всё о наряде
export function orderText(o: TgOrder, head?: string) {
  const m = minsLeft(o);
  const due = isOpen(o)
    ? `⏰ Срок: <b>${time(o.due_at)}</b> — ${m < 0 ? `<b>просрочен на ${fmtMin(-m)}</b>` : `через ${fmtMin(m)}`}` : "";
  const r = o.review;
  const lines = [
    head ? `<b>${esc(head)}</b>` : "",
    `${o.priority === "emergency" ? "🚨" : "🛠"} Наряд №${o.number} · ${PRIORITY[o.priority] ?? o.priority}`,
    `🏭 <b>${esc(o.equipment?.name)}</b> · ${esc(o.sites?.name)}`,
    `📝 ${esc(o.description)}`,
    due,
    o.assignee ? `👷 Исполнитель: ${esc(short(o.assignee.full_name))}` : "",
    `Статус: <b>${STATUS[o.status] ?? o.status}</b>${o.rework_count ? ` · доработок: ${o.rework_count}` : ""}`,
    o.last_comment && ["paused", "rejected", "rework"].includes(o.status) ? `💬 ${esc(o.last_comment)}` : "",
    r ? `\n🤖 <b>ИИ: ${VERDICT[r.verdict] ?? r.verdict}, ${r.master_score ?? r.score}/5</b>\n<i>${esc(r.explanation)}</i>` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// Развёрнута ли карточка (в полной версии есть строка с описанием)
export const isExpanded = (msg: { text?: string; caption?: string }) => (msg.text ?? msg.caption ?? "").includes("📝");
// Первая строка текущего сообщения — чтобы при сворачивании/разворачивании заголовок не терялся
export const firstLine = (msg: { text?: string; caption?: string }) => (msg.text ?? msg.caption ?? "").split("\n")[0];

export const render = (o: TgOrder, head: string, expanded: boolean) => expanded ? orderText(o, head) : compactText(o, head);

// Кнопки: исполнителю — следующий шаг наряда, мастеру — подтверждение и переназначение
export function keyboard(o: TgOrder, role: string, expanded = false): Button[][] {
  const rows: Button[][] = [];
  if (role === "worker") {
    if (o.status === "issued") {
      rows.push([{ text: "✅ Принять", callback_data: `a:${o.id}:accept` }, { text: "⏳ В очередь", callback_data: `a:${o.id}:queue` }]);
      rows.push([{ text: "✖ Отклонить…", callback_data: `R:${o.id}:reject` }]);
    } else if (["accepted", "queued", "paused", "rework"].includes(o.status)) {
      rows.push([{ text: o.status === "rework" ? "▶ Начать доработку" : o.status === "paused" ? "▶ Продолжить" : "▶ Начать", callback_data: `a:${o.id}:start` }]);
      if (o.status !== "paused" && o.status !== "rework") rows.push([{ text: "✖ Отклонить…", callback_data: `R:${o.id}:reject` }]);
    } else if (o.status === "in_progress") {
      rows.push([{ text: "📷 Закрыть наряд", url: `${APP_URL}/worker/close/${o.id}` }, { text: "⏸ Пауза…", callback_data: `R:${o.id}:pause` }]);
    }
  } else {
    if (["issued", "rejected", "accepted", "queued", "paused"].includes(o.status)) rows.push([{ text: "🔁 Переназначить", callback_data: `r:${o.id}` }]);
    if (["done", "ai_review"].includes(o.status)) rows.push([{ text: "✔ Подтвердить и закрыть", callback_data: `m:${o.id}:approve` }]);
  }
  rows.push(expanded
    ? [{ text: "▴ Свернуть", callback_data: `c:${o.id}` }, { text: "📱 В приложении", url: `${APP_URL}/order/${o.id}` }]
    : [{ text: "▾ Подробнее", callback_data: `e:${o.id}` }]);
  return rows;
}

export function reasonKeyboard(o: TgOrder, action: "reject" | "pause"): Button[][] {
  return [
    ...REASONS[action].map((r, i) => [{ text: r, callback_data: `${action === "reject" ? "j" : "p"}:${o.id}:${i}` }]),
    [{ text: "← Назад", callback_data: `k:${o.id}` }],
  ];
}

export async function candidatesKeyboard(o: TgOrder): Promise<Button[][]> {
  const { data } = await admin.rpc("suggest_assignees", { p_equipment_id: o.equipment_id, p_specialty: o.assignee?.specialty ?? null, p_limit: 4 });
  const rows: Button[][] = (data ?? [])
    .filter((c: { employee_id: string }) => c.employee_id !== o.assignee_id)
    .slice(0, 3)
    .map((c: { employee_id: string; full_name: string; reason: string }, i: number) => [{
      text: `${i === 0 ? "★ " : ""}${short(c.full_name)} — ${c.reason.split(",")[0]}`.slice(0, 60),
      callback_data: `rc:${o.id}:${c.employee_id}`,
    }]);
  rows.push([{ text: "← Назад", callback_data: `k:${o.id}` }]);
  return rows;
}

// Фото неисправности «до» — прикладываем к новому наряду
export async function beforePhotoUrl(orderId: number): Promise<string | null> {
  const { data } = await admin.from("photos").select("storage_path").eq("order_id", orderId).eq("kind", "before").order("uploaded_at").limit(1);
  if (!data?.length) return null;
  const { data: signed } = await admin.storage.from("photos").createSignedUrl(data[0].storage_path, 600);
  return signed?.signedUrl ?? null;
}
