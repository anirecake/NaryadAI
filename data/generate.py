"""
НарядAI — генератор тестовых данных (раздел 8 ТЗ).

Создаёт справочники и историю нарядов за 3 месяца (06.07–04.10.2026) с четырьмя
заложенными закономерностями, которые ИИ-аналитика должна найти на защите:

  1. Конвейер К-3 ломается ~в 3 раза чаще остальных, большинство поломок — М-02 (подшипник).
  2. Исполнитель Сапаров Д. — частые возвраты на доработку и повторные поломки в течение 7 дней.
  3. Насосы ГрАТ-450 на участке обогащения ломаются через 0,5–3 дня после планового ремонта (ППР).
  4. Бригада №3 списывает ~в 1,45 раза больше материалов нормы;
     плюс растущий тренд внеплановых нарядов на грохоте ГИТ-51 №1 (основа прогноза отказа).

Только стандартная библиотека Python. Запуск:  python data/generate.py
Результат: data/seed.sql (для Supabase) и data/csv/*.csv (для аналитики и проверки).
"""

import csv
import heapq
import json
import math
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # консоль Windows
random.seed(2026)
TZ = timezone(timedelta(hours=5))  # Костанай, UTC+5
START = datetime(2026, 7, 6, tzinfo=TZ)
DAYS = 91
OUT = Path(__file__).parent
NS = uuid.UUID("6f1c2b3a-0000-4000-8000-000000000000")

# ───────────── Справочники ─────────────

SITES = [
    (1, "Дробление", "Ұсақтау"),
    (2, "Обогащение", "Байыту"),
    (3, "Сушка и аспирация", "Кептіру және аспирация"),
    (4, "Ремонтно-механический цех", "Жөндеу-механикалық цех"),
]
BRIGADES = [(1, "Бригада №1"), (2, "Бригада №2"), (3, "Бригада №3")]

# id, название, инв. №, участок, тип, критичность
EQUIPMENT = [
    (1, "Дробилка КМД-1750", "ИН-10101", 1, "дробилка", 1),
    (2, "Дробилка ККД-1500", "ИН-10102", 1, "дробилка", 1),
    (3, "Питатель пластинчатый ПП-1", "ИН-10103", 1, "питатель", 2),
    (4, "Конвейер К-1", "ИН-10104", 1, "конвейер", 2),
    (5, "Конвейер К-2", "ИН-10105", 1, "конвейер", 2),
    (6, "Конвейер К-3", "ИН-10106", 1, "конвейер", 1),
    (7, "Грохот ГИТ-51 №1", "ИН-10107", 1, "грохот", 2),
    (8, "Грохот ГИТ-51 №2", "ИН-20101", 2, "грохот", 2),
    (9, "Насос ГрАТ-450 №1", "ИН-20102", 2, "насос", 1),
    (10, "Насос ГрАТ-450 №2", "ИН-20103", 2, "насос", 1),
    (11, "Насос ГрАТ-450 №3", "ИН-20104", 2, "насос", 2),
    (12, "Сепаратор пневматический СП-1", "ИН-20105", 2, "сепаратор", 2),
    (13, "Конвейер К-7", "ИН-20106", 2, "конвейер", 2),
    (14, "Вентилятор ВМ-12", "ИН-20107", 2, "вентилятор", 3),
    (15, "Сушильный барабан СБ-1", "ИН-30101", 3, "сушильный барабан", 1),
    (16, "Сушильный барабан СБ-2", "ИН-30102", 3, "сушильный барабан", 2),
    (17, "Рукавный фильтр РФ-1", "ИН-30103", 3, "фильтр", 1),
    (18, "Рукавный фильтр РФ-2", "ИН-30104", 3, "фильтр", 2),
    (19, "Дымосос ДН-15", "ИН-30105", 3, "дымосос", 2),
    (20, "Компрессор ВК-20", "ИН-30106", 3, "компрессор", 2),
    (21, "Токарный станок 1М63", "ИН-40101", 4, "станок", 3),
    (22, "Кран мостовой 10 т", "ИН-40102", 4, "кран", 2),
    (23, "Гидропресс П-6326", "ИН-40103", 4, "пресс", 3),
    (24, "Компрессор ВК-10", "ИН-40104", 4, "компрессор", 3),
    (25, "Сварочный пост СП-2", "ИН-40105", 4, "сварочное", 3),
]
EQ = {e[0]: e for e in EQUIPMENT}

