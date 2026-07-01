import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { Select } from '../ui/select'
import { AdminAsset } from '../../lib/mandala/assets'
import { resolveAdminHistory, describeAction, exportAdminHistoryCsv, AdminHistoryRow } from '../../lib/mandala/adminHistory'

interface Props {
  assets?: AdminAsset[]
  /** Controlled mode: when set, use this assetId and suppress the internal asset selector. */
  assetId?: string
}

export default function AuditLog({ assets = [], assetId: controlledAssetId }: Props) {
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [rows, setRows] = useState<AdminHistoryRow[]>([])
  const [loading, setLoading] = useState(false)

  // In controlled mode the active asset is the prop; otherwise use internal state
  const activeAssetId = controlledAssetId ?? selectedAssetId

  const load = useCallback(async () => {
    if (activeAssetId === '') { setRows([]); return }
    setLoading(true)
    try {
      const history = await resolveAdminHistory(activeAssetId)
      setRows(history)
    } finally {
      setLoading(false)
    }
  }, [activeAssetId])

  useEffect(() => { void load() }, [load])

  const handleExport = () => {
    const csv = exportAdminHistoryCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const label = assets.find(a => a.assetId === activeAssetId)?.label ?? activeAssetId
    a.download = `audit-log-${label.replace(/\s+/g, '-')}-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* Page heading — only shown in standalone (uncontrolled) mode */}
      {controlledAssetId == null && (
        <div className="mb-[18px]">
          <h1 className="text-[27px] font-semibold tracking-[-0.5px] leading-tight">Audit log</h1>
          <p className="text-[13px] text-muted-foreground mt-[3px]">Full admin action history per asset</p>
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-[10px] flex-wrap mb-[18px]">
        {/* Asset selector — suppressed in controlled mode */}
        {controlledAssetId == null && (
          <Select
            id="al-asset"
            value={selectedAssetId}
            onChange={e => setSelectedAssetId(e.target.value)}
            className="w-auto text-[13px] rounded-full px-3 py-1.5 h-auto"
          >
            <option value="">Select asset…</option>
            {assets.map(a => (
              <option key={a.assetId} value={a.assetId}>{a.label}</option>
            ))}
          </Select>
        )}

        <button
          className="grid place-items-center w-9 h-9 rounded-[10px] bg-card border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          onClick={() => void load()}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>

        {rows.length > 0 && (
          <button
            className="flex items-center gap-[7px] bg-card border border-border rounded-[10px] px-[14px] py-[9px] text-[12.5px] font-semibold text-primary"
            onClick={handleExport}
          >
            <Download size={14} />
            Export CSV
          </button>
        )}
      </div>

      {/* States */}
      {activeAssetId !== '' && loading && (
        <p className="text-[13px] text-muted-foreground animate-pulse">Loading history…</p>
      )}
      {activeAssetId !== '' && !loading && rows.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No admin actions recorded yet.</p>
      )}

      {/* Rows card */}
      {rows.length > 0 && (
        <div className="bg-card border border-border rounded-[14px] overflow-hidden">
          {rows.map((row, i) => (
            <div
              key={`${row.txid}-${row.outputIndex}-${i}`}
              className="flex items-start gap-3 px-[18px] py-[14px] border-b border-separator last:border-b-0"
            >
              {/* Kind badge */}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold shrink-0 mt-px">
                {row.actionDetails.kind}
              </span>
              {/* Description */}
              <span className="flex-1 text-[13px] text-foreground">
                {describeAction(row.actionDetails)}
              </span>
              {/* Block height */}
              <span className="text-[12px] text-subtle-foreground tabular-nums shrink-0">
                {row.height > 0 ? row.height : '—'}
              </span>
              {/* Txid link */}
              <a
                href={`https://whatsonchain.com/tx/${row.txid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-subtle-foreground underline-offset-2 hover:underline font-mono shrink-0"
                title={row.txid}
              >
                {row.txid.slice(0, 10)}…
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
