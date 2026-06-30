import { describe, it, expect } from 'vitest'
import { toQrDataUrl } from './qr'

describe('toQrDataUrl', () => {
  it('produces a base64 png data url', async () => {
    const url = await toQrDataUrl('02abcdef')
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
  })
})
