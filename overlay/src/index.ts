import OverlayExpress from '@bsv/overlay-express'
import {
  MandalaTopicManager,
  MandalaStorageManager,
  createMandalaLookupService,
  InMemoryScreeningProvider
} from '@bsv/overlay-topics'
import { PrivateKey, ProtoWallet, WalletInterface } from '@bsv/sdk'
import { MongoClient } from 'mongodb'
import { config } from 'dotenv'
import type { Request, Response } from 'express'
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
  // Local demo: validate scripts without a full chain tracker / ARC key.
  server.configureChainTracker('scripts only')
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

  await server.start()
  console.log(`mandala overlay listening on ${HOSTING_URL}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
