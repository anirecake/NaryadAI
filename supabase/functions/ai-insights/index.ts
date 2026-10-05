// ИИ-аналитика для мастера и руководителя:
//   anomalies     — закономерности в истории + выводы и рекомендации (п. 6.5)
//   shift_summary — итоговая сводка смены текстом (п. 7, отчёт за смену)
//   suggest_code  — шифр неисправности и норматив по описанию проблемы (п. 5.1.4, бонус)
//   assistant     — ответы на вопросы мастера по текущей смене (п. 6.7, бонус)
import { admin, callerEmployee, cors, json, shortName } from "../_shared/common.ts";
import { aiEnabled, askJson, askText } from "../_shared/claude.ts";
import { type Finding, findAnomalies } from "../_shared/anomalies.ts";

const PLAIN = "Пиши по-русски, простым языком для мастера смены на горно-обогатительном предприятии. Без воды, только факты из данных.";

async function loadAll<T>(table: string, select: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

async function anomalies() {
  const [orders, eq, emps, norms, wo] = await Promise.all([
    loadAll<any>("orders", "id, type, equipment_id, assignee_id, brigade_id, fault_code, rework_count, issued_at, done_at, status"),
    loadAll<any>("equipment", "id, name, type, sites(name)"),
    loadAll<any>("employees", "id, full_name"),
    loadAll<any>("material_norms", "fault_code, material_id, typical_qty"),
    loadAll<any>("material_writeoffs", "order_id, material_id, qty"),
  ]);
  const normMap = new Map<string, Map<number, number>>();
  for (const n of norms) (normMap.get(n.fault_code) ?? normMap.set(n.fault_code, new Map()).get(n.fault_code)!).set(n.material_id, Number(n.typical_qty));
  const woMap = new Map<number, [number, number][]>();
  for (const w of wo) (woMap.get(w.order_id) ?? woMap.set(w.order_id, []).get(w.order_id)!).push([w.material_id, Number(w.qty)]);

  const findings = findAnomalies({
    orders: orders.filter((o) => o.status !== "cancelled"),
    equipment: new Map(eq.map((e) => [e.id, { name: e.name, type: e.type, site: e.sites?.name }])),
    employees: new Map(emps.map((e) => [e.id, e.full_name])),
    norms: normMap,
    writeoffs: woMap,
  });

  // Claude переписывает выводы простым языком и даёт рекомендацию; цифры — только из facts
  type Rewritten = { items: { index: number; title: string; conclusion: string; recommendation: string }[] };
  const ai = await askJson<Rewritten>({
    system: `${PLAIN} Тебе даны найденные статистикой закономерности. Для каждой: короткий заголовок, вывод (1–2 предложения, с числами строго из facts) и одна конкретная рекомендация для службы главного механика. Не добавляй фактов, которых нет.`,
    content: JSON.stringify(findings.map((f, i) => ({ index: i, kind: f.kind, subject: f.subject, facts: f.facts, draft: f.text }))),
    schema: {
      type: "object", additionalProperties: false, required: ["items"],
      properties: { items: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["index", "title", "conclusion", "recommendation"],
        properties: { index: { type: "integer" }, title: { type: "string" }, conclusion: { type: "string" }, recommendation: { type: "string" } } } } },
    },
  });
  return findings.map((f: Finding, i) => {
    const r = ai?.items.find((x) => x.index === i);
    return { ...f, title: r?.title ?? f.subject, conclusion: r?.conclusion ?? f.text, recommendation: r?.recommendation ?? null };
  });
}

async function shiftSummary(from: string, to: string) {
  const { data: report } = await admin.rpc("shift_report", { p_from: from, p_to: to });
  const { data: rating } = await admin.rpc("worker_rating", { p_from: from, p_to: to });
  const r = report as Record<string, any>;
  // обезличивание: в модель уходят только инициалы
  const top = (rating ?? []).slice(0, 3).map((x: any) => `${shortName(x.full_name)} ${x.total}`);
  const text = await askText({
    system: `${PLAIN} Напиши итоговую сводку смены для мастера: 4–6 предложений. Что сделано, где проблемы (просрочки, отказы, доработки, простои), на что обратить внимание следующей смене.`,
    content: JSON.stringify({ ...r, лучшие_по_рейтингу: top }),
  });
  return text ?? [
    `За период выдано ${r.issued} нарядов, выполнено ${r.done}, закрыто ${r.closed}.`,
    `Просрочено ${r.overdue}, отклонено ${r.rejected}, возвратов на доработку ${r.rework}.`,
    `Аварийных нарядов ${r.emergency}, простой оборудования по внеплановым работам ${r.downtime_h} ч.`,
    r.avg_reaction_min ? `Среднее время реакции ${r.avg_reaction_min} мин, выполнения ${r.avg_exec_h} ч.` : "",
    r.top_equipment?.[0] ? `Больше всего отказов: ${r.top_equipment[0].equipment} (${r.top_equipment[0].unplanned}).` : "",
    `Сейчас открыто ${r.open_now} нарядов.`,
  ].filter(Boolean).join(" ");
}

