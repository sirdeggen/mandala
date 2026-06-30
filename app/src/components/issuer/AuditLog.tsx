import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Download, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Button } from '../ui/button'
import { Select } from '../ui/select'
import { Label } from '../ui/label'
import { AdminAsset } from '../../lib/mandala/assets'
import { resolveAdminHistory, describeAction, exportAdminHistoryCsv, AdminHistoryRow } from '../../lib/mandala/adminHistory'

interface Props {
  assets: AdminAsset[]
}

export default function AuditLog({ assets }: Props) {
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [rows, setRows] = useState<AdminHistoryRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (selectedAssetId === '') { setRows([]); return }
    setLoading(true)
    try {
      const history = await resolveAdminHistory(selectedAssetId)
      setRows(history)
    } finally {
      setLoading(false)
    }
  }, [selectedAssetId])

  useEffect(() => { void load() }, [load])

  const handleExport = () => {
    const csv = exportAdminHistoryCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const label = assets.find(a => a.assetId === selectedAssetId)?.label ?? selectedAssetId
    a.download = `audit-log-${label.replace(/\s+/g, '-')}-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-accent text-accent-foreground">
              <ClipboardList className="h-[19px] w-[19px]" />
            </div>
            <div>
              <CardTitle>Audit log</CardTitle>
              <CardDescription>Full admin action history per asset</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <Button size="sm" variant="ghost" onClick={handleExport} title="Export CSV">
                <Download className="h-4 w-4" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="al-asset">Asset</Label>
          <Select
            id="al-asset"
            value={selectedAssetId}
            onChange={e => setSelectedAssetId(e.target.value)}
          >
            <option value="">Select asset…</option>
            {assets.map(a => (
              <option key={a.assetId} value={a.assetId}>{a.label}</option>
            ))}
          </Select>
        </div>

        {selectedAssetId !== '' && (
          <>
            {loading && (
              <p className="text-[13px] text-muted-foreground animate-pulse">Loading history…</p>
            )}
            {!loading && rows.length === 0 && (
              <p className="text-[13px] text-muted-foreground">No admin actions recorded yet.</p>
            )}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-separator text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-4">Block</th>
                      <th className="pb-2 pr-4">Kind</th>
                      <th className="pb-2 pr-4">Description</th>
                      <th className="pb-2">Txid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-separator">
                    {rows.map((row, i) => (
                      <tr key={`${row.txid}-${row.outputIndex}-${i}`} className="align-top">
                        <td className="tabular py-2 pr-4 text-subtle-foreground">
                          {row.height > 0 ? row.height : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                            {row.actionDetails.kind}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-foreground">
                          {describeAction(row.actionDetails)}
                        </td>
                        <td className="tabular py-2 text-subtle-foreground">
                          <a
                            href={`https://whatsonchain.com/tx/${row.txid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline-offset-2 hover:underline"
                            title={row.txid}
                          >
                            {row.txid.slice(0, 10)}…
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
