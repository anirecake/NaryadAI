-- НарядAI — схема БД (Supabase / PostgreSQL 15+)
-- Порядок: 0001_schema.sql → 0002_logic.sql → 0003_security.sql → data/seed.sql

-- ───────────── Перечисления ─────────────

-- 10 статусов со схемы ТЗ + служебный «cancelled» (мастер отменил, п. 5.1.5).
-- «Просрочен» — не статус, а флаг orders.is_overdue.
create type order_status as enum (
  'issued',       -- Выдан
  'accepted',     -- Принят в работу
  'queued',       -- В очереди
  'rejected',     -- Отклонён (с причиной) → мастер переназначает
  'in_progress',  -- В работе
  'paused',       -- Приостановлен (с причиной)
  'done',         -- Исполнено (фото, работы, ТМЦ)
  'ai_review',    -- Проверка ИИ (оценка и отчёт готовы, ждёт мастера)
  'rework',       -- На доработку
  'closed',       -- Закрыт (мастер подтвердил)
  'cancelled'     -- Отменён мастером
);

create type order_type     as enum ('planned', 'unplanned');
create type order_priority as enum ('emergency', 'high', 'normal', 'planned');
create type employee_role  as enum ('master', 'worker', 'manager', 'admin');
create type photo_kind     as enum ('before', 'after');
create type ai_verdict     as enum ('accepted', 'accepted_with_remarks', 'rework', 'needs_master_review');

-- ───────────── Справочники ─────────────

create table sites (
  id       serial primary key,
  name     text not null unique,
  name_kk  text
);

create table brigades (
  id    serial primary key,
  name  text not null unique
);

create table equipment (
  id           serial primary key,
  name         text not null,
  inv_no       text not null unique,
  site_id      int  not null references sites(id),
  type         text not null,              -- конвейер, насос, дробилка…
  criticality  smallint not null default 2 check (criticality between 1 and 3), -- 1 — критичное
  qr_code      text unique                 -- содержимое QR на шильдике
);
create index on equipment(site_id);

create table employees (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid unique references auth.users(id) on delete set null,
  tab_no            text not null unique,  -- табельный номер = логин
  full_name         text not null,
  specialty         text not null,         -- слесарь, электрик, сварщик, слесарь-гидравлик, мастер…
  grade             smallint,              -- разряд
  brigade_id        int references brigades(id),
  role              employee_role not null,
  shift             text,                  -- 'А' / 'Б'
  on_shift          boolean not null default false,
  telegram_chat_id  bigint unique,
  created_at        timestamptz not null default now()
);

-- Шифры неисправностей: М — механика, Э — электрика, Г — гидравлика, П — пневматика, С — смазка
create table fault_codes (
  code        text primary key,            -- 'М-02'
  category    text not null check (category in ('М','Э','Г','П','С')),
  name        text not null,
  specialty   text not null,               -- кто обычно устраняет
  norm_hours  numeric(5,2) not null        -- норматив времени
);

create table materials (
  id        serial primary key,
  name      text not null unique,
  unit      text not null                  -- шт, м, кг, л
);

-- Типовой расход материалов по шифру — для ИИ-проверки «логичности материалов»
create table material_norms (
  fault_code   text references fault_codes(code),
  material_id  int  references materials(id),
  typical_qty  numeric(10,2) not null,
  primary key (fault_code, material_id)
);

-- Нормативы на типовые плановые работы (ППР, ТО)
create table time_norms (
  id              serial primary key,
  work_name       text not null,
  equipment_type  text,
  hours           numeric(5,2) not null
);

-- Пороги ИИ-контроля сроков (настраиваемые, п. 6.1)
create table settings (
  key    text primary key,
  value  numeric not null,
  note   text
);
insert into settings(key, value, note) values
  ('remind_before_min',            30, 'Напоминание исполнителю за N минут до срока'),
  ('accept_timeout_min',           10, 'Эскалация мастеру, если наряд не принят за N минут'),
  ('emergency_accept_timeout_min',  3, 'То же для аварийного наряда'),
  ('repeat_interval_min',          15, 'Повтор напоминания о просрочке'),
  ('manager_escalation_min',       60, 'Просрочка дольше N минут → уведомление руководителю');

