import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Order, OrderStatus } from '../lib/domain'
import { hhmm } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { Icon } from './Icon'

// Шаг наряда для шкалы: Выдан → Принят → В работе → Проверка → Закрыт
const STEP: Record<OrderStatus, number> = {
  issued: 1, rejected: 1, accepted: 2, queued: 2, in_progress: 3, paused: 3, rework: 3,
  done: 4, ai_review: 4, closed: 5, cancelled: 0,
}

export function isOverdue(o: Pick<Order, 'is_overdue' | 'due_at' | 'status'>) {
  return (o.is_overdue || new Date(o.due_at) < new Date()) && !['done', 'ai_review', 'closed', 'cancelled'].includes(o.status)
}

export function Steps({ status }: { status: OrderStatus }) {
  const { t } = useI18n()
  const s = STEP[status]
  const bad = status === 'rework' || status === 'rejected'
  return (
    <div aria-label={t(`status.${status}`)}>
      <div className="steps">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= s ? (bad && i === s ? 'warn' : 'on') : ''} />)}</div>
    </div>
  )
}

export function OrderCard({ order, showAssignee, children, href }: { order: Order; showAssignee?: boolean; children?: ReactNode; href?: string }) {
  const { t } = useI18n()
  const overdue = isOverdue(order)
  const body = (
    <>
      <div className="order-head">
        <span className="order-num">№{order.number}</span>
        {order.priority === 'emergency' || order.priority === 'high'
          ? <span className={`badge prio-${order.priority}`}>{t(`priority.${order.priority}`)}</span> : null}
        <span className={`badge st-${order.status}`}>{t(`status.${order.status}`)}</span>
      </div>
      <div className="order-eq">{order.equipment?.name}</div>
      <div className="order-desc">{order.description}</div>
      <Steps status={order.status} />
      <div className="order-meta">
        {showAssignee && order.assignee && <span><Icon name="user" size={15} />{order.assignee.full_name.split(' ').slice(0, 2).join(' ')}</span>}
        <span className={overdue ? 'due' : ''}>
          <Icon name={overdue ? 'alert' : 'clock'} size={15} />
          {overdue ? `${t('worker.overdue')} · ${hhmm(order.due_at)}` : `${t('worker.due')} ${hhmm(order.due_at)}`}
        </span>
      </div>
    </>
  )
  return (
    <article className={`card order prio-${order.priority}${overdue ? ' overdue' : ''}`}>
      {href ? <Link to={href} className="order-link">{body}</Link> : body}
      {children}
    </article>
  )
}
