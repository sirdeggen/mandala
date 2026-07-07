import OverlayExpress from '@bsv/overlay-express'
import {
  MandalaTopicManager,
  MandalaStorageManager,
  createMandalaLookupService,
  InMemoryScreeningProvider
} from '@bsv/overlay-topics'
import { KnexStorage } from '@bsv/overlay'
import { PrivateKey, ProtoWallet, WalletInterface } from '@bsv/sdk'
import { MongoClient } from 'mongodb'
import { config } from 'dotenv'
import type { Request, Response } from 'express'
import { buildActivity, LinkageRowLite } from './activity.js'
config()

const requireEnv = (name: string): string => {
  const v = process.env[name]
  if (v == null || v === '') throw new Error(`Missing required environment variable: ${name}`)
  return v
}

const main = async (): Promise<void> => {
  const NODE_NAME = requireEnv('NODE_NAME')
  const SERVER_PRIVATE_KEY = requireEnv('SERVER_PRIVATE_KEY')
  const HOSTING_URL = requireEnv('HOSTING_URL')
  const MONGO_URL = requireEnv('MONGO_URL')
  const NETWORK = requireEnv('NETWORK')
  if (NETWORK !== 'main' && NETWORK !== 'test') throw new Error('NETWORK must be "main" or "test"')

  const server = new OverlayExpress(NODE_NAME, SERVER_PRIVATE_KEY, HOSTING_URL)
  server.configurePort(8080)
  server.configureNetwork(NETWORK)

  // With ARCADE_URL set, the overlay becomes a real network participant:
  //  - broadcasts accepted txs itself (ArcadeProvider POSTs to `${ARCADE_URL}/tx`;
  //    engine broadcasts BEFORE folding state, and throwOnBroadcastFailure
  //    defaults true, so a failed broadcast rejects the submit — the app then
  //    aborts safely instead of desyncing),
  //  - refreshes merkle proofs from `${ARCADE_URL}/tx/:txid`,
  //  - runs FULL SPV: configureChaintracks installs the go-chaintracks client
  //    as the chain tracker (header validation + merkle-root checks + reorg
  //    SSE), replacing the local 'scripts only' mode.
  // Without it (local demo): validate scripts only; the wallet is the sole
  // broadcaster.
  const ARCADE_URL = process.env.ARCADE_URL
  if (ARCADE_URL != null && ARCADE_URL !== '') {
    server.configureArcade(ARCADE_URL, { apiKey: process.env.ARCADE_API_KEY })
    // Chaintracks lives at the /chaintracks service of the same Arcade host by
    // default, but both the host and API prefix are independently overridable.
    const CHAINTRACKS_URL = process.env.CHAINTRACKS_URL ?? `${ARCADE_URL}/chaintracks`
    server.configureChaintracks(CHAINTRACKS_URL, { apiPrefix: process.env.CHAINTRACKS_API_PREFIX ?? '/v2' })
  } else {
    server.configureChainTracker('scripts only')
  }
  await server.configureKnex({
    client: 'sqlite3',
    connection: { filename: process.env.SQLITE_FILE ?? '/data/overlay.sqlite' },
    useNullAsDefault: true
  })
  await server.configureMongo(MONGO_URL)

  // OverlayExpress.configureMongo uses db `${NODE_NAME}_lookup_services` (i.e. "mandala_lookup_services").
  // We must use that same db name so sharedStorage reads/writes the same collections.
  const mongoClient = new MongoClient(MONGO_URL)
  await mongoClient.connect()
  const sharedStorage = new MandalaStorageManager(mongoClient.db(`${NODE_NAME}_lookup_services`))

  const mandalaWallet = new ProtoWallet(PrivateKey.fromHex(SERVER_PRIVATE_KEY)) as unknown as WalletInterface
  server.configureTopicManager('tm_mandala', new MandalaTopicManager({
    verifierWallet: mandalaWallet,
    screeningProvider: new InMemoryScreeningProvider([]),
    adminWallet: mandalaWallet,
    adminProtocolID: [2, 'mandala admin'] as [2, string],
    stateStore: sharedStorage
  }))
  server.configureLookupServiceWithMongo('ls_mandala', createMandalaLookupService(mandalaWallet, sharedStorage))

  server.configureEnableGASPSync(false)
  await server.configureEngine(false)

  server.app.get('/admin/asset-state/:assetId', (req: Request<{ assetId: string }>, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*')
    void (async () => {
      try {
        const state = await sharedStorage.getAssetState(req.params.assetId)
        res.json(state)
      } catch (e) {
        res.status(500).json({ error: String(e) })
      }
    })()
  })

  server.app.get('/admin/admin-history/:assetId', (req: Request<{ assetId: string }>, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*')
    void (async () => {
      try {
        const history = await sharedStorage.findAdminHistoryByAssetId(req.params.assetId)
        res.json(history)
      } catch (e) {
        res.status(500).json({ error: String(e) })
      }
    })()
  })

  // Overlay-wide transaction feed with linkage-proven counterparties — what
  // the overlay operator can see. Reads the append-only linkage collection
  // (identity per output, proven via revealSpecificKeyLinkage) and the
  // engine's raw-tx store (amounts, input provenance). Cursor-paginated
  // (?limit=&before=) so thousands of transactions stream in pages; see
  // activity.ts. Indexes are ensured at boot so the newest-first sort and
  // the paged admin-history reads never collection-scan.
  const lookupDb = mongoClient.db(`${NODE_NAME}_lookup_services`)
  const linkageCol = lookupDb.collection('mandalaLinkageRecords')
  const adminHistoryCol = lookupDb.collection('mandalaAdminHistory')
  await Promise.all([
    linkageCol.createIndex({ createdAt: -1 }),
    adminHistoryCol.createIndex({ assetId: 1, admitSeq: -1 })
  ])

  server.app.get('/admin/activity', (req: Request, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*')
    void (async () => {
      try {
        const engineStorage = new KnexStorage(server.knex!)
        const page = await buildActivity({
          listLinkage: async (limit, before) =>
            await linkageCol
              .find(before != null ? { createdAt: { $lte: new Date(before) } } : {})
              .sort({ createdAt: -1 })
              .limit(limit)
              .toArray() as unknown as LinkageRowLite[],
          findLinkageByOutpoints: async (outpoints) =>
            outpoints.length === 0
              ? []
              : await linkageCol.find({ $or: outpoints.map(o => ({ txid: o.txid, outputIndex: o.outputIndex })) }).toArray() as unknown as LinkageRowLite[],
          findRawTxs: async (txids) => {
            const records = await engineStorage.findRawTransactions(txids)
            return new Map(records.map(r => [r.txid, r.rawTx]))
          }
        }, {
          assetId: typeof req.query.assetId === 'string' ? req.query.assetId : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
          before: typeof req.query.before === 'string' ? req.query.before : undefined
        })
        res.json(page)
      } catch (e) {
        res.status(500).json({ error: String(e) })
      }
    })()
  })

  // Paged admin history (?limit=&offset=), newest-first by admit sequence.
  // The un-paged /admin/admin-history/:assetId stays for full exports; the
  // app's audit log uses this one so thousands of actions stream in pages.
  server.app.get('/admin/admin-history-page/:assetId', (req: Request<{ assetId: string }>, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*')
    void (async () => {
      try {
        const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500)
        const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
        const rows = await adminHistoryCol
          .find({ assetId: req.params.assetId }, { projection: { _id: 0 } })
          .sort({ admitSeq: -1 })
          .skip(offset)
          .limit(limit)
          .toArray()
        res.json(rows)
      } catch (e) {
        res.status(500).json({ error: String(e) })
      }
    })()
  })

  // Aggregated issue/redeem totals — the Overview KPIs and the Banking
  // reconciliation need whole-history sums, which must not require shipping
  // the whole history to the client. Mongo does the sum against the
  // (assetId, …) index.
  server.app.get('/admin/admin-summary/:assetId', (req: Request<{ assetId: string }>, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*')
    void (async () => {
      try {
        const groups = await adminHistoryCol.aggregate([
          { $match: { assetId: req.params.assetId } },
          { $group: { _id: '$actionDetails.kind', total: { $sum: '$actionDetails.amount' }, count: { $sum: 1 } } }
        ]).toArray()
        const byKind = new Map(groups.map(g => [g._id as string, g]))
        // Matches the client-side sums this replaces: 'issue' and 'redeem'
        // only ('reissue' conserves supply — it replaces frozen units).
        res.json({
          totalIssued: byKind.get('issue')?.total as number ?? 0,
          totalRedeemed: byKind.get('redeem')?.total as number ?? 0,
          actionCount: groups.reduce((a, g) => a + (g.count as number), 0)
        })
      } catch (e) {
        res.status(500).json({ error: String(e) })
      }
    })()
  })

  await server.start()
  console.log(`mandala overlay listening on ${HOSTING_URL}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
