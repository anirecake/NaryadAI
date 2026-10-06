// Доменные типы и правила — зеркало supabase/migrations (менять синхронно с SQL)

export type OrderStatus =
  | 'issued' | 'accepted' | 'queued' | 'rejected' | 'in_progress' | 'paused'
  | 'done' | 'ai_review' | 'rework' | 'closed' | 'cancelled'
export type Priority = 'emergency' | 'high' | 'normal' | 'planned'
export type Role = 'master' | 'worker' | 'manager' | 'admin'
export type LiveStatus = 'free' | 'busy' | 'queue' | 'off_shift'
export type WorkerAction = 'accept' | 'queue' | 'reject' | 'start' | 'pause' | 'complete'

export interface Employee {
  id: string
  tab_no: string
  full_name: string
  specialty: string
  grade: number | null
  brigade_id: number | null
  role: Role
  on_shift: boolean
}

export interface LiveEmployee extends Employee {
  live_status: LiveStatus
  current_order_number: number | null
  queue_count: number
}

export interface Order {
  id: number
  number: number
  type: 'planned' | 'unplanned'
  priority: Priority
  description: string
  site_id: number
  equipment_id: number
  assignee_id: string | null
  master_id: string
  due_at: string
  status: OrderStatus
  is_overdue: boolean
  queue_pos: number | null
  last_comment: string | null
  issued_at: string
  started_at: string | null
  equipment?: { name: string } | null
  assignee?: { full_name: string } | null
}

// Колонки канбана мастера (п. 5.2.2)
export const BOARD_COLUMNS: { key: string; statuses: OrderStatus[] }[] = [
  { key: 'col.issued', statuses: ['issued', 'rejected'] },
  { key: 'col.accepted', statuses: ['accepted'] },
  { key: 'col.in_progress', statuses: ['in_progress', 'paused', 'rework'] },
  { key: 'col.queued', statuses: ['queued'] },
  { key: 'col.done', statuses: ['done', 'ai_review'] },
]
export const OPEN_STATUSES: OrderStatus[] = ['issued', 'accepted', 'queued', 'rejected', 'in_progress', 'paused', 'rework', 'done', 'ai_review']

// Какие кнопки видит исполнитель в каждом статусе (машина состояний из 0002_logic.sql)
export const WORKER_ACTIONS: Record<OrderStatus, WorkerAction[]> = {
  issued: ['accept', 'queue', 'reject'],
  accepted: ['start', 'reject'],
  queued: ['start', 'reject'],
  in_progress: ['complete', 'pause'],
  paused: ['start'],
  rework: ['start'],
  rejected: [], done: [], ai_review: [], closed: [], cancelled: [],
}
export const NEEDS_REASON: WorkerAction[] = ['reject', 'pause']

export const REASONS: Record<'reject' | 'pause', string[]> = {
  reject: ['reason.no_materials', 'reason.no_permit', 'reason.busy_emergency'],
  pause: ['reason.wait_parts', 'reason.wait_stop', 'reason.wait_permit'],
}

export const PRIORITY_ORDER: Priority[] = ['emergency', 'high', 'normal', 'planned']

// Наряд с названием оборудования и ФИО исполнителя (у orders два FK на employees — указываем явно)
export const ORDER_SELECT = '*, equipment(name), assignee:employees!orders_assignee_id_fkey(full_name)'

// Главная кнопка исполнителя — следующий шаг; остальные действия показываются мельче
export const PRIMARY_ACTION: Partial<Record<OrderStatus, WorkerAction>> = {
  issued: 'accept', accepted: 'start', queued: 'start', in_progress: 'complete', paused: 'start', rework: 'start',
}