# код, категория, название, специальность, норматив (ч)
FAULTS = [
    ("М-01", "М", "Износ футеровки/брони", "сварщик", 6),
    ("М-02", "М", "Износ/разрушение подшипника", "слесарь", 3),
    ("М-03", "М", "Порыв/износ конвейерной ленты", "слесарь", 4),
    ("М-04", "М", "Износ цепи/звёздочки", "слесарь", 3),
    ("М-05", "М", "Ослабление креплений, вибрация", "слесарь", 1.5),
    ("М-06", "М", "Износ рабочего колеса насоса", "слесарь", 4),
    ("Э-01", "Э", "Обрыв/повреждение кабеля", "электрик", 2),
    ("Э-02", "Э", "Неисправность электродвигателя", "электрик", 4),
    ("Э-03", "Э", "Срабатывание защиты/автомата", "электрик", 1),
    ("Э-04", "Э", "Неисправность датчика/КИП", "электрик", 1.5),
    ("Э-05", "Э", "Неисправность пускателя/контактора", "электрик", 1.5),
    ("Г-01", "Г", "Течь масла/гидрожидкости", "слесарь-гидравлик", 2),
    ("Г-02", "Г", "Неисправность гидроцилиндра", "слесарь-гидравлик", 4),
    ("Г-03", "Г", "Неисправность гидронасоса", "слесарь-гидравлик", 5),
    ("П-01", "П", "Утечка сжатого воздуха", "слесарь", 1),
    ("П-02", "П", "Неисправность пневмоцилиндра/клапана", "слесарь", 2),
    ("П-03", "П", "Неисправность компрессора", "слесарь", 4),
    ("С-01", "С", "Недостаток смазки, перегрев узла", "слесарь", 1),
    ("С-02", "С", "Загрязнение/обводнение масла", "слесарь", 1.5),
    ("С-03", "С", "Неисправность системы смазки", "слесарь", 3),
]
FAULT = {f[0]: f for f in FAULTS}

MATERIALS = [
    (1, "Подшипник 22220", "шт"), (2, "Подшипник 3182120", "шт"), (3, "Подшипник 6312", "шт"),
    (4, "Подшипник 22328", "шт"), (5, "Ремень клиновой Б-2000", "шт"), (6, "Лента конвейерная ЕР-400", "м"),
    (7, "Ролик конвейерный Ø108", "шт"), (8, "Клей для стыковки ленты", "кг"), (9, "Болт М16×60", "шт"),
    (10, "Болт М20×80", "шт"), (11, "Гайка М20", "шт"), (12, "Масло И-40А", "л"),
    (13, "Масло ТП-22С", "л"), (14, "Масло гидравлическое ВМГЗ", "л"), (15, "Смазка Литол-24", "кг"),
    (16, "Смазка солидол Ж", "кг"), (17, "Кабель КГ 3×16+1×6", "м"), (18, "Наконечник кабельный ТМЛ-16", "шт"),
    (19, "Изолента ПВХ", "шт"), (20, "Автоматический выключатель ВА47-63", "шт"), (21, "Пускатель ПМЛ-2100", "шт"),
    (22, "Контактор КТ-6023", "шт"), (23, "Датчик индуктивный ВБИ", "шт"), (24, "Термопара ТХА", "шт"),
    (25, "Предохранитель ППН-35", "шт"), (26, "Манжета армированная 100×125", "шт"),
    (27, "Сальниковая набивка АП-31", "кг"), (28, "Кольцо уплотнительное резиновое", "шт"),
    (29, "Рукав высокого давления РВД-16", "шт"), (30, "Фитинг гидравлический", "шт"),
    (31, "Ремкомплект пневмоцилиндра", "шт"), (32, "Клапан пневматический", "шт"),
    (33, "Рукав фильтровальный", "шт"), (34, "Плита футеровочная", "шт"),
    (35, "Колесо рабочее насоса ГрАТ", "шт"), (36, "Цепь приводная ПР-38", "м"),
    (37, "Звёздочка z=17", "шт"), (38, "Электроды МР-3 Ø4", "кг"), (39, "Ветошь обтирочная", "кг"),
    (40, "Герметик силиконовый", "шт"),
]

