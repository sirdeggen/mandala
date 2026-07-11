import { Select } from '../ui/select'

/** Distinct calendar years present in a set of ISO date strings, newest first. */
export function availableYears(isos: (string | undefined)[]): number[] {
  const set = new Set<number>()
  for (const iso of isos) {
    if (iso == null || iso === '') continue
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) set.add(d.getFullYear())
  }
  return [...set].sort((a, b) => b - a)
}

/** "All years" + discrete-year picker used across the export surfaces. */
export function YearSelect({ value, years, onChange, className }: {
  value: number | 'all'
  years: number[]
  onChange: (v: number | 'all') => void
  className?: string
}) {
  return (
    <Select
      value={value === 'all' ? 'all' : String(value)}
      onChange={e => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
      className={className ?? 'h-9 w-auto rounded-md text-[13px]'}
    >
      <option value="all">All years</option>
      {years.map(y => <option key={y} value={y}>{y}</option>)}
    </Select>
  )
}
