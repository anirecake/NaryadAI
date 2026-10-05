import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Order } from '../lib/domain'
import { hhmm } from '../lib/format'
import { useI18n } from '../lib/i18n'

export function OrderCard({ order, showAssignee, children, href }: { order: Order; showAssignee?: boolean; children?: ReactNode; href?: string }) {
  const { t } = useI18n()
  const overdue = (order.is_overdue || new Date(order.due_at) < new Date()) && !['done', 'ai_review', 'closed', 'cancelled'].includes(order.status)
  const body = (
    <>
      <div className="order-head">
        <strong>№{order.number}</strong>
        <span className={`badge prio-${order.priority}`}>{t(`priority.${order.priority}`)}</span>
        <span className={`badge st-${order.status}`}>{t(`status.${order.status}`)}</span>
      </div>
      <div className="order-eq">{order.equipment?.name}</div>
      <div className="order-desc">{order.description}</div>
      <div className="order-meta muted">
        {showAssignee && order.assignee && <span>{order.assignee.full_name}</span>}
        <span className={overdue ? 'error' : ''}>
          {overdue ? t('worker.overdue') : t('worker.due')}: {hhmm(order.due_at)}
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
