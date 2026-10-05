// Общие утилиты Edge Functions НарядAI
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const APP_URL = Deno.env.get("APP_URL") ?? "https://naryad-ai-eta.vercel.app";

// Клиент с правами service_role — только внутри функций, наружу не отдаётся
export const admin: SupabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// Клиент от имени вызвавшего пользователя (RLS и роли работают как в приложении)
export function userClient(req: Request): SupabaseClient {
  return createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Вызов пришёл из нашей БД (триггер через pg_net), а не снаружи
export async function isHookCall(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-narad-hook");
  if (!secret) return false;
  const { data } = await admin.rpc("hook_secret_ok", { p: secret });
  return data === true;
}

// Сотрудник, вызвавший функцию из приложения
export async function callerEmployee(req: Request) {
  const { data } = await userClient(req).rpc("current_employee");
  return data?.id ? data as { id: string; full_name: string; role: string } : null;
}

export const shortName = (full: string) => {
  const [last, first] = full.split(" ");
  return first ? `${last} ${first[0]}.` : last;
};

export const hours = (a: string | null, b: string | null) =>
  a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000 : null;
