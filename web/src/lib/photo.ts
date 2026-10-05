import imageCompression from 'browser-image-compression'
import { supabase } from './supabase'

// Сжатие на телефоне: ~1280 px, ≤ 250 КБ — загрузка укладывается в 10 с даже на мобильной сети (п. 9.6)
export async function compress(file: File): Promise<File> {
  return imageCompression(file, { maxWidthOrHeight: 1280, maxSizeMB: 0.25, fileType: 'image/jpeg', useWebWorker: true })
}

// Перцептивный хэш (dHash 64 бита): одинаковые/пересъёмки старого фото дают близкие хэши.
// ИИ-проверка сравнивает его с фото других нарядов, чтобы поймать «старое фото».
export async function dhash(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = 9
  canvas.height = 8
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, 9, 8)
  const px = ctx.getImageData(0, 0, 9, 8).data
  const gray = (x: number, y: number) => {
    const i = (y * 9 + x) * 4
    return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
  }
  let bits = 0n
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (gray(x, y) > gray(x + 1, y) ? 1n : 0n)
  return bits.toString(16).padStart(16, '0')
}

export async function uploadPhoto(orderId: number, kind: 'before' | 'after', file: File, authorId: string) {
  const small = await compress(file)
  const hash = await dhash(small)
  const path = `${orderId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
  const up = await supabase.storage.from('photos').upload(path, small, { contentType: 'image/jpeg' })
  if (up.error) throw up.error
  const { error } = await supabase.from('photos').insert({
    order_id: orderId, kind, storage_path: path, phash: hash, author_id: authorId,
    taken_at: new Date(file.lastModified || Date.now()).toISOString(),
  })
  if (error) throw error
}

export async function photoUrl(path: string) {
  const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600)
  return data?.signedUrl ?? ''
}
