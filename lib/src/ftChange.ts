/**
 * Token-aware change splitting — the output-side twin of ftSelect.ts.
 *
 * Mirrors the wallet-toolbox change-generation strategy (generateChangeSdk,
 * storage/methods/generateChange.ts) but denominated in token units of one
 * assetId rather than satoshis:
 *
 *   - Output count targets NET growth of the per-asset UTXO pool toward
 *     DESIRED_FT_UTXOS: outputs = targetNet + inputs consumed, capped at
 *     MAX_FT_CHANGE_OUTPUTS per tx (the toolbox caps at 8 so the pool fills
 *     gradually). An over-full pool yields a single output (passive
 *     consolidation).
 *   - Values: every output seeds at 1 unit (the token dust floor), then the
 *     surplus is scattered in uniform random 25–50% slices of the remainder
 *     onto uniformly random outputs — the toolbox's lumpy geometric spread,
 *     which is what makes change outputs hard to tell from recipient outputs.
 *   - A single change output takes the full amount with no randomization,
 *     exactly as the toolbox does.
 *
 * `rand` is injectable for deterministic tests (toolbox: randomVals).
 */

/** Desired spendable-UTXO pool size per assetId (toolbox: numberOfDesiredUTXOs). */
export const DESIRED_FT_UTXOS = 32
/** Hard cap on change outputs per tx (toolbox: maxChangeOutputsPerTransaction). */
export const MAX_FT_CHANGE_OUTPUTS = 8

export interface FtChangeParams {
  /** Token units returning to self. */
  change: number
  /** Spendable FT candidates for this assetId before the tx. */
  poolCount: number
  /** How many of those candidates this tx consumes. */
  inputCount: number
  desiredPoolCount?: number
  maxOutputs?: number
  /** Uniform [0,1) source; defaults to Math.random. */
  rand?: () => number
}

/**
 * Split `change` into output amounts (each ≥ 1 unit, sum exactly `change`).
 * Empty when change ≤ 0.
 */
export function generateFtChange (p: FtChangeParams): number[] {
  const { change, poolCount, inputCount } = p
  if (change <= 0) return []
  const desired = p.desiredPoolCount ?? DESIRED_FT_UTXOS
  const maxOutputs = p.maxOutputs ?? MAX_FT_CHANGE_OUTPUTS
  const rand = p.rand ?? Math.random
  // Uniform inclusive integer in [min, max] (toolbox rand(min,max)).
  const randInt = (min: number, max: number): number => Math.floor(rand() * (max - min + 1)) + min

  const targetNet = desired - poolCount
  const n = Math.min(maxOutputs, Math.max(1, targetNet + inputCount), change)

  if (n === 1) return [change]

  const amounts = new Array<number>(n).fill(1)
  let surplus = change - n
  while (surplus > 0) {
    const slice = Math.max(1, Math.floor((randInt(2500, 5000) / 10000) * surplus))
    amounts[randInt(0, n - 1)] += slice
    surplus -= slice
  }

  const total = amounts.reduce((a, b) => a + b, 0)
  if (total !== change) throw new Error(`change split conservation failed: ${total} !== ${change}`)
  return amounts
}
