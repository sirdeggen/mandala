import { HTTPSOverlayBroadcastFacilitator } from '@bsv/sdk'
import { TOPIC, OVERLAY_URL } from './constants'

interface OverlayBroadcastFacilitator {
  send(url: string, taggedBEEF: { beef: number[]; topics: string[]; offChainValues?: number[] }): Promise<Record<string, { outputsToAdmit: number[] }>>
}

export async function submitToOverlay (
  beef: number[],
  offChainValues?: number[],
  facilitator: OverlayBroadcastFacilitator = new HTTPSOverlayBroadcastFacilitator(undefined, true)
): Promise<number[]> {
  const taggedBEEF = { beef, topics: [TOPIC], offChainValues }
  const steak = await facilitator.send(OVERLAY_URL, taggedBEEF)
  const admit = steak[TOPIC]?.outputsToAdmit ?? []
  if (admit.length === 0) throw new Error('overlay rejected the transaction')
  return admit
}