# Типовой расход по шифру: (материал, кол-во)
NORMS = {
    "М-01": [(34, 4), (38, 3), (10, 8), (39, 1)],
    "М-02": [(1, 1), (15, 0.5), (39, 0.5)],
    "М-03": [(6, 6), (8, 2), (39, 0.5)],
    "М-04": [(36, 3), (37, 1), (15, 0.3)],
    "М-05": [(9, 6), (10, 4), (11, 4)],
    "М-06": [(35, 1), (26, 1), (27, 0.5)],
    "Э-01": [(17, 10), (18, 4), (19, 1)],
    "Э-02": [(3, 2), (15, 0.3), (39, 0.5)],
    "Э-03": [(20, 1), (25, 2)],
    "Э-04": [(23, 1), (24, 1)],
    "Э-05": [(21, 1), (22, 1)],
    "Г-01": [(28, 4), (26, 1), (14, 10), (39, 1)],
    "Г-02": [(28, 4), (26, 2), (14, 5)],
    "Г-03": [(29, 2), (30, 4), (14, 20)],
    "П-01": [(30, 2), (40, 1), (28, 2)],
    "П-02": [(31, 1), (32, 1)],
    "П-03": [(5, 2), (12, 5), (28, 2)],
    "С-01": [(15, 1), (16, 1)],
    "С-02": [(12, 20), (13, 20), (39, 1)],
    "С-03": [(30, 2), (29, 1), (15, 2)],
}
PPR_MATERIALS = [(15, 1.5), (39, 1), (9, 4)]

# Какие неисправности типичны для типа оборудования
TYPE_FAULTS = {
    "конвейер": ["М-02", "М-03", "М-05", "Э-02", "Э-03", "С-01", "С-02"],
    "дробилка": ["М-01", "М-02", "М-05", "Г-01", "Э-02", "С-01", "С-03"],
    "питатель": ["М-04", "М-05", "М-02", "Э-02"],
    "грохот": ["М-02", "М-05", "Э-02", "С-01"],
    "насос": ["М-06", "М-02", "Г-01", "Э-02", "Э-03", "С-02"],
    "сепаратор": ["М-05", "Э-02", "Э-04", "П-01"],
    "вентилятор": ["М-02", "М-05", "Э-02", "С-01"],
    "дымосос": ["М-02", "М-05", "Э-02", "С-01"],
    "сушильный барабан": ["М-02", "М-05", "Э-02", "Э-04", "С-03"],
    "фильтр": ["П-01", "П-02", "Э-04", "М-05"],
    "компрессор": ["П-01", "П-03", "Э-02", "С-02"],
    "станок": ["Э-03", "Э-05", "М-05", "С-01"],
    "кран": ["Э-01", "Э-05", "М-04", "М-02"],
    "пресс": ["Г-01", "Г-02", "Г-03", "Э-05"],
    "сварочное": ["Э-01", "Э-03"],
}

TIME_NORMS = [
    ("ППР конвейера", "конвейер", 4), ("ППР дробилки", "дробилка", 8), ("ППР насоса", "насос", 4),
    ("ППР грохота", "грохот", 4), ("ППР сушильного барабана", "сушильный барабан", 6),
    ("ТО рукавного фильтра", "фильтр", 3), ("ТО компрессора", "компрессор", 2),
    ("ППР общего назначения", None, 3),
]

