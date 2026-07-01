// Stub — real implementation in Task 2
import { AdminAsset } from '../../lib/mandala/assets'
interface Props { assets: AdminAsset[]; onReload: () => void }
export default function OverviewSection(_props: Props) {
  return <div className="text-muted-foreground text-[13px]">Overview loading…</div>
}
