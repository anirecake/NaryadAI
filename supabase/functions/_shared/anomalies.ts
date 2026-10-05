// Поиск аномалий в истории нарядов (п. 6.5 ТЗ) — порт analytics/find_anomalies.py.
// Цифры считает код; языковая модель потом только переформулирует вывод.

export interface Finding {
  kind: "top_problem" | "repeat_fault" | "after_ppr" | "worker_quality" | "material_overuse" | "rising_trend";
  severity: "high" | "medium";
  subject: string;
  facts: Record<string, unknown>;
  text: string;
}

interface Order {
  id: number; type: string; equipment_id: number; assignee_id: string | null; brigade_id: number | null;
  fault_code: string | null; rework_count: number; issued_at: string; done_at: string | null;
}
interface Data {
  orders: Order[];
  equipment: Map<number, { name: string; type: string; site: string }>;
  employees: Map<string, string>;
  norms: Map<string, Map<number, number>>;
  writeoffs: Map<number, [number, number][]>;
}

const DAY = 86_400_000;
const t = (s: string) => new Date(s).getTime();
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const short = (full: string) => { const [a, b] = full.split(" "); return b ? `${a} ${b[0]}.` : a; };
const pct = (x: number) => `${Math.round(x * 100)}%`;

function poissonTail(k: number, lam: number) { // P(X ≥ k)
  let p = 0, term = Math.exp(-lam);
  for (let i = 0; i < k; i++) { p += term; term *= lam / (i + 1); }
  return 1 - p;
}

