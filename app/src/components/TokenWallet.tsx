import { useState } from 'react'
import AccountsOverview from './holder/AccountsOverview'
import AssetAccount from './holder/AssetAccount'

interface SelectedAsset {
  assetId: string
  balance: number
}

export default function TokenWallet() {
  const [selected, setSelected] = useState<SelectedAsset | null>(null)

  if (selected != null) {
    return (
      <AssetAccount
        assetId={selected.assetId}
        balance={selected.balance}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <AccountsOverview
      onSelect={(assetId, balance) => setSelected({ assetId, balance })}
    />
  )
}
