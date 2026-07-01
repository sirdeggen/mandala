import { useState } from 'react'
import HolderHome, { type HolderAction } from './holder/HolderHome'
import AssetAccount from './holder/AssetAccount'

interface SelectedAsset {
  assetId: string
  balance: number
}

interface Props {
  identityKey?: string | null
  /** Called when the user taps a quick action on the home screen */
  onAction?: (action: HolderAction) => void
}

export default function TokenWallet({ identityKey, onAction }: Props) {
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
    <HolderHome
      onSelect={(assetId, balance) => setSelected({ assetId, balance })}
      onAction={onAction}
      identityKey={identityKey}
    />
  )
}
