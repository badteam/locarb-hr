import { supabase } from './supabase'
import { compressImage, ext, aiMessage } from './docs'

// Upload any paper into the uploader's own folder of the "attachments" bucket.
export async function uploadAttachment(file, employeeId) {
  const f = await compressImage(file)
  const path = `u/${employeeId}/${crypto.randomUUID()}.${ext(f)}`
  const { error } = await supabase.storage.from('attachments').upload(path, f, { contentType: f.type || 'application/octet-stream' })
  if (error) throw error
  return path
}

// Ask the AI reader about uploaded files. purpose: transaction | maintenance | medical | civil_id | supplier | classify
export async function readFile(purpose, paths, { bucket = 'attachments', target } = {}) {
  const { data, error } = await supabase.functions.invoke('read-file', { body: { purpose, bucket, paths, target } })
  if (error) {
    let body = {}
    try { body = await error.context?.json() } catch { /* ignore */ }
    return { ok: false, error: body?.error || 'network' }
  }
  return data || { ok: false, error: 'network' }
}
export const readError = (r) => (r?.ok ? null : aiMessage(r?.error))

// Copy a stored file into another bucket (download + upload), e.g. a renewed licence attached to a transaction.
export async function copyFile(fromBucket, fromPath, toBucket, toPath) {
  const { data, error } = await supabase.storage.from(fromBucket).download(fromPath)
  if (error) throw error
  const { error: e2 } = await supabase.storage.from(toBucket).upload(toPath, data, { contentType: data.type || undefined })
  if (e2) throw e2
  return toPath
}

export async function openFile(bucket, path) {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 900)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}

// Small reusable "pick a file" button for any screen.
export const ACCEPT = 'image/*,application/pdf'