# ───────────── Сотрудники ─────────────
# Учётные записи для демо: data/demo_accounts.json (табельный № + ПИН).
STAFF = [
    ("1001", "Жуматов Серик Каиргалиевич", "мастер смены", None, None, "master", "А"),
    ("1002", "Ковалёв Андрей Петрович", "мастер смены", None, None, "master", "Б"),
    ("2001", "Абдрахманов Нурлан Сабитович", "главный механик", None, None, "manager", None),
    ("9001", "Сидорова Ольга Викторовна", "администратор", None, None, "admin", None),
]
WORKERS = [
    # таб, ФИО, специальность, разряд, бригада
    ("3001", "Ахметов Ерлан Болатович", "слесарь", 5, 1),
    ("3002", "Иванов Сергей Николаевич", "слесарь", 4, 1),
    ("3003", "Нурланов Арман Серикович", "электрик", 5, 1),
    ("3004", "Ким Виталий Олегович", "сварщик", 5, 1),
    ("3005", "Байжанов Канат Маратович", "слесарь-гидравлик", 4, 1),
    ("3006", "Петренко Олег Иванович", "слесарь", 5, 2),
    ("3007", "Сапаров Дамир Ерланович", "слесарь", 4, 2),   # ← закономерность №2
    ("3008", "Есенов Бауыржан Талгатович", "электрик", 4, 2),
    ("3009", "Морозов Денис Алексеевич", "слесарь", 3, 2),
    ("3010", "Тлеубаев Ержан Касымович", "электрик", 5, 2),
    ("3011", "Ли Александр Викторович", "слесарь", 4, 3),
    ("3012", "Жаксылыков Нуржан Ерикович", "слесарь-гидравлик", 5, 3),
    ("3013", "Волков Павел Сергеевич", "сварщик", 4, 3),
    ("3014", "Омаров Руслан Бекович", "электрик", 3, 3),
    ("3015", "Кузнецов Игорь Дмитриевич", "слесарь", 5, 3),
]
PROBLEM_WORKER = "3007"
OVERUSE_BRIGADE = 3
K3, TREND_SCREEN = 6, 7
PUMPS = (9, 10, 11)


def emp_id(tab):
    return str(uuid.uuid5(NS, tab))


def worker_by_tab(tab):
    return next(w for w in WORKERS if w[0] == tab)


# ───────────── Тексты ─────────────

PROBLEM_TEXT = {
    "М-01": ["Износ футеровки, стук в камере дробления", "Сколы брони, повышенная вибрация"],
    "М-02": ["Шум и нагрев подшипникового узла привода", "Вибрация, подшипник греется выше 80 °C"],
    "М-03": ["Порыв ленты на стыке", "Сход и износ кромки ленты"],
    "М-04": ["Проскальзывание цепи, износ звёздочки", "Растяжение приводной цепи"],
    "М-05": ["Вибрация, ослабли крепления рамы", "Стук, откручиваются болты опоры"],
    "М-06": ["Падение напора, шум в улитке насоса", "Снижение производительности насоса, вибрация"],
    "Э-01": ["Нет питания, повреждён кабель", "Пробой изоляции кабеля питания"],
    "Э-02": ["Двигатель не запускается, запах гари", "Перегрев электродвигателя, гул"],
    "Э-03": ["Выбивает автомат при пуске", "Срабатывает тепловая защита"],
    "Э-04": ["Нет сигнала с датчика положения", "Неверные показания температуры"],
    "Э-05": ["Не включается пускатель", "Залипание контактов контактора"],
    "Г-01": ["Течь масла из-под уплотнения", "Течь гидрожидкости, лужа под агрегатом"],
    "Г-02": ["Гидроцилиндр не держит давление", "Рывки штока гидроцилиндра"],
    "Г-03": ["Гидронасос не создаёт давление", "Шум и нагрев гидронасоса"],
    "П-01": ["Утечка воздуха, падение давления в сети", "Шипение на пневмолинии"],
    "П-02": ["Не срабатывает пневмоклапан встряхивания", "Пневмоцилиндр работает рывками"],
    "П-03": ["Компрессор не набирает давление", "Перегрев компрессора, выбивает защиту"],
    "С-01": ["Перегрев узла, сухое трение", "Узел работает без смазки"],
    "С-02": ["Масло в редукторе тёмное, с водой", "Загрязнение масла в картере"],
    "С-03": ["Не подаётся смазка на узлы", "Отказ станции централизованной смазки"],
}
WORK_TEXT = {
    "М-01": "Заменены футеровочные плиты, выполнена наплавка, проверено крепление",
    "М-02": "Заменён подшипник, узел промыт и смазан, проверено на холостом ходу",
    "М-03": "Выполнена стыковка ленты, отрегулирован ход",
    "М-04": "Заменены цепь и звёздочка, выполнено натяжение",
    "М-05": "Подтянуты и заменены крепления, проверена вибрация",
    "М-06": "Заменено рабочее колесо, уплотнения, насос опробован",
    "Э-01": "Заменён участок кабеля, выполнено оконцевание, проверена изоляция",
    "Э-02": "Заменены подшипники двигателя, проверены обмотки, пуск в норме",
    "Э-03": "Заменён автомат, проверена нагрузка, защита отрегулирована",
    "Э-04": "Заменён датчик, выполнена настройка и проверка сигнала",
    "Э-05": "Заменён пускатель/контактор, проверена схема управления",
    "Г-01": "Заменены уплотнения, долито масло, течь устранена",
    "Г-02": "Отремонтирован гидроцилиндр, заменены манжеты",
    "Г-03": "Заменены РВД и фитинги, гидронасос проверен под давлением",
    "П-01": "Устранена утечка, заменены фитинги и уплотнения",
    "П-02": "Заменён клапан, установлен ремкомплект пневмоцилиндра",
    "П-03": "Заменены ремни, масло, уплотнения, компрессор опробован",
    "С-01": "Узлы смазаны, проверен нагрев",
    "С-02": "Масло заменено, редуктор промыт",
    "С-03": "Восстановлена подача смазки, заменены РВД и фитинги",
}
PAUSE_REASONS = ["ждёт запчасти со склада", "ждёт остановки оборудования", "ждёт допуска"]
REJECT_REASONS = ["нет материалов", "нет допуска", "занят аварийным нарядом"]

