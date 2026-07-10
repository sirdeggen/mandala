# @bsv/mandala

Token client for Mandala overlay assets. Send, receive, and administer any
asset with overlay-first commit (noSend → overlay submit → sendWith broadcast)
and journaled crash recovery.

```ts
import { createMandalaClient } from '@bsv/mandala'

const mandala = createMandalaClient({
  overlayUrl: 'https://overlay.example',
  overlayIdentityKey: '02…',
  messageBoxUrl: 'https://messagebox.example'
})

await mandala.send({ assetId, counterparty, amount })
const { accepted } = await mandala.receive()
await mandala.admin({ asset, details: { kind: 'freezeOutput', assetId, outpoint, priorOutpoint } })
```

Issuer treasury: `register`, `issue`, `redeem`; recovery: `reconcile()`.

Building blocks are exported as subpaths (`@bsv/mandala/ftSelect`,
`@bsv/mandala/submitGuards`, `@bsv/mandala/txJournal`, …). Endpoints default
from Vite env (`VITE_OVERLAY_URL`, `VITE_OVERLAY_IDENTITY_KEY`,
`VITE_MESSAGEBOX_URL`) when present; any other consumer must call
`configureMandala` / pass endpoints to `createMandalaClient`.

Status: pre-publish — the package currently ships TypeScript source consumed
via a `file:` link by the demo app. A `dist` build step is needed before an
npm publish.
