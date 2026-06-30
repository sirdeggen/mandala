import { useCallback, useEffect, useState } from 'react'
import { LayoutDashboard, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Button } from '../ui/button'
import { useWallet } from '../../context/WalletContext'
import { listAdminAssets, AdminAsset } from '../../lib/mandala/assets'
import { resolveAssetState, AssetAdminStateView } from '../../lib/mandala/adminState'

interface AssetRow {
  asset: AdminAsset
  state: AssetAdminStateView | null
}

function BadgePill({ label, variant }: { label: string, variant: 'default' | 'warn' | 'danger' | 'ok' }) {
  const classes = {
    default: 'bg-muted text-muted-foreground',
    warn: 'bg-warning/15 text-warning',
    danger: 'bg-destructive/12 text-destructive',
    ok: 'bg-accent text-accent-foreground',
  }[variant]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${classes}`}>
      {label}
    </span>
  )
}

export default function AssetOverview() {
  const { wallet } = useWallet()
  const [rows, setRows] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (wallet == null) return
    setLoading(true)
    try {
      const assets = await listAdminAssets(wallet as any)
      const rowData = await Promise.all(
        assets.map(async (asset): Promise<AssetRow> => {
          const state = await resolveAssetState(asset.assetId)
          return { asset, state }
        })
      )
      setRows(rowData)
    } finally {
      setLoading(false)
    }
  }, [wallet])

  useEffect(() => { void load() }, [load])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-accent text-accent-foreground">
              <LayoutDashboard className="h-[19px] w-[19px]" />
            </div>
            <div>
              <CardTitle>Asset overview</CardTitle>
              <CardDescription>Live regulatory state per asset</CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 && !loading && (
          <p className="text-[13px] text-muted-foreground">No assets registered yet.</p>
        )}
        {loading && rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground animate-pulse">Loading assets…</p>
        )}
        <div className="space-y-3">
          {rows.map(({ asset, state }) => (
            <div
              key={asset.assetId}
              className="rounded-[--radius-md] border border-separator bg-muted/40 p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <span className="text-[15px] font-semibold">{asset.label}</span>
                  <span className="ml-2 tabular text-[12px] text-subtle-foreground">
                    {asset.assetId.slice(0, 16)}…
                  </span>
                </div>
              </div>
              {state == null ? (
                <p className="text-[12px] text-subtle-foreground">State unavailable (overlay offline?)</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <BadgePill
                    label={state.isPaused ? 'PAUSED' : 'Active'}
                    variant={state.isPaused ? 'danger' : 'ok'}
                  />
                  <BadgePill
                    label={state.accessMode === 'allowlist' ? 'Allowlist' : 'Denylist'}
                    variant={state.accessMode === 'allowlist' ? 'warn' : 'default'}
                  />
                  {state.frozenOutpoints.length > 0 && (
                    <BadgePill
                      label={`${state.frozenOutpoints.length} frozen`}
                      variant="warn"
                    />
                  )}
                  {state.blockedIdentities.length > 0 && (
                    <BadgePill
                      label={`${state.blockedIdentities.length} blocked`}
                      variant="danger"
                    />
                  )}
                  {state.allowedIdentities.length > 0 && (
                    <BadgePill
                      label={`${state.allowedIdentities.length} allowed`}
                      variant="ok"
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