# ───────────── Генерация ─────────────

orders, events, writeoffs, reviews = [], [], [], []
_oid = 0


def lognorm(mu=1.0, sigma=0.3):
    return mu * math.exp(random.gauss(0, sigma) - sigma ** 2 / 2)


def master_for(t):
    return emp_id("1001") if 8 <= t.hour < 20 else emp_id("1002")


def pick_worker(specialty, exclude=None):
    pool = [w for w in WORKERS if w[2] == specialty and w[0] != exclude]
    return random.choice(pool)


def add_event(oid, actor, action, frm, to, at, comment=None, reason=None):
    events.append(dict(order_id=oid, actor_id=actor, action=action, from_status=frm,
                       to_status=to, at=at, comment=comment, reason=reason))


def make_order(eq_id, issued, planned, code=None, forced_worker=None):
    """Полный жизненный цикл одного наряда до «Закрыт»."""
    global _oid
    _oid += 1
    oid = _oid
    eq = EQ[eq_id]
    master = master_for(issued)

    if planned:
        norm = next((h for n, t, h in TIME_NORMS if t == eq[4]), 3)
        specialty = "слесарь"
        priority = "planned"
        description = f"Плановый ремонт (ППР): {eq[1]} — осмотр, смазка, подтяжка креплений, замена изношенных элементов"
    else:
        code = code or random.choice(TYPE_FAULTS[eq[4]])
        norm = FAULT[code][4]
        specialty = FAULT[code][3]
        r = random.random()
        priority = ("emergency" if r < (0.45 if eq[5] == 1 else 0.25)
                    else "high" if r < 0.7 else "normal")
        description = random.choice(PROBLEM_TEXT[code])

    worker = worker_by_tab(forced_worker) if forced_worker else pick_worker(specialty)
    is_problem = worker[0] == PROBLEM_WORKER
    due = issued + timedelta(hours=norm * 1.3 + (0.25 if priority == "emergency" else random.uniform(1, 3)))

    add_event(oid, master, "issue", None, "issued", issued, description)
    t = issued

    # иногда отказ и переназначение
    if random.random() < 0.04:
        t += timedelta(minutes=random.uniform(2, 8))
        add_event(oid, emp_id(worker[0]), "reject", "issued", "rejected", t, reason=random.choice(REJECT_REASONS))
        worker = pick_worker(specialty, exclude=worker[0])
        is_problem = worker[0] == PROBLEM_WORKER
        t += timedelta(minutes=random.uniform(1, 5))
        add_event(oid, master, "reassign", "rejected", "issued", t)

    wid = emp_id(worker[0])
    queued = (not planned) and priority != "emergency" and random.random() < 0.12
    t += timedelta(minutes=random.uniform(1, 4) if priority == "emergency" else random.uniform(2, 15))
    accepted = t
    if queued:
        add_event(oid, wid, "queue", "issued", "queued", t)
        t += timedelta(minutes=random.uniform(20, 120))
        add_event(oid, wid, "start", "queued", "in_progress", t)
    else:
        add_event(oid, wid, "accept", "issued", "accepted", t)
        t += timedelta(minutes=random.uniform(2, 20))
        add_event(oid, wid, "start", "accepted", "in_progress", t)
    started = t

    dur = norm * lognorm(1.0, 0.3) * (1.15 if is_problem else 1.0)
    if random.random() < 0.1:
        t += timedelta(hours=dur * 0.4)
        add_event(oid, wid, "pause", "in_progress", "paused", t, reason=random.choice(PAUSE_REASONS))
        t += timedelta(minutes=random.uniform(30, 150))
        add_event(oid, wid, "start", "paused", "in_progress", t)
        t += timedelta(hours=dur * 0.6)
    else:
        t += timedelta(hours=dur)

    # материалы: бригада №3 систематически списывает больше (закономерность №4)
    brigade = worker[4]
    mats = PPR_MATERIALS if planned else NORMS[code]
    factor = random.uniform(1.3, 1.6) if brigade == OVERUSE_BRIGADE else random.uniform(0.85, 1.15)
    order_mats = []
    for mid, q in mats:
        if code == "М-02" and mid == 1:  # подшипник под конкретный узел
            mid = random.choice([1, 2, 4])
        qty = round(q * factor, 1) if q < 3 else max(1, round(q * factor))
        order_mats.append((mid, qty))

    work_done = (f"Выполнен ППР: {eq[1]} — осмотр, смазка узлов, подтяжка креплений"
                 if planned else WORK_TEXT[code])

    # ИИ-оценка и возврат на доработку (закономерность №2)
    base = random.gauss(3.3, 0.6) if is_problem else random.gauss(4.3, 0.4)
    rework = random.random() < (0.30 if is_problem else 0.04)
    if rework:
        add_event(oid, wid, "complete", "in_progress", "done", t, work_done)
        t += timedelta(minutes=random.uniform(1, 3))
        add_event(oid, None, "ai_verdict", "done", "rework", t,
                  reason="Работы не соответствуют проблеме / нет фото «после»")
        reviews.append(dict(order_id=oid, verdict="rework", score=round(min(max(base - 1.2, 1), 5), 2),
                            confidence=0.8, explanation="Требует доработки", created_at=t))
        t += timedelta(minutes=random.uniform(20, 60))
        add_event(oid, wid, "start", "rework", "in_progress", t)
        t += timedelta(hours=norm * 0.3)

    done = t
    add_event(oid, wid, "complete", "in_progress", "done", t, work_done)
    score = round(min(max(base, 1), 5), 2)
    verdict = "accepted" if score >= 4 else "accepted_with_remarks" if score >= 3 else "needs_master_review"
    t += timedelta(minutes=random.uniform(1, 3))
    add_event(oid, None, "ai_verdict", "done", "ai_review", t)
    reviews.append(dict(order_id=oid, verdict=verdict, score=score, confidence=round(random.uniform(0.7, 0.95), 2),
                        explanation="Работы соответствуют проблеме" if score >= 4 else "Есть замечания к качеству",
                        created_at=t))
    t += timedelta(minutes=random.uniform(10, 60))
    add_event(oid, master, "approve", "ai_review", "closed", t)

    for mid, qty in order_mats:
        writeoffs.append(dict(order_id=oid, material_id=mid, qty=qty))

    orders.append(dict(
        id=oid, number=oid, type="planned" if planned else "unplanned", priority=priority,
        description=description, site_id=eq[3], equipment_id=eq_id, assignee_id=wid,
        brigade_id=brigade, master_id=master, due_at=due, norm_hours=norm, status="closed",
        is_overdue=done > due, fault_code=None if planned else code, work_done=work_done,
        rework_count=1 if rework else 0, issued_at=issued, accepted_at=accepted, started_at=started,
        done_at=done, closed_at=t, worker_tab=worker[0],
    ))
    return dict(id=oid, done=done, code=code, worker=worker[0], eq=eq_id)


