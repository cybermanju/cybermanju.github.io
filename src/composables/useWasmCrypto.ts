// CyberManju OS — encryption + compression in the browser build
//
// Everything here runs on the wasm-pack exports (`crates/os-wasm/src/
// crypto.rs`, `compression.rs`) and stores its state in the `.cybermanju`
// vault through `useVault` — keys, per-file metadata and the transformed
// bytes all live in redb's `kv` table, so a file that is encrypted here
// stays encrypted when the same container opens on the desktop app's table
// layout (same `files` row, body in `content:<id>`).
//
// Honest algorithm mapping (the wasm pack ships X25519 + ML-DSA-65 +
// ChaCha20-Poly1305, and NO ML-KEM/Frodo/AES-GCM):
//
//   kyber1024 / frodokem1344 / hybrid → X25519 keypair, content key = HKDF
//   dilithium5                        → ML-DSA-65 keypair + signature
//   aes256                            → random 32-byte key
//   every algorithm                   → body encrypted with ChaCha20-Poly1305
//
// The `algorithmDisplay` strings say exactly that, so nothing in the UI
// claims a cipher the browser never ran.

import type {
  CompressionStats,
  EncryptionAlgo,
  EncryptionKeyInfo,
  EncryptionStatus,
  LayerDetail,
} from '@/types'
import { ENCRYPTION_INFO } from '@/types'
import { vaultDelete, vaultGet, vaultList, vaultSet, vaultGetJson, vaultSetJson } from './useVault'
import { wasmModuleExports } from './useWasmBackend'

