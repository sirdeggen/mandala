/**
 * Client-side export helpers. Reports are modelled as a simple { columns, rows }
 * table and can be serialised to CSV or a spreadsheet (an Excel-readable HTML
 * table saved as .xls - avoids a heavy xlsx dependency while still opening
 * natively in Excel / Google Sheets / Numbers).
 */
export interface ReportTable {
  columns: string[]
  rows: string[][]
}

export type ExportFormat = 'csv' | 'xls' | 'pdf'

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  csv: 'CSV',
  xls: '.xls',
  pdf: 'PDF',
}

export interface ReportSection {
  title: string
  table: ReportTable
}

function toCSV(table: ReportTable): string {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [table.columns, ...table.rows].map(r => r.map(esc).join(',')).join('\r\n')
}

function escapeHtml(v: string): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toExcelHtml(title: string, table: ReportTable): string {
  const head = `<tr>${table.columns.map(c => `<th style="background:#f2f2f2;text-align:left">${escapeHtml(c)}</th>`).join('')}</tr>`
  const body = table.rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><table border="1" cellspacing="0">${head}${body}</table></body></html>`
}

function triggerDownload(filename: string, mime: string, content: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Sanitise a label into a filename stem. */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export'
}

function tableHtml(table: ReportTable): string {
  const head = `<tr>${table.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`
  const body = table.rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
  return `<table>${head}${body}</table>`
}

/** Open a print-ready window for the given sections; the browser's print dialog
 *  produces the PDF ("Save as PDF"). User-initiated, so not popup-blocked. */
function printSections(title: string, sections: ReportSection[]): void {
  if (typeof window === 'undefined') return
  const w = window.open('', '_blank', 'noopener,noreferrer')
  if (w == null) return
  const style = `<style>
    *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;margin:0;padding:28px}
    h1{font-size:20px;margin:0 0 4px} .meta{color:#666;font-size:12px;margin-bottom:16px}
    h3{font-size:13px;margin:22px 0 6px;color:#333}
    table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:4px}
    th,td{border:1px solid #ddd;padding:5px 7px;text-align:left;vertical-align:top}
    th{background:#f4f4f5;font-weight:600}
    @media print{@page{margin:16mm}}
  </style>`
  const body = sections.map(s => `<h3>${escapeHtml(s.title)}</h3>${tableHtml(s.table)}`).join('')
  const now = new Date().toLocaleString('en-GB')
  w.document.write(`<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${style}</head><body><h1>${escapeHtml(title)}</h1><div class="meta">Generated ${escapeHtml(now)}</div>${body}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch { /* ignore */ } }, 300)
}

/** Download a report in the given format (PDF opens a print-to-PDF window). */
export function exportReport(name: string, format: ExportFormat, table: ReportTable): void {
  const stem = slugify(name)
  if (format === 'csv') {
    triggerDownload(`${stem}.csv`, 'text/csv;charset=utf-8', toCSV(table))
  } else if (format === 'xls') {
    triggerDownload(`${stem}.xls`, 'application/vnd.ms-excel', toExcelHtml(name, table))
  } else {
    printSections(name, [{ title: name, table }])
  }
}

/** Download several report sections as a single file (CSV sections, or a
 *  multi-table .xls workbook-style document). */
export function exportBundle(name: string, format: ExportFormat, sections: ReportSection[]): void {
  const stem = slugify(name)
  if (format === 'pdf') {
    printSections(name, sections)
  } else if (format === 'csv') {
    const body = sections.map(s => `# ${s.title}\r\n${toCSV(s.table)}`).join('\r\n\r\n')
    triggerDownload(`${stem}.csv`, 'text/csv;charset=utf-8', body)
  } else {
    const tables = sections.map(s => `<h3>${escapeHtml(s.title)}</h3><table border="1" cellspacing="0">${
      `<tr>${s.table.columns.map(c => `<th style="background:#f2f2f2;text-align:left">${escapeHtml(c)}</th>`).join('')}</tr>`
    }${s.table.rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`).join('<br/>')
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>${escapeHtml(name)}</title></head><body>${tables}</body></html>`
    triggerDownload(`${stem}.xls`, 'application/vnd.ms-excel', doc)
  }
}