def rand_time(day):
    return START + timedelta(days=day, hours=random.uniform(0, 24))


plan = []  # (issued, kind, eq_id, extra)

# Плановые ремонты/ТО: еженедельно по каждой единице, со сдвигом
for eq_id in EQ:
    offset = random.randint(0, 6)
    for d in range(offset, DAYS, 7):
        plan.append((START + timedelta(days=d, hours=random.uniform(8, 10)), "ppr", eq_id, None))

# Внеплановые: базовый пуассоновский поток + закономерности
BASE_RATE = 0.075  # отказов в сутки на единицу
for day in range(DAYS):
    for eq_id, eq in EQ.items():
        lam = BASE_RATE * (1.3 if eq[5] == 1 else 1.0)
        if eq_id == K3:
            lam = 3.2 * BASE_RATE                             # №1: К-3 в ~3 раза чаще
        if eq_id == TREND_SCREEN:
            lam = 0.01 + 0.40 * (day / DAYS) ** 3             # №4: растущий тренд
        n = sum(1 for _ in range(4) if random.random() < lam / 4)
        for _ in range(n):
            code = None
            if eq_id == K3 and random.random() < 0.7:
                code = "М-02"                                 # №1: подшипник
            plan.append((rand_time(day), "unplanned", eq_id, code))

