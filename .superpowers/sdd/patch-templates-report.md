# @bsv/templates@1.6.0 OP_N Decode Patch Report

## Summary

Patched `MandalaToken.decode` in both `app/` and `overlay/` to handle OP_N-encoded amounts (1..16), which `createMinimallyEncodedScriptChunk` produces but the original decode ignores.

## What Changed

### Root Cause

`MandalaToken.lock` uses `createMinimallyEncodedScriptChunk(encodeScriptNum(amount))` which collapses amounts 1–16 to OP_1–OP_16 opcodes (chunk has `op` 0x51–0x60 and no `data` field). `MandalaToken.decode` read only `chunk.data` via `decodeScriptNum(c[2].data ?? [])`, so amounts 1–16 decoded as 0 and threw `not a MandalaToken script: bad amount`.

### Fix Applied

Replaced the single-line amount read with an OP_N-aware read in all four compiled dist copies:

```js
const _amt_chunk = c[2];
const amount = _amt_chunk.op === 0 ? 0 : (_amt_chunk.op === 0x4f ? -1 : ((_amt_chunk.op >= 0x51 && _amt_chunk.op <= 0x60) ? _amt_chunk.op - 0x50 : decodeScriptNum(_amt_chunk.data ?? [])));
```

This handles:
- `op === 0` → OP_0 → 0
- `op === 0x4f` → OP_1NEGATE → -1
- `op 0x51–0x60` → OP_1–OP_16 → 1–16
- otherwise → `decodeScriptNum(data)` (original path for amounts > 16)

### Files Modified

**app/**
- `app/node_modules/@bsv/templates/dist/cjs/src/MandalaToken.js` — CJS decode fix
- `app/node_modules/@bsv/templates/dist/esm/src/MandalaToken.js` — ESM decode fix
- `app/patches/@bsv+templates+1.6.0.patch` — generated patch (new)
- `app/package.json` — added `patch-package` to devDependencies, added `postinstall: patch-package` script, added `_patchNote` comment

**overlay/**
- `overlay/node_modules/@bsv/templates/dist/cjs/src/MandalaToken.js` — CJS decode fix
- `overlay/node_modules/@bsv/templates/dist/esm/src/MandalaToken.js` — ESM decode fix
- `overlay/patches/@bsv+templates+1.6.0.patch` — generated patch (new)
- `overlay/package.json` — added `patch-package` to devDependencies, added `postinstall: patch-package` script, added `_patchNote` comment
- `overlay/Dockerfile` — added `COPY patches ./patches` before `RUN npm install` so postinstall patch-package finds the patch in-container

## Verification Output

ESM path (app/ — Vite/browser runtime):
```
amount 1: OK (decoded=1)
amount 5: OK (decoded=5)
amount 12: OK (decoded=12)
amount 16: OK (decoded=16)
amount 17: OK (decoded=17)
amount 100: OK (decoded=100)
ALL PASS
```

CJS path (overlay/ — Node.js server runtime):
```
amount 1: OK (decoded=1)
amount 5: OK (decoded=5)
amount 12: OK (decoded=12)
amount 16: OK (decoded=16)
amount 17: OK (decoded=17)
amount 100: OK (decoded=100)
ALL PASS
```

## Docker Handling

The overlay `Dockerfile` previously only copied `package.json` before `RUN npm install`, so the postinstall `patch-package` step would have failed (patches dir not present). Fixed by adding `COPY patches ./patches` before `RUN npm install`. This is consistent with the existing pattern for the sqlite migration inline patch already in the Dockerfile — both approaches are now in use (inline node -e for the overlay migration, COPY+postinstall for this templates patch).

## Removal Note

This patch is pinned to `@bsv/templates@1.6.0`. Once the upstream fix publishes a new version, remove `patches/@bsv+templates+1.6.0.patch`, remove the `postinstall` script, remove the `_patchNote` field, remove `patch-package` from devDependencies, remove the Dockerfile `COPY patches` line, and bump `@bsv/templates` to the fixed version in both `app/package.json` and `overlay/package.json`.
