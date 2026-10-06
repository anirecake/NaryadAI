// Карточка наряда для Telegram: оформление и кнопки под роль и статус.
// Один формат и для новых уведомлений (tg-notify), и для обновления после нажатия кнопки (tg-webhook).
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

export const REASONS = {
  reject: ["Нет материалов", "Нет допуска", "Занят аварийным нарядом"],
  pause: ["Ждёт запчасти", "Ждёт остановки оборудования", "Ждёт допуска"],
};

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (full?: string) => { if (!full) return "—"; const [a, b] = full.split(" "); return b ? `${a} ${b[0]}.` : a; };
const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qostanay" });

function dueLine(o: TgOrder) {
  if (["done", "ai_review", "closed", "cancelled"].includes(o.status)) return "";
  const mins = Math.round((new Date(o.due_at).getTime() - Date.now()) / 60000);
  if (mins < 0) return `⏰ Срок: <b>${time(o.due_at)}</b> — <b>просрочен на ${fmtMin(-mins)}</b>`;
  return `⏰ Срок: <b>${time(o.due_at)}</b> (через ${fmtMin(mins)})`;
}
const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60 ? `${m % 60} мин` : ""}`.trim() : `${m} мин`;

export async function loadOrder(id: number): Promise<TgOrder | null> {
  const { data } = await admin.from("orders").select(ORDER_FIELDS).eq("id", id).single();
  return data;
}

// Текст карточки. headline — строка-повод сверху (например, «Новый наряд» или «Просрочка»).
export function orderText(o: TgOrder, headline?: string, note?: string) {
  const title = o.priority === "emergency" ? `🚨 <b>АВАРИЙНЫЙ НАРЯД №${o.number}</b>` : `🛠 <b>Наряд №${o.number}</b>`;
  const lines = [
    headline ? `<b>${esc(headline)}</b>` : "",
    title,
    `🏭 <b>${esc(o.equipment?.name)}</b> · ${esc(o.sites?.name)}`,
    `📝 ${esc(o.description)}`,
    o.priority !== "emergency" ? `Приоритет: ${PRIORITY[o.priority] ?? o.priority}` : "",
    dueLine(o),
    o.assignee ? `👷 Исполнитель: ${esc(short(o.assignee.full_name))}` : "",
    `Статус: <b>${STATUS[o.status] ?? o.status}</b>${o.rework_count ? ` · доработок: ${o.rework_count}` : ""}`,
    o.last_comment && ["paused", "rejected", "rework"].includes(o.status) ? `💬 ${esc(o.last_comment)}` : "",
    note ? `\n${note}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

const open = (o: TgOrder): Button => ({ text: "📱 Открыть в приложении", url: `${APP_URL}/order/${o.id}` });

// Кнопки: исполнителю — следующий шаг наряда, мастеру — подтверждение и переназначение
export function keyboard(o: TgOrder, role: string): Button[][] {
  const rows: Button[][] = [];
  if (role === "worker") {
    if (o.status === "issued") {
      rows.push([{ text: "✅ Принять", callback_data: `a:${o.id}:accept` }, { text: "⏳ В очередь", callback_data: `a:${o.id}:queue` }]);
      rows.push([{ text: "✖ Отклонить…", callback_data: `R:${o.id}:reject` }]);
    } else if (["accepted", "queued", "paused", "rework"].includes(o.status)) {
      rows.push([{ text: o.status === "rework" ? "▶ Начать доработку" : o.status === "paused" ? "▶ Продолжить" : "▶ Начать исполнение", callback_data: `a:${o.id}:start` }]);
      if (o.status !== "paused" && o.status !== "rework") rows.push([{ text: "✖ Отклонить…", callback_data: `R:${o.id}:reject` }]);
    } else if (o.status === "in_progress") {
      rows.push([{ text: "📷 Закрыть наряд (фото, материалы)", url: `${APP_URL}/worker/close/${o.id}` }]);
      rows.push([{ text: "⏸ Пауза…", callback_data: `R:${o.id}:pause` }]);
      return rows;
    }
  } else {
    if (["issued", "rejected", "accepted", "queued", "paused"].includes(o.status)) rows.push([{ text: "🔁 Переназначить", callback_data: `r:${o.id}` }]);
    if (["done", "ai_review"].includes(o.status)) rows.push([{ text: "✔ Подтвердить и закрыть", callback_data: `m:${o.id}:approve` }]);
  }
  rows.push([open(o)]);
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
