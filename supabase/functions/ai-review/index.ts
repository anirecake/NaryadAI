// ИИ-проверка закрытого наряда (п. 6.2–6.4 ТЗ).
// Вызывается триггером БД при переходе наряда в «Исполнено».
// 1) правила считают факты: полнота, материалы против нормы, время, фото и их повторы;
// 2) Claude сравнивает проблему с работами и фото «до/после» (без ФИО — обезличено);
// 3) итоговый вердикт: жёсткие нарушения → «требует доработки», низкая уверенность → «нужна проверка мастером».
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { admin, cors, hours, isHookCall, json } from "../_shared/common.ts";
import { aiEnabled, askJson, imageBlock } from "../_shared/claude.ts";

type Verdict = "accepted" | "accepted_with_remarks" | "rework" | "needs_master_review";

interface LlmReview {
  work_matches_problem: "yes" | "partly" | "no";
  work_comment: string;
  materials_ok: "yes" | "partly" | "no";
  materials_comment: string;
  photo_same_equipment: "yes" | "no" | "unknown";
  photo_problem_fixed: "yes" | "partly" | "no" | "unknown";
  photo_quality_issues: string[];
  photo_score: number;
  score: number;
  confidence: number;
  explanation: string;
  worker_good: string[];
  worker_improve: string[];
  master_summary: string;
}

const LLM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["work_matches_problem", "work_comment", "materials_ok", "materials_comment", "photo_same_equipment",
    "photo_problem_fixed", "photo_quality_issues", "photo_score", "score", "confidence", "explanation",
    "worker_good", "worker_improve", "master_summary"],
  properties: {
    work_matches_problem: { type: "string", enum: ["yes", "partly", "no"] },
    work_comment: { type: "string" },
    materials_ok: { type: "string", enum: ["yes", "partly", "no"] },
    materials_comment: { type: "string" },
    photo_same_equipment: { type: "string", enum: ["yes", "no", "unknown"] },
    photo_problem_fixed: { type: "string", enum: ["yes", "partly", "no", "unknown"] },
    photo_quality_issues: { type: "array", items: { type: "string" } },
    photo_score: { type: "integer", description: "1–5, 0 если фото нет" },
    score: { type: "integer", description: "Итоговая оценка качества 1–5" },
    confidence: { type: "number", description: "Уверенность 0–1" },
    explanation: { type: "string", description: "1–2 предложения: почему такая оценка" },
    worker_good: { type: "array", items: { type: "string" } },
    worker_improve: { type: "array", items: { type: "string" } },
    master_summary: { type: "string", description: "3–5 предложений для мастера" },
  },
};

const SYSTEM = `Ты — ИИ-контролёр смены на горно-обогатительном предприятии (хризотил, Житикара).
Проверяешь закрытый наряд на ремонт оборудования. Отвечай по-русски, коротко и по делу,
простым языком для мастера и слесаря. Оценивай только то, что видно в данных и на фото.
Если фото нечёткое или не относится к делу — снижай confidence, а не выдумывай.
Шкала score: 5 — отлично, 4 — хорошо, 3 — есть замечания, 2 — плохо, 1 — работа не выполнена.`;

async function photoBase64(path: string): Promise<string | null> {
  const { data } = await admin.storage.from("photos").download(path);
  return data ? encodeBase64(new Uint8Array(await data.arrayBuffer())) : null;
}