plan.sort(key=lambda p: p[0])

# Проход по времени; последствия (повторы, поломки после ППР) добавляются в очередь
queue = [(p[0], i, p) for i, p in enumerate(plan)]
heapq.heapify(queue)
counter = len(plan)
END = START + timedelta(days=DAYS)

while queue:
    issued, _, (__, kind, eq_id, code) = heapq.heappop(queue)
    if issued >= END:
        continue
    res = make_order(eq_id, issued, planned=(kind == "ppr"), code=code)

    # №3: насосы ломаются через 0,5–3 дня после ППР
    if kind == "ppr" and eq_id in PUMPS and random.random() < 0.5:
        t = res["done"] + timedelta(days=random.uniform(0.5, 3))
        counter += 1
        heapq.heappush(queue, (t, counter, (t, "unplanned", eq_id, random.choice(["М-06", "Г-01", "М-02"]))))

    # №2: после ремонта Сапарова — повторная поломка того же шифра в течение 7 дней
    if kind == "unplanned":
        p_repeat = 0.35 if res["worker"] == PROBLEM_WORKER else 0.04
        if random.random() < p_repeat:
            t = res["done"] + timedelta(days=random.uniform(1, 6))
            counter += 1
            heapq.heappush(queue, (t, counter, (t, "unplanned", eq_id, res["code"])))

# ───────────── Вывод ─────────────

(OUT / "csv").mkdir(exist_ok=True)


def iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def write_csv(name, rows, fields):
    with open(OUT / "csv" / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: iso(r.get(k)) for k in fields})


ORDER_FIELDS = ["id", "number", "type", "priority", "description", "site_id", "equipment_id", "assignee_id",
                "brigade_id", "master_id", "due_at", "norm_hours", "status", "is_overdue", "fault_code",
                "work_done", "rework_count", "issued_at", "accepted_at", "started_at", "done_at", "closed_at"]
EVENT_FIELDS = ["order_id", "actor_id", "action", "from_status", "to_status", "at", "comment", "reason"]

write_csv("orders", orders, ORDER_FIELDS)
write_csv("order_events", events, EVENT_FIELDS)
write_csv("material_writeoffs", writeoffs, ["order_id", "material_id", "qty"])
write_csv("ai_reviews", reviews, ["order_id", "verdict", "score", "confidence", "explanation", "created_at"])
write_csv("equipment", [dict(zip(["id", "name", "inv_no", "site_id", "type", "criticality"], e)) for e in EQUIPMENT],
          ["id", "name", "inv_no", "site_id", "type", "criticality"])
write_csv("employees", [dict(id=emp_id(w[0]), tab_no=w[0], full_name=w[1], specialty=w[2], grade=w[3], brigade_id=w[4])
                        for w in WORKERS], ["id", "tab_no", "full_name", "specialty", "grade", "brigade_id"])
