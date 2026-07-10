/**
 * @bsv/mandala — token client for Mandala overlay assets.
 *
 * High-level facade: create a client once, then send / receive / admin any
 * asset. Every pipeline is overlay-first (noSend → overlay submit → sendWith
 * broadcast) with journaled recovery; see transfer.ts / overlay.ts /
 * reconcile.ts for the mechanics.
 *
 * Lower-level building blocks (coin selection, guards, journal, reconcile)
 * are exported via subpaths, e.g. `@bsv/mandala/ftSelect`.
 */
import { WalletClient, WalletInterface } from '@bsv/sdk'
import { MessageBoxClient } from '@bsv/message-box-client'
import { configureMandala, MandalaEndpoints, MESSAGEBOX_URL } from './constants.js'
import { transferTokens, TransferResult } from './transfer.js'
import { receiveTokens, ReceiveResult } from './receive.js'
import {
  AdminAsset,
  listAdminAssets,
  submitAdminAction,
  SubmitAdminActionParams
} from './assets.js'
import { registerAsset, issueTokens, redeemTokens } from './issuerOps.js'
import { reconcileWallet, ReconcileResult } from './reconcile.js'

export interface MandalaClientOptions extends MandalaEndpoints {
  /** BRC-100 wallet; defaults to a new WalletClient (browser substrate). */
  wallet?: WalletInterface
}

export interface SendArgs {
  assetId: string
  /** Recipient identity key (hex compressed pubkey). */
  counterparty: string
  /** Base units (integer). */
  amount: number
}

export interface ReceiveArgs {
  /** Only accept transfers of this asset; others stay pending. */
  assetId?: string
}

export type AdminArgs = Omit<SubmitAdminActionParams, 'wallet' | 'messageBoxClient' | 'identityKey'>

export interface MandalaClient {
  wallet: WalletInterface
  identityKey: () => Promise<string>
  /** Transfer tokens to a counterparty (overlay-gated, journaled). */
  send: (args: SendArgs) => Promise<TransferResult>
  /** Internalize + acknowledge all pending incoming transfers. */
  receive: (args?: ReceiveArgs) => Promise<ReceiveResult>
  /** Submit a regulatory/treasury admin action (freeze, pause, reissue, …). */
  admin: (args: AdminArgs) => Promise<{ txid: string, nextAuthOutpoint: string }>
  /** Issuer treasury ops. */
  register: (args: { label: string, ticker: string, decimals: number }) => Promise<{ assetId: string }>
  issue: (args: { asset: AdminAsset, amount: number }) => Promise<{ txid: string }>
  redeem: (args: { asset: AdminAsset, amount: number, balance?: number }) => Promise<{ txid: string }>
  assets: () => Promise<AdminAsset[]>
  /** Self-heal half-finished state (stuck aborts, pending broadcasts). */
  reconcile: () => Promise<ReconcileResult>
}

export function createMandalaClient (opts: MandalaClientOptions = {}): MandalaClient {
  configureMandala(opts)
  const wallet = opts.wallet ?? new WalletClient()
  // Lazy so client construction never does I/O; both resolve once.
  let identityKeyPromise: Promise<string> | undefined
  const identityKey = (): Promise<string> => {
    identityKeyPromise ??= wallet
      .getPublicKey({ identityKey: true })
      .then(r => r.publicKey)
    return identityKeyPromise
  }
  let messageBoxPromise: Promise<MessageBoxClient> | undefined
  const messageBox = (): Promise<MessageBoxClient> => {
    messageBoxPromise ??= Promise.resolve(new MessageBoxClient({
      host: opts.messageBoxUrl ?? MESSAGEBOX_URL,
      walletClient: wallet as any,
      enableLogging: false
    }))
    return messageBoxPromise
  }
  const processed = new Set<string>()

  return {
    wallet,
    identityKey,
    send: async ({ assetId, counterparty, amount }) =>
      transferTokens({
        wallet: wallet as any,
        messageBoxClient: await messageBox(),
        identityKey: await identityKey(),
        assetId,
        amount,
        recipientKey: counterparty
      }),
    receive: async (args = {}) =>
      receiveTokens({
        wallet,
        messageBoxClient: await messageBox(),
        assetId: args.assetId,
        processed
      }),
    admin: async args =>
      submitAdminAction({
        ...args,
        wallet: wallet as any,
        messageBoxClient: args.ftOutput != null ? await messageBox() : undefined,
        identityKey: await identityKey()
      } as SubmitAdminActionParams),
    register: async args =>
      registerAsset({ wallet: wallet as any, identityKey: await identityKey(), ...args }),
    issue: async ({ asset, amount }) =>
      issueTokens({ wallet: wallet as any, identityKey: await identityKey(), asset, amount }),
    redeem: async ({ asset, amount, balance }) =>
      redeemTokens({ wallet: wallet as any, identityKey: await identityKey(), asset, amount, balance }),
    assets: async () => listAdminAssets(wallet),
    reconcile: async () => reconcileWallet(wallet as any)
  }
}

// Re-export the core surface for direct use.
export { configureMandala } from './constants.js'
export * from './transfer.js'
export * from './receive.js'
export * from './assets.js'
export * from './issuerOps.js'
export * from './reconcile.js'
export * from './submitGuards.js'
export * from './singleFlight.js'
export * from './adminAuthGate.js'
export * from './amount.js'
export * from './notifyJournal.js'
export * from './webLocks.js'
