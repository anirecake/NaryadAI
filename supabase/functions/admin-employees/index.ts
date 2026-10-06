// Кабинет администратора: добавить сотрудника с входом по табельному № и ПИН,
// сменить ПИН, уволить / вернуть, изменить данные. Вызывает только роль «admin».
import { admin, callerEmployee, cors, json } from "../_shared/common.ts";

const ROLES = ["master", "worker", "manager", "admin"];
const email = (tab: string) => `${tab}@narad.local`;
const pinOk = (pin: unknown) => typeof pin === "string" && /^\d{6}$/.test(pin);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const me = await callerEmployee(req);
  if (!me || me.role !== "admin") return json({ error: "Только администратор" }, 403);
  const body = await req.json();

  try {
    if (body.action === "create") {
      const e = body.employee ?? {};
      const tab = String(e.tab_no ?? "").trim();
      if (!/^\d{3,10}$/.test(tab)) return json({ error: "Табельный номер — от 3 до 10 цифр" }, 400);
      if (!String(e.full_name ?? "").trim()) return json({ error: "Укажите ФИО" }, 400);
      if (!ROLES.includes(e.role)) return json({ error: "Неизвестная роль" }, 400);
      if (!pinOk(body.pin)) return json({ error: "ПИН — ровно 6 цифр" }, 400);
      const { data: exists } = await admin.from("employees").select("id").eq("tab_no", tab).maybeSingle();
      if (exists) return json({ error: `Табельный №${tab} уже занят` }, 409);

      const { data: u, error } = await admin.auth.admin.createUser({ email: email(tab), password: body.pin, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      const { data: row, error: insErr } = await admin.from("employees").insert({
        id: u.user.id, auth_user_id: u.user.id, tab_no: tab, full_name: String(e.full_name).trim(),
        specialty: e.specialty || (e.role === "worker" ? "слесарь" : e.role === "master" ? "мастер смены" : e.role === "manager" ? "руководитель" : "администратор"),
        grade: e.grade ? Number(e.grade) : null, brigade_id: e.brigade_id ? Number(e.brigade_id) : null,
        role: e.role, shift: e.shift || null, on_shift: e.role !== "worker" ? true : Boolean(e.on_shift),
      }).select().single();
      if (insErr) {
        await admin.auth.admin.deleteUser(u.user.id);   // откат: учётка без сотрудника не нужна
        return json({ error: insErr.message }, 400);
      }
      return json({ employee: row });
    }

    const { data: emp } = await admin.from("employees").select("*").eq("id", body.employee_id).single();
    if (!emp) return json({ error: "Сотрудник не найден" }, 404);

    if (body.action === "reset_pin") {
      if (!pinOk(body.pin)) return json({ error: "ПИН — ровно 6 цифр" }, 400);
      const { error } = await admin.auth.admin.updateUserById(emp.auth_user_id, { password: body.pin });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    if (body.action === "set_active") {
      if (emp.id === me.id) return json({ error: "Нельзя уволить самого себя" }, 400);
      const active = Boolean(body.active);
      await admin.auth.admin.updateUserById(emp.auth_user_id, { ban_duration: active ? "none" : "876000h" });
      const { error } = await admin.from("employees").update({ active, on_shift: active ? emp.on_shift : false }).eq("id", emp.id);
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    if (body.action === "update") {
      const f = body.fields ?? {};
      const patch: Record<string, unknown> = {};
      for (const k of ["full_name", "specialty", "shift"]) if (k in f) patch[k] = f[k] || null;
      if ("grade" in f) patch.grade = f.grade ? Number(f.grade) : null;
      if ("brigade_id" in f) patch.brigade_id = f.brigade_id ? Number(f.brigade_id) : null;
      if ("role" in f) {
        if (!ROLES.includes(f.role)) return json({ error: "Неизвестная роль" }, 400);
        if (emp.id === me.id && f.role !== "admin") return json({ error: "Нельзя снять с себя роль администратора" }, 400);
        patch.role = f.role;
      }
      const { error } = await admin.from("employees").update(patch).eq("id", emp.id);
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