write_csv("material_norms", [dict(fault_code=c, material_id=m, typical_qty=q) for c, l in NORMS.items() for m, q in l],
          ["fault_code", "material_id", "typical_qty"])
write_csv("materials", [dict(id=m[0], name=m[1], unit=m[2]) for m in MATERIALS], ["id", "name", "unit"])
write_csv("sites", [dict(id=s[0], name=s[1]) for s in SITES], ["id", "name"])


def sql_val(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


SEED_JSON = []  # те же строки в JSON — для загрузки через API (web/scripts/load-seed.mjs)


def inserts(table, cols, rows, batch=200):
    SEED_JSON.append(dict(table=table, rows=[
        {c: iso(r[c] if isinstance(r, dict) else r[j]) for j, c in enumerate(cols)} for r in rows]))
    out = []
    for i in range(0, len(rows), batch):
        vals = ",\n".join("(" + ", ".join(sql_val(r[c] if isinstance(r, dict) else r[j]) for j, c in enumerate(cols)) + ")"
                          for r in rows[i:i + batch])
        out.append(f"insert into {table} ({', '.join(cols)}) values\n{vals};")
    return "\n".join(out)


sql = ["-- НарядAI — тестовые данные. Сгенерировано data/generate.py. Не редактировать вручную.",
       "begin;",
       inserts("sites", ["id", "name", "name_kk"], SITES),
       inserts("brigades", ["id", "name"], BRIGADES),
       inserts("equipment", ["id", "name", "inv_no", "site_id", "type", "criticality", "qr_code"],
               [e + (f"NARAD:EQ:{e[0]}",) for e in EQUIPMENT]),
       inserts("employees", ["id", "tab_no", "full_name", "specialty", "grade", "brigade_id", "role", "shift", "on_shift"],
               [(emp_id(s[0]), s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[5] == "master") for s in STAFF] +
               [(emp_id(w[0]), w[0], w[1], w[2], w[3], w[4], "worker", "А" if w[4] != 2 else "Б", w[4] != 2)
                for w in WORKERS]),
       inserts("fault_codes", ["code", "category", "name", "specialty", "norm_hours"], FAULTS),
       inserts("materials", ["id", "name", "unit"], MATERIALS),
       inserts("material_norms", ["fault_code", "material_id", "typical_qty"],
               [(c, m, q) for c, l in NORMS.items() for m, q in l]),
       inserts("time_norms", ["work_name", "equipment_type", "hours"], TIME_NORMS),
       inserts("orders", ORDER_FIELDS, orders),
       inserts("order_events", EVENT_FIELDS, events),
       inserts("material_writeoffs", ["order_id", "material_id", "qty"], writeoffs),
       inserts("ai_reviews", ["order_id", "verdict", "score", "confidence", "explanation", "created_at"], reviews),
       "select setval('sites_id_seq', (select max(id) from sites));",
       "select setval('brigades_id_seq', (select max(id) from brigades));",
       "select setval('equipment_id_seq', (select max(id) from equipment));",
       "select setval('materials_id_seq', (select max(id) from materials));",
       "select setval('orders_id_seq', (select max(id) from orders));",
       "select setval('order_number_seq', (select max(number) from orders));",
       "commit;"]
(OUT / "seed.sql").write_text("\n\n".join(sql), encoding="utf-8")
(OUT / "seed.json").write_text(json.dumps(SEED_JSON, ensure_ascii=False), encoding="utf-8")

# Демо-учётки (тестовые ПИН-коды только для стенда хакатона)
accounts = [dict(tab_no=s[0], full_name=s[1], role=s[5], pin={"master": "111111", "manager": "222222",
             "admin": "999999"}[s[5]]) for s in STAFF] + \
           [dict(tab_no=w[0], full_name=w[1], role="worker", pin="333333") for w in WORKERS]
(OUT / "demo_accounts.json").write_text(json.dumps(accounts, ensure_ascii=False, indent=2), encoding="utf-8")

unpl = sum(o["type"] == "unplanned" for o in orders)
print(f"Нарядов: {len(orders)} (внеплановых {unpl}, плановых {len(orders) - unpl}); "
      f"событий: {len(events)}; списаний: {len(writeoffs)}; оценок ИИ: {len(reviews)}")