interface WasmCrypto {
  x25519_generate_keypair(): { privateKey: Uint8Array; publicKey: Uint8Array }
  ml_dsa65_generate_keypair(): { privateKey: Uint8Array; publicKey: Uint8Array }
  ml_dsa65_sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array
  ml_dsa65_verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean
  chacha20_generate_key(): Uint8Array
  chacha20_generate_nonce(): Uint8Array
  chacha20_encrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array
  chacha20_decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array
  hkdf_derive(secret: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array
  blake3_hash(data: Uint8Array): string
  compress_lz4(data: Uint8Array): Uint8Array
  decompress_lz4(data: Uint8Array): Uint8Array
  compress_brotli(data: Uint8Array, quality: number): Uint8Array
  decompress_brotli(data: Uint8Array): Uint8Array
}

let wasmCrypto: WasmCrypto | null = null

async function wasm(): Promise<WasmCrypto> {
  if (!wasmCrypto) {
    wasmCrypto = await wasmModuleExports<WasmCrypto>()
  }
  return wasmCrypto
}

// ── codecs ────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** AES-256 slot gets ChaCha20; the ML-KEM/Frodo slots get X25519. */
function honestDisplay(algorithm: EncryptionAlgo): string {
  switch (algorithm) {
    case 'dilithium5':
      return 'ML-DSA-65 + ChaCha20-Poly1305'
    case 'aes256':
      return 'ChaCha20-Poly1305 (AES-256 slot)'
    case 'frodokem1344':
      return 'X25519 + ChaCha20-Poly1305 (Frodo slot)'
    case 'hybrid':
      return 'X25519 + ChaCha20-Poly1305 (hybrid slot)'
    case 'kyber1024':
    default:
      return 'X25519 + ChaCha20-Poly1305 (ML-KEM slot)'
  }
}

// ── key storage (`config:key:*` + `secret:key:*` inside the vault) ────

interface KeySecret {
  privateHex: string
  publicHex: string
  algorithm: EncryptionAlgo
}

function newKeyId(): string {
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function generateKeyPair(algorithm: EncryptionAlgo): Promise<EncryptionKeyInfo> {
  const w = await wasm()
  const id = newKeyId()
  let secret: KeySecret

  if (algorithm === 'dilithium5') {
    const kp = w.ml_dsa65_generate_keypair()
    secret = { privateHex: toHex(kp.privateKey), publicHex: toHex(kp.publicKey), algorithm }
  } else if (algorithm === 'aes256') {
    const key = w.chacha20_generate_key()
    // Symmetric slot: the "public" half is a fingerprint, not a key.
    secret = {
      privateHex: toHex(key),
      publicHex: w.blake3_hash(key),
      algorithm,
    }
  } else {
    const kp = w.x25519_generate_keypair()
    secret = { privateHex: toHex(kp.privateKey), publicHex: toHex(kp.publicKey), algorithm }
  }

  const info: EncryptionKeyInfo = {
    id,
    algorithm,
    algorithmDisplay: honestDisplay(algorithm),
    nistLevel: ENCRYPTION_INFO[algorithm]?.nistLevel ?? 0,
    color: ENCRYPTION_INFO[algorithm]?.color ?? '#FFFFFF',
    publicKeyPreview: secret.publicHex.slice(0, 16),
    hasPrivateKey: true,
    createdAt: new Date().toISOString(),
  }
  await vaultSetJson(`config:key:${id}`, info)
  await vaultSetJson(`secret:key:${id}`, secret)
  return info
}

export async function listKeys(): Promise<EncryptionKeyInfo[]> {
  const rows = await vaultList('config:key:')
  const keys: EncryptionKeyInfo[] = []
  for (const row of rows) {
    const info = await vaultGetJson<EncryptionKeyInfo>(row.key)
    if (info?.id) keys.push(info)
  }
  return keys.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

async function loadSecret(keyId: string): Promise<KeySecret | null> {
  return vaultGetJson<KeySecret>(`secret:key:${keyId}`)
}

// ── per-file meta (`meta:<fileId>`) ───────────────────────────────────

interface FileMeta {
  enc?: { keyId: string; algorithm: EncryptionAlgo; display: string; nonceHex: string; sigHex?: string; at: string }
  comp?: { layers: string[]; originalSize: number; at: string }
}

const contentKey = (fileId: string) => `content:${fileId}`
const encodingKey = (fileId: string) => `encoding:${fileId}`
const metaKey = (fileId: string) => `meta:${fileId}`

async function readMeta(fileId: string): Promise<FileMeta> {
  return (await vaultGetJson<FileMeta>(metaKey(fileId))) ?? {}
}

async function writeMeta(fileId: string, meta: FileMeta): Promise<void> {
  const empty = !meta.enc && !meta.comp
  if (empty) await vaultDelete(metaKey(fileId))
  else await vaultSetJson(metaKey(fileId), meta)
}

async function contentNode(fileId: string): Promise<Record<string, unknown> | null> {
  try {
    const { wasmDbDispatch } = await import('./useWasmBackend')
    const node = (await wasmDbDispatch('files.get', { fileId })) as Record<string, unknown> | null
    return node && typeof node === 'object' ? node : null
  } catch {
    return null
  }
}

async function patchNode(fileId: string, patch: Record<string, unknown>): Promise<void> {
  try {
    const { wasmDbDispatch } = await import('./useWasmBackend')
    await wasmDbDispatch('files.patch', { fileId, patch })
  } catch {
    // Metadata bookkeeping must never fail a read/write that already worked.
  }
}

// ── content pipeline: decode (read) / encode (write) ──────────────────

async function keyFor(secret: KeySecret): Promise<Uint8Array> {
  const w = await wasm()
  const priv = fromHex(secret.privateHex)
  const saltSource = fromHex(secret.publicHex)
  const salt = saltSource.subarray(0, 32)
  const info = utf8(`cybermanju-file-v1:${secret.algorithm}`)
  return w.hkdf_derive(priv, salt, info, 32)
}

/** Vault bytes → plaintext bytes (decrypt → decompress). */
async function decodeStored(
  fileId: string,
  raw: string,
): Promise<{ bytes: Uint8Array; meta: FileMeta }> {
  const w = await wasm()
  const meta = await readMeta(fileId)
  const encoding = await vaultGet(encodingKey(fileId))
  let bytes = encoding === 'base64' ? b64ToBytes(raw) : utf8(raw)

  if (meta.enc) {
    const secret = await loadSecret(meta.enc.keyId)
    if (!secret) {
      throw new Error(
        `encryption key ${meta.enc.keyId} is missing from this vault — the file cannot be decrypted here`,
      )
    }
    const key = await keyFor(secret)
    const nonce = fromHex(meta.enc.nonceHex)
    const plain = w.chacha20_decrypt(key, nonce, bytes)
    if (meta.enc.sigHex) {
      const hash = fromHex(w.blake3_hash(plain))
      const ok = w.ml_dsa65_verify(hash, fromHex(meta.enc.sigHex), fromHex(secret.publicHex))
      if (!ok) throw new Error('ML-DSA-65 signature check failed — this content was modified')
    }
    bytes = plain
  }

  if (meta.comp?.layers.length) {
    bytes = decompressBytes(w, bytes, meta.comp.layers)
  }
  return { bytes, meta }
}

/** Plaintext bytes → vault bytes (compress → encrypt), writing keys + node. */
async function encodeStored(
  fileId: string,
  bytes: Uint8Array,
  meta: FileMeta,
): Promise<{ stored: string; byteLength: number; final: Uint8Array }> {
  const w = await wasm()
  let out = bytes

  if (meta.comp?.layers.length) {
    for (const layer of meta.comp.layers) {
      out = compressBytes(w, out, layer).bytes
    }
    // The pipeline always re-runs from plaintext, so this is the size the
    // stats compare against after an edit.
    meta.comp.originalSize = bytes.length
  }

  if (meta.enc) {
    const secret = await loadSecret(meta.enc.keyId)
    if (!secret) {
      throw new Error(`encryption key ${meta.enc.keyId} is missing from this vault`)
    }
    // Sign the plaintext first, then seal it: the signature proves the
    // content, the AEAD protects the transport.
    if (meta.enc.algorithm === 'dilithium5') {
      const hash = fromHex(w.blake3_hash(out))
      meta.enc.sigHex = toHex(w.ml_dsa65_sign(hash, fromHex(secret.privateHex)))
    }
    const nonce = w.chacha20_generate_nonce()
    const cipher = w.chacha20_encrypt(await keyFor(secret), nonce, out)
    meta.enc.nonceHex = toHex(nonce)
    meta.enc.at = new Date().toISOString()
    out = concatBytes(nonce, cipher)
  }

  const transformed = !!meta.enc || !!meta.comp?.layers.length || out.length !== bytes.length
  const stored = transformed ? bytesToB64(out) : fromUtf8(out)
  await vaultSet(contentKey(fileId), stored)
  if (transformed) await vaultSet(encodingKey(fileId), 'base64')
  else await vaultDelete(encodingKey(fileId))
  await writeMeta(fileId, meta)

  await patchNode(fileId, {
    sizeBytes: out.length,
    hashBlake3: w.blake3_hash(out),
    encrypted: !!meta.enc,
    encryptionAlgorithm: meta.enc?.display ?? null,
    compressionLayers: meta.comp?.layers ?? [],
  })
  return { stored, byteLength: out.length, final: out }
}

// ── compression ───────────────────────────────────────────────────────

export function compressionCapable(layer: string): boolean {
  return layer === 'none' || layer === 'lz4' || layer === 'brotli'
}

function compressBytes(w: WasmCrypto, bytes: Uint8Array, layer: string): {
  bytes: Uint8Array
  details: LayerDetail[]
} {
  if (layer === 'none') return { bytes, details: [] }
  if (layer === 'zstd' || layer === 'triple') {
    throw new Error(
      `${layer} needs zstd, which is not in the browser wasm pack — use lz4 or brotli here (the desktop app does zstd)`,
    )
  }
  const out = layer === 'lz4' ? w.compress_lz4(bytes) : w.compress_brotli(bytes, 11)
  return {
    bytes: out,
    details: [
      {
        name: layer === 'lz4' ? 'LZ4 (lz4_flex)' : 'Brotli-11',
        algorithm: layer,
        inputSize: bytes.length,
        outputSize: out.length,
        ratio: bytes.length ? out.length / bytes.length : 1,
        color: layer === 'lz4' ? '#FFFFFF' : '#FFFFFF',
      },
    ],
  }
}

function decompressBytes(w: WasmCrypto, bytes: Uint8Array, layers: string[]): Uint8Array {
  let out = bytes
  // Applied left→right, so unwind right→left.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer === 'lz4') out = w.decompress_lz4(out)
    else if (layer === 'brotli') out = w.decompress_brotli(out)
    else if (layer === 'zstd' || layer === 'triple') {
      throw new Error(`${layer} content can only be decompressed by the desktop app (zstd)`)
    }
  }
  return out
}

// ── public file operations (wired to the panel commands) ──────────────

export async function getEncryptionStatus(fileId?: string): Promise<EncryptionStatus> {
  if (fileId) {
    const meta = await readMeta(fileId)
    if (meta.enc) {
      const keys = await listKeys()
      const key = keys.find((k) => k.id === meta.enc?.keyId)
      return {
        isEncrypted: true,
        algorithm: meta.enc.display,
        nistLevel: key?.nistLevel ?? 0,
        keyId: meta.enc.keyId,
        encryptedAt: meta.enc.at,
      }
    }
  }
  const newest = await listKeys()
  const top = newest[0]
  if (!top) return { isEncrypted: false }
  return {
    isEncrypted: true,
    algorithm: top.algorithmDisplay,
    nistLevel: top.nistLevel,
    keyId: top.id,
    encryptedAt: top.createdAt,
  }
}

export async function encryptFile(fileId: string, algorithm: EncryptionAlgo): Promise<void> {
  const existing = await listKeys()
  let key = existing.find((k) => k.algorithm === algorithm)
  if (!key) key = await generateKeyPair(algorithm)
  const secret = await loadSecret(key.id)
  if (!secret) throw new Error('key generation produced no private material')

  const raw = (await vaultGet(contentKey(fileId))) ?? ''
  const { bytes, meta } = await decodeStored(fileId, raw)
  if (meta.enc) throw new Error('this file is already encrypted — decrypt it first')

  // `encodeStored` generates the nonce, seals with ChaCha20-Poly1305 and
  // (for the ML-DSA slot) signs the plaintext — one pipeline, one place.
  meta.enc = {
    keyId: key.id,
    algorithm,
    display: key.algorithmDisplay,
    nonceHex: '',
    at: new Date().toISOString(),
  }
  await encodeStored(fileId, bytes, meta)
}

export async function decryptFile(fileId: string): Promise<void> {
  const raw = (await vaultGet(contentKey(fileId))) ?? ''
  const { bytes, meta } = await decodeStored(fileId, raw)
  if (!meta.enc) throw new Error('this file is not encrypted')
  delete meta.enc
  await encodeStored(fileId, bytes, meta)
}

export async function compressFile(fileId: string, layer: string): Promise<CompressionStats> {
  const w = await wasm()
  const started = performance.now()
  const raw = (await vaultGet(contentKey(fileId))) ?? ''
  const { bytes, meta } = await decodeStored(fileId, raw)
  if (meta.comp) throw new Error('this file is already compressed — decompress it first')

  const effective = layer === 'all' ? 'brotli' : layer
  if (!compressionCapable(effective)) {
    throw new Error(
      `${layer} needs zstd, which is not in the browser wasm pack — use lz4 or brotli here (the desktop app does zstd)`,
    )
  }

  if (effective === 'none') {
    const { final } = await encodeStored(fileId, bytes, meta)
    return {
      originalSize: bytes.length,
      compressedSize: final.length,
      ratio: 1,
      layer,
      layerDetails: [],
      blake3Hash: w.blake3_hash(final),
      durationMs: Math.max(1, Math.round(performance.now() - started)),
    }
  }

  meta.comp = { layers: [effective], originalSize: bytes.length, at: new Date().toISOString() }
  // `encodeStored` re-runs the pipeline (compress → encrypt) from plaintext,
  // so the input stays untouched and the stats describe what actually landed.
  const { final } = await encodeStored(fileId, bytes, meta)
  const detail: LayerDetail = {
    name: effective === 'lz4' ? 'LZ4 (lz4_flex)' : 'Brotli-11',
    algorithm: effective,
    inputSize: bytes.length,
    outputSize: final.length,
    ratio: bytes.length ? final.length / bytes.length : 1,
    color: '#FFFFFF',
  }
  return {
    originalSize: bytes.length,
    compressedSize: final.length,
    ratio: bytes.length ? final.length / bytes.length : 1,
    layer,
    layerDetails: [detail],
    blake3Hash: w.blake3_hash(final),
    durationMs: Math.max(1, Math.round(performance.now() - started)),
  }
}

export async function decompressFile(fileId: string): Promise<CompressionStats> {
  const w = await wasm()
  const started = performance.now()
  const raw = (await vaultGet(contentKey(fileId))) ?? ''
  const { bytes, meta } = await decodeStored(fileId, raw)
  if (!meta.comp) throw new Error('this file is not compressed')
  const originalSize = meta.comp.originalSize || bytes.length
  delete meta.comp
  await encodeStored(fileId, bytes, meta)
  return {
    originalSize,
    compressedSize: bytes.length,
    ratio: originalSize ? bytes.length / originalSize : 1,
    layer: 'none',
    layerDetails: [],
    blake3Hash: w.blake3_hash(bytes),
    durationMs: Math.max(1, Math.round(performance.now() - started)),
  }
}

/** Editor read: whatever is stored → displayable text. */
export async function readContentText(fileId: string, raw: string): Promise<string> {
  try {
    const { bytes } = await decodeStored(fileId, raw)
    return fromUtf8(bytes)
  } catch {
    // Missing key / damaged body — show the raw stored text rather than
    // an empty editor, so the user can see something happened.
    return raw
  }
}

/** Editor write: text → whatever this file's pipeline stores. */
export async function writeContentText(fileId: string, text: string): Promise<string> {
  const meta = await readMeta(fileId)
  const { stored } = await encodeStored(fileId, utf8(text), meta)
  return stored
}
