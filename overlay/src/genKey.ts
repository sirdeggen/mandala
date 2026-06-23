import { PrivateKey } from '@bsv/sdk'

const key = PrivateKey.fromRandom()
console.log('SERVER_PRIVATE_KEY=' + key.toHex())
console.log('IDENTITY_PUBLIC_KEY=' + key.toPublicKey().toString())
