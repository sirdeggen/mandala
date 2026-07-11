import { PopoverSelect, type SelectOption } from './PopoverSelect'

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
  const options: SelectOption<number | 'all'>[] = [
    { value: 'all', label: 'All years' },
    ...years.map(y => ({ value: y, label: String(y) })),
  ]
  return <PopoverSelect value={value} options={options} onChange={onChange} className={className ?? 'w-auto'} />
}