async function suggestCode(description: string, equipmentId: number | null) {
  const { data: codes } = await admin.from("fault_codes").select("code, name, specialty, norm_hours");
  let history: string[] = [];
  if (equipmentId) {
    const { data } = await admin.from("orders").select("fault_code").eq("equipment_id", equipmentId).not("fault_code", "is", null).limit(200);
    const c = new Map<string, number>();
    for (const o of data ?? []) c.set(o.fault_code, (c.get(o.fault_code) ?? 0) + 1);
    history = [...c].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} (${n})`);
  }
  const ai = await askJson<{ code: string; confidence: number; why: string }>({
    system: `${PLAIN} Выбери один шифр неисправности из справочника по описанию проблемы.`,
    content: JSON.stringify({ описание: description, частые_шифры_этого_оборудования: history, справочник: codes }),
    schema: { type: "object", additionalProperties: false, required: ["code", "confidence", "why"],
      properties: { code: { type: "string", enum: (codes ?? []).map((c) => c.code) }, confidence: { type: "number" }, why: { type: "string" } } },
  });
  // без ИИ — по ключевым словам
  const kw: [RegExp, string][] = [[/подшип|гре|нагрев.*узл/i, "М-02"], [/лент/i, "М-03"], [/цеп|звёздоч|звездоч/i, "М-04"],
    [/вибрац|крепл|болт/i, "М-05"], [/колес|напор/i, "М-06"], [/кабел|питани/i, "Э-01"], [/двигател/i, "Э-02"],
    [/автомат|защит/i, "Э-03"], [/датчик|сигнал/i, "Э-04"], [/пускател|контактор/i, "Э-05"], [/теч|масл/i, "Г-01"],
    [/цилиндр/i, "Г-02"], [/воздух|пневм/i, "П-01"], [/компрессор/i, "П-03"], [/смазк/i, "С-01"]];
  const code = ai?.code ?? kw.find(([re]) => re.test(description))?.[1];
  const c = (codes ?? []).find((x) => x.code === code);
  return c ? { code: c.code, name: c.name, specialty: c.specialty, norm_hours: Number(c.norm_hours),
    confidence: ai?.confidence ?? 0.5, why: ai?.why ?? "по ключевым словам описания", ai: Boolean(ai) } : null;
}

async function assistant(question: string) {
  // снимок смены — модель отвечает только по нему (без инструментов и без ФИО полностью)
  const [{ data: people }, { data: open }, { data: kpi }] = await Promise.all([
    admin.from("employee_live_status").select("full_name, specialty, live_status, current_order_number, queue_count"),
    admin.from("orders").select("number, priority, status, is_overdue, due_at, description, equipment(name), sites(name), assignee:employees!orders_assignee_id_fkey(full_name)")
      .in("status", ["issued", "accepted", "queued", "in_progress", "paused", "rework", "done", "ai_review"]),
    admin.rpc("dashboard_kpis", { p_days: 7 }),
  ]);
  const snapshot = {
    сейчас: new Date().toISOString(),
    исполнители: (people ?? []).map((p: any) => ({ кто: shortName(p.full_name), специальность: p.specialty, статус: p.live_status, наряд: p.current_order_number, очередь: p.queue_count })),
    открытые_наряды: (open ?? []).map((o: any) => ({ номер: o.number, приоритет: o.priority, статус: o.status, просрочен: o.is_overdue || new Date(o.due_at) < new Date(),
      срок: o.due_at, что: o.description, оборудование: o.equipment?.name, участок: o.sites?.name, исполнитель: o.assignee ? shortName(o.assignee.full_name) : null })),
    показатели_7_дней: kpi,
  };
  const text = await askText({
    system: `${PLAIN} Ты — ИИ-ассистент мастера смены. Отвечай на вопрос только по снимку данных смены ниже. Если данных не хватает — так и скажи. Отвечай коротко, списком, если уместно.`,
    content: `Снимок смены:\n${JSON.stringify(snapshot)}\n\nВопрос мастера: ${question}`,
    effort: "low",
  });
  if (text) return text;
  // без ИИ — ответ на самые частые вопросы правилами
  const q = question.toLowerCase();
  if (/свобод/.test(q)) {
    const spec = /электрик/.test(q) ? "электрик" : /сварщ/.test(q) ? "сварщик" : /слесар/.test(q) ? "слесарь" : null;
    const free = snapshot.исполнители.filter((p) => p.статус === "free" && (!spec || p.специальность === spec));
    return free.length ? `Свободны: ${free.map((p) => `${p.кто} (${p.специальность})`).join(", ")}.` : "Свободных нет.";
  }
  if (/просроч/.test(q)) {
    const od = snapshot.открытые_наряды.filter((o) => o.просрочен);
    return od.length ? od.map((o) => `№${o.номер} ${o.оборудование} — ${o.исполнитель ?? "без исполнителя"}`).join("\n") : "Просроченных нарядов нет.";
  }
  return "ИИ-ассистент работает без Claude: доступны вопросы «кто свободен…» и «что просрочено». Подключите ANTHROPIC_API_KEY для свободных вопросов.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const me = await callerEmployee(req);
  if (!me) return json({ error: "unauthorized" }, 401);
  const body = await req.json();
  const staff = ["master", "manager", "admin"].includes(me.role);
  try {
    switch (body.kind) {
      case "anomalies":
        if (!staff) return json({ error: "forbidden" }, 403);
        return json({ ai: aiEnabled, findings: await anomalies() });
      case "shift_summary":
        if (!staff) return json({ error: "forbidden" }, 403);
        return json({ ai: aiEnabled, text: await shiftSummary(body.from, body.to) });
      case "suggest_code":
        return json({ ai: aiEnabled, suggestion: await suggestCode(String(body.description ?? ""), body.equipment_id ?? null) });
      case "assistant":
        if (!staff) return json({ error: "forbidden" }, 403);
        return json({ ai: aiEnabled, text: await assistant(String(body.question ?? "")) });
      default:
        return json({ error: "unknown kind" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