-- ───────────── Наряды ─────────────

create sequence order_number_seq start 1;

create table orders (
  id                  bigserial primary key,
  number              int not null unique default nextval('order_number_seq'),
  type                order_type not null,
  priority            order_priority not null,
  description         text not null,
  site_id             int not null references sites(id),
  equipment_id        int not null references equipment(id),
  assignee_id         uuid references employees(id),
  brigade_id          int references brigades(id),
  master_id           uuid not null references employees(id),
  due_at              timestamptz not null,
  norm_hours          numeric(5,2),
  status              order_status not null default 'issued',
  is_overdue          boolean not null default false,
  queue_pos           int,
  comment             text,
  -- заполняется при закрытии
  fault_code          text references fault_codes(code),
  work_done           text,
  close_comment       text,
  rework_count        int not null default 0,
  last_comment        text,
  -- времена переходов (полная история — в order_events)
  issued_at           timestamptz not null default now(),
  accepted_at         timestamptz,
  started_at          timestamptz,
  done_at             timestamptz,
  closed_at           timestamptz,
  -- служебные отметки ИИ-контроля сроков (чтобы не слать дубли)
  reminded_at         timestamptz,
  overdue_notified_at timestamptz,
  accept_escalated_at timestamptz,
  manager_notified_at timestamptz
);
create index on orders(status);
create index on orders(assignee_id, status);
create index on orders(equipment_id, issued_at);
create index on orders(due_at) where status not in ('closed','cancelled');

-- Журнал: каждое действие — кто, что, когда (п. 5.5)
create table order_events (
  id           bigserial primary key,
  order_id     bigint not null references orders(id) on delete cascade,
  actor_id     uuid references employees(id),  -- null = система / ИИ
  action       text not null,                  -- issue, accept, queue, reject, start, pause, complete, ai_verdict, approve, return, cancel, reassign, priority
  from_status  order_status,
  to_status    order_status,
  comment      text,
  reason       text,
  at           timestamptz not null default now()
);
create index on order_events(order_id, at);

create table photos (
  id            bigserial primary key,
  order_id      bigint not null references orders(id) on delete cascade,
  kind          photo_kind not null,
  storage_path  text not null,
  taken_at      timestamptz,                    -- из камеры/EXIF
  uploaded_at   timestamptz not null default now(), -- фиксирует сервер
  author_id     uuid references employees(id),
  phash         text                            -- перцептивный хэш для поиска повторов
);
create index on photos(order_id);
create index on photos(phash);

create table material_writeoffs (
  id           bigserial primary key,
  order_id     bigint not null references orders(id) on delete cascade,
  material_id  int not null references materials(id),
  qty          numeric(10,2) not null check (qty > 0)
);
create index on material_writeoffs(order_id);

create table ai_reviews (
  id              bigserial primary key,
  order_id        bigint not null references orders(id) on delete cascade,
  verdict         ai_verdict not null,
  score           numeric(4,2) check (score between 1 and 5),
  confidence      numeric(3,2) check (confidence between 0 and 1),
  explanation     text,
  checks          jsonb,          -- результаты по пунктам: полнота, соответствие, материалы, время, фото
  worker_report   text,           -- отчёт исполнителю
  master_report   text,           -- отчёт мастеру
  master_score    numeric(4,2),   -- если мастер изменил оценку
  master_comment  text,
  created_at      timestamptz not null default now()
);
create index on ai_reviews(order_id);

-- Уведомления (ИИ-контроль сроков, новые наряды). Отправку в Telegram делает Edge Function.
create table notifications (
  id           bigserial primary key,
  employee_id  uuid not null references employees(id),
  order_id     bigint references orders(id) on delete cascade,
  kind         text not null,     -- new_order, remind, overdue, accept_timeout, manager_overdue, verdict
  text         text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  sent_tg_at   timestamptz
);
create index on notifications(employee_id, created_at desc);
create index on notifications(created_at) where sent_tg_at is null;