function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await isHookCall(req))) return json({ error: "forbidden" }, 403);

  const { order_id } = await req.json();
  const { data: o } = await admin.from("orders")
    .select("*, equipment(name, type), sites(name), fault:fault_codes(code, name, norm_hours)")
    .eq("id", order_id).single();
  if (!o || o.status !== "done") return json({ skipped: true });

  const [{ data: wo }, { data: photos }] = await Promise.all([
    admin.from("material_writeoffs").select("qty, material_id, materials(name, unit)").eq("order_id", o.id),
    admin.from("photos").select("id, kind, storage_path, phash, uploaded_at").eq("order_id", o.id),
  ]);
  const { data: norms } = o.fault_code
    ? await admin.from("material_norms").select("material_id, typical_qty").eq("fault_code", o.fault_code)
    : { data: [] };
  const normBy = new Map((norms ?? []).map((n) => [n.material_id, Number(n.typical_qty)]));

  // ── 1. Правила ──
  const unplanned = o.type === "unplanned";
  const after = (photos ?? []).filter((p) => p.kind === "after");
  const before = (photos ?? []).filter((p) => p.kind === "before");
  const issues: string[] = [];   // жёсткие нарушения → доработка
  const remarks: string[] = [];  // замечания
  let score = 5;

  if (!o.work_done?.trim()) { issues.push("не описаны выполненные работы"); score -= 2; }
  if (unplanned && !o.fault_code) { issues.push("не указан шифр неисправности"); score -= 1; }
  if (unplanned && after.length === 0) { issues.push("нет фото «после» — обязательно для внеплановых работ"); score -= 2; }

  // повтор старого фото: перцептивный хэш против фото других нарядов
  let duplicate = false;
  const hashes = after.map((p) => p.phash).filter(Boolean) as string[];
  if (hashes.length) {
    const { data: others } = await admin.from("photos").select("order_id, phash").neq("order_id", o.id).not("phash", "is", null);
    duplicate = (others ?? []).some((x) => hashes.some((h) => hamming(h, x.phash!) <= 5));
    if (duplicate) { issues.push("фото «после» совпадает с фото другого наряда — похоже на старое фото"); score -= 2; }
  }
  if (after.some((p) => o.started_at && p.uploaded_at < o.started_at)) {
    remarks.push("фото «после» загружено раньше начала работ");
  }

  const materials = (wo ?? []).map((w) => {
    const norm = normBy.get(w.material_id);
    const ratio = norm ? Number(w.qty) / norm : null;
    // @ts-ignore: связанная запись
    const name = `${w.materials?.name} — ${w.qty} ${w.materials?.unit}`;
    return { name, qty: Number(w.qty), norm, ratio, typical: norm !== undefined };
  });
  for (const m of materials) {
    if (m.ratio !== null && m.ratio > 2) { issues.push(`завышено списание: ${m.name} при норме ${m.norm} (×${m.ratio.toFixed(1)})`); score -= 1.5; }
    else if (m.ratio !== null && m.ratio > 1.4) { remarks.push(`списание выше нормы: ${m.name} (×${m.ratio.toFixed(1)})`); score -= 0.5; }
  }
  const atypical = o.fault_code && normBy.size ? materials.filter((m) => !m.typical) : [];
  if (atypical.length) { remarks.push(`нетипичные для шифра ${o.fault_code} материалы: ${atypical.map((m) => m.name).join(", ")}`); score -= Math.min(1, 0.5 * atypical.length); }

  const factH = hours(o.started_at, o.done_at);
  const normH = Number(o.norm_hours ?? o.fault?.norm_hours ?? 0) || null;
  if (factH && normH && factH > normH * 1.5) { remarks.push(`время ${factH.toFixed(1)} ч при нормативе ${normH} ч`); score -= 0.5; }
  const overdue = new Date(o.done_at) > new Date(o.due_at);
  if (overdue) { remarks.push("наряд выполнен с просрочкой"); score -= 0.5; }

  // ── 2. Claude: смысл работ и фото ──
  let llm: LlmReview | null = null;
  if (aiEnabled) {
    const content: Parameters<typeof askJson>[0]["content"] = [];
    const facts = {
      оборудование: o.equipment?.name, участок: o.sites?.name, тип: unplanned ? "внеплановый" : "плановый",
      приоритет: o.priority, проблема: o.description, выполненные_работы: o.work_done ?? "",
      шифр: o.fault ? `${o.fault.code} ${o.fault.name}` : "не указан", комментарий: o.close_comment ?? "",
      материалы: materials.map((m) => ({ позиция: m.name, норма_по_шифру: m.norm ?? "нет нормы" })),
      время_факт_ч: factH?.toFixed(1), норматив_ч: normH, просрочка: overdue,
      замечания_правил: [...issues, ...remarks],
    };
    content.push({ type: "text", text: `Данные наряда:\n${JSON.stringify(facts, null, 1)}` });
    for (const [label, list] of [["ФОТО «ДО» (неисправность при выдаче)", before], ["ФОТО «ПОСЛЕ» (результат)", after]] as const) {
      for (const p of list.slice(0, 2)) {
        const b64 = await photoBase64(p.storage_path);
        if (b64) content.push({ type: "text", text: label }, imageBlock(b64));
      }
    }
    if (!after.length) content.push({ type: "text", text: "Фото «после» нет." });
    content.push({ type: "text", text: "Проверь наряд и верни оценку по схеме." });
    llm = await askJson<LlmReview>({ system: SYSTEM, content, schema: LLM_SCHEMA, effort: "low" });
  }

  // ── 3. Итог ──
  score = Math.max(1, Math.min(5, score));
  let confidence = 0.9;
  if (llm) {
    if (llm.work_matches_problem === "no") issues.push(`работы не соответствуют проблеме: ${llm.work_comment}`);
    if (llm.photo_problem_fixed === "no") issues.push(`по фото проблема не устранена: ${llm.photo_quality_issues.join(", ")}`);
    if (llm.photo_same_equipment === "no") issues.push("на фото «после» другое оборудование");
    if (llm.materials_ok === "no") remarks.push(llm.materials_comment);
    score = Math.max(1, Math.min(5, Math.round(((llm.score + score) / 2) * 10) / 10));
    confidence = Math.max(0, Math.min(1, llm.confidence));
  }
  const verdict: Verdict = issues.length ? "rework"
    : confidence < 0.6 ? "needs_master_review"
    : score >= 4 && remarks.length === 0 ? "accepted"
    : score >= 3 ? "accepted_with_remarks" : "needs_master_review";
  if (verdict === "rework") score = Math.min(score, 2.5);

  const explanation = llm?.explanation && verdict !== "rework" ? llm.explanation
    : issues.length ? `Требует доработки: ${issues.join("; ")}.`
    : remarks.length ? `Замечания: ${remarks.join("; ")}.` : "Наряд закрыт полностью, нарушений не найдено.";

  const good = llm?.worker_good?.length ? llm.worker_good
    : [after.length && "приложено фото результата", o.fault_code && "указан шифр", !overdue && "выполнено в срок"].filter(Boolean) as string[];
  const improve = llm?.worker_improve?.length ? llm.worker_improve : [...issues, ...remarks];
  const timeLine = factH ? `Время: ${factH.toFixed(1)} ч${normH ? ` при нормативе ${normH} ч` : ""}${overdue ? ", с просрочкой" : ""}.` : "";
  const workerReport = [`Оценка ИИ: ${score}/5.`, good.length ? `Хорошо: ${good.join("; ")}.` : "",
    improve.length ? `Улучшить: ${improve.join("; ")}.` : "", timeLine].filter(Boolean).join("\n");
  const masterReport = [llm?.master_summary ?? explanation,
    `Работы: ${o.work_done ?? "—"}`, `Материалы: ${materials.map((m) => m.name).join(", ") || "—"}`,
    `Фото: до — ${before.length}, после — ${after.length}${duplicate ? " (повтор!)" : ""}`, timeLine,
    !aiEnabled ? "Проверка выполнена правилами (Claude не подключён)." : ""].filter(Boolean).join("\n");

  await admin.from("ai_reviews").insert({
    order_id: o.id, verdict, score, confidence,
    explanation,
    checks: { issues, remarks, materials, fact_hours: factH, norm_hours: normH, overdue, duplicate_photo: duplicate,
              photos: { before: before.length, after: after.length }, llm, ai: aiEnabled },
    worker_report: workerReport, master_report: masterReport,
  });

  const { error } = await admin.rpc("transition_order", {
    p_order_id: o.id, p_action: "ai_verdict",
    p_reason: verdict === "rework" ? explanation : null,
    p_payload: { verdict, explanation },
  });
  if (error) return json({ error: error.message }, 500);

  const label = { accepted: "принято", accepted_with_remarks: "принято с замечаниями", rework: "требует доработки",
                  needs_master_review: "нужна проверка мастером" }[verdict];
  await admin.rpc("notify", { p_employee: o.master_id, p_order: o.id, p_kind: "verdict",
    p_text: `🤖 Наряд №${o.number} (${o.equipment?.name}): ИИ — ${label}, ${score}/5. ${explanation}` });
  if (verdict !== "rework" && o.assignee_id) {
    await admin.rpc("notify", { p_employee: o.assignee_id, p_order: o.id, p_kind: "verdict",
      p_text: `🤖 Наряд №${o.number}: ваша оценка ${score}/5 — ${label}. Подробности в приложении.` });
  }
  return json({ verdict, score, confidence });
});
