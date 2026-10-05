import { useState } from 'react'

// Простые SVG-графики без библиотек. Палитра проверена валидатором (CVD/контраст, светлая и тёмная тема):
// --series-1 синий (плановые), --series-2 оранжевый (внеплановые).

interface Bar { label: string; value: number; note?: string }

// Горизонтальные полосы: одна серия, величина — длина, подпись значения текстом
export function HBars({ data, unit = '', max }: { data: Bar[]; unit?: string; max?: number }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="hbars" role="table">
      {data.map((d) => (
        <div key={d.label} className="hbar" role="row" title={`${d.label}: ${d.value}${unit}${d.note ? ' · ' + d.note : ''}`}>
          <span className="hbar-label" role="cell">{d.label}</span>
          <span className="hbar-track" role="cell">
            <span className="hbar-fill" style={{ width: `${(d.value / top) * 100}%` }} />
          </span>
          <span className="hbar-value" role="cell">{d.value}{unit}</span>
        </div>
      ))}
    </div>
  )
}

// Недельная динамика: плановые + внеплановые, столбцы с накоплением, подсказка при наведении
export function WeeklyStack({ data }: { data: { week: string; planned: number; unplanned: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 200, pad = { l: 28, r: 8, t: 10, b: 24 }
  const max = Math.max(1, ...data.map((d) => d.planned + d.unplanned))
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length)
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const ticks = [0, Math.round(max / 2), max]
  return (
    <figure className="chart">
      <div className="legend">
        <span><i className="sw s1" />Плановые</span>
        <span><i className="sw s2" />Внеплановые</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Наряды по неделям: плановые и внеплановые">
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} className="grid" />
            <text x={pad.l - 4} y={y(tk) + 4} className="axis" textAnchor="end">{tk}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + 2, w = Math.max(2, bw - 4)
          const yU = y(d.unplanned), yP = y(d.unplanned + d.planned)
          return (
            <g key={d.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <rect x={x} y={yU} width={w} height={Math.max(0, H - pad.b - yU)} className="s2" />
              <rect x={x} y={yP} width={w} height={Math.max(0, yU - yP - 2)} rx={3} className="s1" />
              {i % 2 === 0 && <text x={x + w / 2} y={H - 8} className="axis" textAnchor="middle">{d.week.slice(5)}</text>}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="tip">
          Неделя с {data[hover].week}: плановых {data[hover].planned}, внеплановых {data[hover].unplanned}
        </div>
      )}
    </figure>
  )
}
