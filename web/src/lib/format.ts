export const hhmm = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'

export const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export const hoursBetween = (a: string | null, b: string | null) =>
  a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000 : null

export const fmt1 = (x: number | null | undefined) => (x == null ? '—' : Number(x).toLocaleString('ru-RU', { maximumFractionDigits: 1 }))

// Выгрузка в Excel: CSV с «;» и BOM — Excel в русской локали открывает его как таблицу
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `${name}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// Периоды отчётов (п. 7): смена, сутки, неделя, месяц
export type PeriodKey = 'shift' | 'day' | 'week' | 'month' | 'quarter'
export function periodRange(key: PeriodKey): { from: string; to: string } {
  const now = new Date()
  const to = new Date(now.getTime() + 60_000)
  const from = new Date(now)
  if (key === 'shift') {
    // дневная смена 08:00–20:00, ночная 20:00–08:00
    const h = now.getHours()
    from.setMinutes(0, 0, 0)
    if (h >= 8 && h < 20) from.setHours(8)
    else { if (h < 8) from.setDate(from.getDate() - 1); from.setHours(20) }
  } else {
    from.setDate(from.getDate() - { day: 1, week: 7, month: 30, quarter: 92 }[key])
  }
  return { from: from.toISOString(), to: to.toISOString() }
}
