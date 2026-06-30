import QRCode from 'qrcode'

export async function toQrDataUrl (text: string): Promise<string> {
  return await QRCode.toDataURL(text, { margin: 1, width: 220 })
}
