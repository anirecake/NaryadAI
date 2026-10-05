"""
НарядAI — ИИ-аналитика истории (п. 6.5 ТЗ).

Принцип: цифры считает код, языковая модель только формулирует вывод и рекомендацию.
Скрипт находит факты статистикой и отдаёт их списком findings (JSON). Поле text —
готовая формулировка-шаблон; на следующем шаге её можно переписать через Claude.

Ничего не знает о заложенных закономерностях — ищет общими правилами:
  • top_problem       — оборудование с частотой внеплановых нарядов ≥ 2,5× медианы
  • repeat_fault      — один шифр повторяется на одной единице (ремонт не устраняет причину)
  • after_ppr         — поломки в течение 7 дней после планового ремонта
  • worker_quality    — исполнители с аномальной долей доработок и повторных поломок
  • material_overuse  — бригады/исполнители, списывающие больше нормы
  • rising_trend      — рост числа внеплановых нарядов → прогноз отказа

Запуск:  python analytics/find_anomalies.py [--days 91] [--json findings.json]
"""

import argparse
import csv
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
CSV = Path(__file__).resolve().parent.parent / "data" / "csv"


def load(name):
    with open(CSV / f"{name}.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def ts(s):
    return datetime.fromisoformat(s) if s else None


def short(full):
    p = full.split()
    return f"{p[0]} {p[1][0]}." if len(p) > 1 else full


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="куда сохранить findings")
    args = ap.parse_args()

    orders = load("orders")
    for o in orders:
        for k in ("issued_at", "done_at", "closed_at"):
            o[k] = ts(o[k])
    equipment = {e["id"]: e for e in load("equipment")}
    employees = {e["id"]: e for e in load("employees")}
    sites = {s["id"]: s["name"] for s in load("sites")}
    materials = {m["id"]: m for m in load("materials")}
    norms = defaultdict(dict)
    for n in load("material_norms"):
        norms[n["fault_code"]][n["material_id"]] = float(n["typical_qty"])
    writeoffs = defaultdict(list)
    for w in load("material_writeoffs"):
        writeoffs[w["order_id"]].append((w["material_id"], float(w["qty"])))
    by_id = {o["id"]: o for o in orders}

    end = max(o["issued_at"] for o in orders)
    start = min(o["issued_at"] for o in orders)
    period_days = (end - start).days + 1
    unpl = [o for o in orders if o["type"] == "unplanned"]
    findings = []

    # ── 1. Топ проблемного оборудования ──
    cnt = Counter(o["equipment_id"] for o in unpl)
    downtime = defaultdict(float)
    for o in unpl:
        downtime[o["equipment_id"]] += (o["done_at"] - o["issued_at"]).total_seconds() / 3600
    med = statistics.median(cnt.get(e, 0) for e in equipment)
    last30 = end - timedelta(days=30)
    for eq_id, n in cnt.most_common():
        if n < 2.5 * med:
            break
        eq = equipment[eq_id]
        n30 = sum(1 for o in unpl if o["equipment_id"] == eq_id and o["issued_at"] >= last30)
        codes = Counter(o["fault_code"] for o in unpl if o["equipment_id"] == eq_id and o["issued_at"] >= last30)
        code, ccount = codes.most_common(1)[0] if codes else (None, 0)
        findings.append(dict(
            kind="top_problem", severity="high", equipment_id=eq_id,
            facts=dict(unplanned_total=n, median_per_unit=med, ratio=round(n / med, 1), last30=n30,
                       top_code=code, top_code_count=ccount, downtime_h=round(downtime[eq_id], 1)),
            text=(f"{eq['name']} ({sites[eq['site_id']]}): {n30} внеплановых остановок за 30 дней, "
                  f"{ccount} из них — {code}. За период {n} нарядов — в {n / med:.1f} раза больше медианы "
                  f"по оборудованию, простой {downtime[eq_id]:.0f} ч. "
                  f"Рекомендуем найти корневую причину ({code}) и включить узел в план ППР."),
        ))

    # ── 2. Повторяющийся шифр на одной единице ──
    seen = set()
    distinct = defaultdict(set)
    for o in unpl:
        distinct[o["equipment_id"]].add(o["fault_code"])
    for (eq_id, code), n in Counter((o["equipment_id"], o["fault_code"]) for o in unpl).most_common():
        total_eq = cnt[eq_id]
        # доля шифра должна быть в 2,5+ раза выше «равномерной» для этой единицы
        if n >= 6 and n / total_eq >= max(0.5, 2.5 / len(distinct[eq_id])) and (eq_id, code) not in seen:
            seen.add((eq_id, code))
            eq = equipment[eq_id]
            findings.append(dict(
                kind="repeat_fault", severity="high", equipment_id=eq_id,
                facts=dict(code=code, count=n, share=round(n / total_eq, 2)),
                text=(f"{eq['name']}: {n} из {total_eq} внеплановых нарядов — один шифр {code}. "
                      f"Ремонт не устраняет причину: проверьте соосность, посадки и условия работы узла."),
            ))

    # ── 3. Поломки вскоре после ППР ──
    # Сравниваем частоту отказов в окне W дней после ППР с частотой вне этих окон
    # (для той же группы «участок + тип оборудования»).
    W = 3
    ppr = [o for o in orders if o["type"] == "planned"]
    groups = defaultdict(lambda: dict(units=set(), ppr=0, hit=0, in_win=0, total=0))
    for p in ppr:
        eq = equipment[p["equipment_id"]]
        g = groups[(eq["site_id"], eq["type"])]
        g["units"].add(p["equipment_id"])
        g["ppr"] += 1
        hits = [u for u in unpl if u["equipment_id"] == p["equipment_id"]
                and p["done_at"] < u["issued_at"] <= p["done_at"] + timedelta(days=W)]
        g["hit"] += bool(hits)
        g["in_win"] += len(hits)
    for u in unpl:
        eq = equipment[u["equipment_id"]]
        groups[(eq["site_id"], eq["type"])]["total"] += 1
    for (site_id, etype), g in groups.items():
        win_days = g["ppr"] * W
        out_days = len(g["units"]) * period_days - win_days
        rate_in = g["in_win"] / win_days
        rate_out = (g["total"] - g["in_win"]) / out_days if out_days > 0 else 0
        ratio = rate_in / rate_out if rate_out else float("inf")
        if g["hit"] >= 5 and ratio >= 2.5:
            share = g["hit"] / g["ppr"]
            findings.append(dict(
                kind="after_ppr", severity="high", site_id=site_id,
                facts=dict(equipment_type=etype, ppr=g["ppr"], failed_within_days=W, failed=g["hit"],
                           share=round(share, 2), ratio=round(ratio, 1)),
                text=(f"Участок «{sites[site_id]}», тип «{etype}»: после {g['hit']} из {g['ppr']} плановых ремонтов "
                      f"({share:.0%}) оборудование ломалось в течение {W} дней — в {ratio:.1f} раза чаще, чем в "
                      f"обычные дни. Сигнал о качестве ППР: проверьте технологию, запчасти и приёмку после ремонта."),
            ))

    # ── 4. Качество исполнителей: доработки и повторные поломки ≤7 дней ──
    stats = defaultdict(lambda: dict(n=0, rework=0, repeat=0, unpl=0))
    for o in orders:
        s = stats[o["assignee_id"]]
        s["n"] += 1
        s["rework"] += int(o["rework_count"]) > 0
        if o["type"] == "unplanned":
            s["unpl"] += 1
            s["repeat"] += any(u is not o and u["equipment_id"] == o["equipment_id"] and u["fault_code"] == o["fault_code"]
                               and o["done_at"] < u["issued_at"] <= o["done_at"] + timedelta(days=7) for u in unpl)
    tot_n = sum(s["n"] for s in stats.values())
    avg_rework = sum(s["rework"] for s in stats.values()) / tot_n
    avg_repeat = sum(s["repeat"] for s in stats.values()) / max(1, sum(s["unpl"] for s in stats.values()))
    for wid, s in stats.items():
        rw, rp = s["rework"] / s["n"], s["repeat"] / max(1, s["unpl"])
        if s["n"] >= 10 and (rw >= 2.5 * avg_rework or rp >= 2.5 * avg_repeat):
            name = short(employees[wid]["full_name"])
            findings.append(dict(
                kind="worker_quality", severity="medium", employee_id=wid,
                facts=dict(orders=s["n"], rework_rate=round(rw, 2), repeat_rate=round(rp, 2),
                           avg_rework=round(avg_rework, 2), avg_repeat=round(avg_repeat, 2)),
                text=(f"{name}: {rw:.0%} нарядов возвращались на доработку (в среднем {avg_rework:.0%}), "
                      f"после {rp:.0%} его ремонтов та же поломка повторялась в течение 7 дней "
                      f"(в среднем {avg_repeat:.0%}). Рекомендуем наставничество и контроль приёмки его нарядов."),
            ))

    # ── 5. Перерасход материалов (только позиции с нормой) ──
    def overuse(group_key):
        agg = defaultdict(lambda: [0.0, 0.0, 0])
        for o in unpl:
            n = norms.get(o["fault_code"], {})
            for mid, qty in writeoffs.get(o["id"], []):
                if mid in n:
                    a = agg[group_key(o)]
                    a[0] += qty; a[1] += n[mid]; a[2] += 1
        return {k: (v[0] / v[1], v[2]) for k, v in agg.items() if v[1] > 0}
    br = overuse(lambda o: o["brigade_id"])
    overall = statistics.median(r for r, _ in br.values())
    for b, (ratio, n) in sorted(br.items()):
        if ratio >= 1.25 and n >= 20:
            findings.append(dict(
                kind="material_overuse", severity="medium", brigade_id=b,
                facts=dict(ratio_to_norm=round(ratio, 2), positions=n, median_ratio=round(overall, 2)),
                text=(f"Бригада №{b}: списание материалов в {ratio:.2f} раза выше нормы по шифрам "
                      f"(у других бригад ≈{overall:.2f}). Рекомендуем сверить фактический расход со складом."),
            ))

    # ── 6. Рост внеплановых нарядов → прогноз отказа ──
    weeks = max(1, period_days // 7)
    for eq_id in equipment:
        series = [0] * weeks
        for o in unpl:
            if o["equipment_id"] == eq_id:
                w = min(weeks - 1, (o["issued_at"] - start).days // 7)
                series[w] += 1
        xs = range(weeks)
        mx, my = statistics.mean(xs), statistics.mean(series)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, series)) / sum((x - mx) ** 2 for x in xs)
        first, last = sum(series[:4]), sum(series[-4:])
        # Пуассоновский тест: насколько вероятно получить last отказов за 4 недели,
        # если бы единица ломалась с прежней частотой (недели до последних четырёх)
        prev = series[:-4]
        lam = max(0.5, sum(prev) / len(prev) * 4)
        p_value = 1 - sum(math.exp(-lam) * lam ** k / math.factorial(k) for k in range(last))
        if slope > 0 and last >= 5 and p_value < 0.005:
            nxt = max(0, my + slope * (weeks + 0.5 - mx)) * 2
            eq = equipment[eq_id]
            findings.append(dict(
                kind="rising_trend", severity="high", equipment_id=eq_id,
                facts=dict(weekly=series, slope=round(slope, 2), first4=first, last4=last, forecast_2w=round(nxt, 1)),
                text=(f"{eq['name']}: внеплановых нарядов за последние 4 недели {last} против {first} в первые 4 "
                      f"(рост ≈{slope:.2f} в неделю). Прогноз: ~{nxt:.0f} отказов в ближайшие 2 недели. "
                      f"Рекомендуем внеочередной осмотр и ППР до отказа."),
            ))

    print(f"Период: {start:%d.%m.%Y}–{end:%d.%m.%Y}, нарядов {len(orders)} (внеплановых {len(unpl)})\n")
    for f in findings:
        print(f"[{f['kind']}] {f['text']}\n")
    if args.json:
        Path(args.json).write_text(json.dumps(findings, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return findings


if __name__ == "__main__":
    main()