export function findAnomalies(d: Data): Finding[] {
  const orders = d.orders.filter((o) => o.done_at);
  const unpl = orders.filter((o) => o.type === "unplanned");
  const start = Math.min(...orders.map((o) => t(o.issued_at)));
  const end = Math.max(...orders.map((o) => t(o.issued_at)));
  const periodDays = Math.floor((end - start) / DAY) + 1;
  const out: Finding[] = [];
  const eqName = (id: number) => d.equipment.get(id)?.name ?? `#${id}`;

  // 1. Топ проблемного оборудования
  const cnt = new Map<number, number>(), downtime = new Map<number, number>();
  for (const o of unpl) {
    cnt.set(o.equipment_id, (cnt.get(o.equipment_id) ?? 0) + 1);
    downtime.set(o.equipment_id, (downtime.get(o.equipment_id) ?? 0) + (t(o.done_at!) - t(o.issued_at)) / 3_600_000);
  }
  const med = median([...d.equipment.keys()].map((id) => cnt.get(id) ?? 0)) || 1;
  const last30 = end - 30 * DAY;
  for (const [id, n] of [...cnt].sort((a, b) => b[1] - a[1])) {
    if (n < 2.5 * med) break;
    const recent = unpl.filter((o) => o.equipment_id === id && t(o.issued_at) >= last30);
    const codes = new Map<string, number>();
    for (const o of recent) codes.set(o.fault_code ?? "?", (codes.get(o.fault_code ?? "?") ?? 0) + 1);
    const [code, cc] = [...codes].sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
    const dt = downtime.get(id) ?? 0;
    out.push({ kind: "top_problem", severity: "high", subject: eqName(id),
      facts: { unplanned_total: n, median_per_unit: med, ratio: +(n / med).toFixed(1), last30: recent.length, top_code: code, top_code_count: cc, downtime_h: +dt.toFixed(1) },
      text: `${eqName(id)} (${d.equipment.get(id)?.site}): ${recent.length} внеплановых остановок за 30 дней, ${cc} из них — ${code}. За период ${n} нарядов — в ${(n / med).toFixed(1)} раза больше медианы, простой ${dt.toFixed(0)} ч. Рекомендуем найти корневую причину (${code}) и включить узел в план ППР.` });
  }

  // 2. Повторяющийся шифр на одной единице
  const pairs = new Map<string, number>(), distinct = new Map<number, Set<string>>();
  for (const o of unpl) {
    pairs.set(`${o.equipment_id}|${o.fault_code}`, (pairs.get(`${o.equipment_id}|${o.fault_code}`) ?? 0) + 1);
    (distinct.get(o.equipment_id) ?? distinct.set(o.equipment_id, new Set()).get(o.equipment_id)!).add(o.fault_code ?? "?");
  }
  for (const [key, n] of [...pairs].sort((a, b) => b[1] - a[1])) {
    const [idS, code] = key.split("|"); const id = Number(idS); const total = cnt.get(id) ?? 1;
    if (n >= 6 && n / total >= Math.max(0.5, 2.5 / (distinct.get(id)?.size ?? 1))) {
      out.push({ kind: "repeat_fault", severity: "high", subject: eqName(id), facts: { code, count: n, share: +(n / total).toFixed(2) },
        text: `${eqName(id)}: ${n} из ${total} внеплановых нарядов — один шифр ${code}. Ремонт не устраняет причину: проверьте соосность, посадки и условия работы узла.` });
    }
  }

  // 3. Поломки вскоре после ППР (окно 3 дня против обычной частоты)
  const W = 3;
  const groups = new Map<string, { units: Set<number>; ppr: number; hit: number; inWin: number; total: number; site: string; type: string }>();
  const g = (id: number) => {
    const e = d.equipment.get(id)!; const k = `${e.site}|${e.type}`;
    if (!groups.has(k)) groups.set(k, { units: new Set(), ppr: 0, hit: 0, inWin: 0, total: 0, site: e.site, type: e.type });
    return groups.get(k)!;
  };
  for (const p of orders.filter((o) => o.type === "planned")) {
    const gr = g(p.equipment_id); gr.units.add(p.equipment_id); gr.ppr++;
    const hits = unpl.filter((u) => u.equipment_id === p.equipment_id && t(u.issued_at) > t(p.done_at!) && t(u.issued_at) <= t(p.done_at!) + W * DAY);
    gr.hit += hits.length ? 1 : 0; gr.inWin += hits.length;
  }
  for (const u of unpl) g(u.equipment_id).total++;
  for (const gr of groups.values()) {
    const winDays = gr.ppr * W, outDays = gr.units.size * periodDays - winDays;
    const ratio = (gr.inWin / winDays) / ((gr.total - gr.inWin) / outDays || Infinity);
    if (gr.hit >= 5 && ratio >= 2.5) {
      out.push({ kind: "after_ppr", severity: "high", subject: `${gr.site}: ${gr.type}`,
        facts: { ppr: gr.ppr, failed: gr.hit, share: +(gr.hit / gr.ppr).toFixed(2), ratio: +ratio.toFixed(1), window_days: W },
        text: `Участок «${gr.site}», тип «${gr.type}»: после ${gr.hit} из ${gr.ppr} плановых ремонтов (${pct(gr.hit / gr.ppr)}) оборудование ломалось в течение ${W} дней — в ${ratio.toFixed(1)} раза чаще обычного. Сигнал о качестве ППР: проверьте технологию, запчасти и приёмку после ремонта.` });
    }
  }

  // 4. Исполнители: доработки и повторные поломки ≤ 7 дней
  const st = new Map<string, { n: number; rework: number; repeat: number; unpl: number }>();
  for (const o of orders) {
    if (!o.assignee_id) continue;
    const s = st.get(o.assignee_id) ?? st.set(o.assignee_id, { n: 0, rework: 0, repeat: 0, unpl: 0 }).get(o.assignee_id)!;
    s.n++; if (o.rework_count > 0) s.rework++;
    if (o.type === "unplanned") {
      s.unpl++;
      if (unpl.some((u) => u !== o && u.equipment_id === o.equipment_id && u.fault_code === o.fault_code
        && t(u.issued_at) > t(o.done_at!) && t(u.issued_at) <= t(o.done_at!) + 7 * DAY)) s.repeat++;
    }
  }
  const all = [...st.values()];
  const avgRework = all.reduce((a, s) => a + s.rework, 0) / all.reduce((a, s) => a + s.n, 0);
  const avgRepeat = all.reduce((a, s) => a + s.repeat, 0) / Math.max(1, all.reduce((a, s) => a + s.unpl, 0));
  for (const [id, s] of st) {
    const rw = s.rework / s.n, rp = s.repeat / Math.max(1, s.unpl);
    if (s.n >= 10 && (rw >= 2.5 * avgRework || rp >= 2.5 * avgRepeat)) {
      const name = short(d.employees.get(id) ?? "Исполнитель");
      out.push({ kind: "worker_quality", severity: "medium", subject: name,
        facts: { orders: s.n, rework_rate: +rw.toFixed(2), repeat_rate: +rp.toFixed(2), avg_rework: +avgRework.toFixed(2), avg_repeat: +avgRepeat.toFixed(2) },
        text: `${name}: ${pct(rw)} нарядов возвращались на доработку (в среднем ${pct(avgRework)}), после ${pct(rp)} ремонтов та же поломка повторялась в течение 7 дней (в среднем ${pct(avgRepeat)}). Рекомендуем наставничество и контроль приёмки его нарядов.` });
    }
  }

  // 5. Перерасход материалов по бригадам
  const br = new Map<number, [number, number, number]>();
  for (const o of unpl) {
    const n = d.norms.get(o.fault_code ?? ""); if (!n || o.brigade_id == null) continue;
    for (const [mid, qty] of d.writeoffs.get(o.id) ?? []) {
      if (!n.has(mid)) continue;
      const a = br.get(o.brigade_id) ?? [0, 0, 0]; a[0] += qty; a[1] += n.get(mid)!; a[2]++; br.set(o.brigade_id, a);
    }
  }
  const ratios = [...br].map(([b, [q, nq, n]]) => [b, q / nq, n] as const);
  const medRatio = median(ratios.map((r) => r[1]));
  for (const [b, r, n] of ratios) {
    if (r >= 1.25 && n >= 20) {
      out.push({ kind: "material_overuse", severity: "medium", subject: `Бригада №${b}`, facts: { ratio_to_norm: +r.toFixed(2), positions: n, median_ratio: +medRatio.toFixed(2) },
        text: `Бригада №${b}: списание материалов в ${r.toFixed(2)} раза выше нормы по шифрам (у других бригад ≈${medRatio.toFixed(2)}). Рекомендуем сверить фактический расход со складом.` });
    }
  }

  // 6. Рост числа отказов → прогноз
  const weeks = Math.max(1, Math.floor(periodDays / 7));
  for (const id of d.equipment.keys()) {
    const series = new Array(weeks).fill(0);
    for (const o of unpl) if (o.equipment_id === id) series[Math.min(weeks - 1, Math.floor((t(o.issued_at) - start) / (7 * DAY)))]++;
    const mx = (weeks - 1) / 2, my = series.reduce((a, b) => a + b, 0) / weeks;
    const slope = series.reduce((a, y, x) => a + (x - mx) * (y - my), 0) / series.reduce((a, _, x) => a + (x - mx) ** 2, 0);
    const first = series.slice(0, 4).reduce((a, b) => a + b, 0), last = series.slice(-4).reduce((a, b) => a + b, 0);
    const prev = series.slice(0, -4);
    const lam = Math.max(0.5, prev.reduce((a, b) => a + b, 0) / prev.length * 4);
    if (slope > 0 && last >= 5 && poissonTail(last, lam) < 0.005) {
      const next = Math.max(0, my + slope * (weeks + 0.5 - mx)) * 2;
      out.push({ kind: "rising_trend", severity: "high", subject: eqName(id),
        facts: { weekly: series, slope: +slope.toFixed(2), first4: first, last4: last, forecast_2w: +next.toFixed(1) },
        text: `${eqName(id)}: внеплановых нарядов за последние 4 недели ${last} против ${first} в первые 4 (рост ≈${slope.toFixed(2)} в неделю). Прогноз: ~${Math.round(next)} отказов в ближайшие 2 недели. Рекомендуем внеочередной осмотр и ППР до отказа.` });
    }
  }
  return out;
}
