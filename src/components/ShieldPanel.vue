<template>
  <div class="shield-panel">
    <div class="panel-header">
      <div class="header-left">
        <span class="icon-shield"><AppIcon name="solar:shield-check-bold" /></span>
        <h2 class="panel-title">Security</h2>
      </div>
      <button class="close-btn" @click="$emit('close')" aria-label="Close"><AppIcon name="solar:close-bold" :size="13" /></button>
    </div>

    <div class="sh-tabs" role="tablist" aria-label="Shield views">
      <button role="tab" :aria-selected="activeTab === 'shield'" :class="{ on: activeTab === 'shield' }" type="button" @click="activeTab = 'shield'">Shield</button>
      <button role="tab" :aria-selected="activeTab === 'compress'" :class="{ on: activeTab === 'compress' }" type="button" @click="activeTab = 'compress'">Compress</button>
    </div>

    <!-- ══ SHIELD (merged encryption panel) ══ -->
    <div v-if="activeTab === 'shield'" class="sh-shield">
      <div class="status-card" :class="{ protected: encryptionStatus?.isEncrypted }">
        <div class="status-top">
          <span class="status-badge" :class="encryptionStatus?.isEncrypted ? 'badge-protected' : 'badge-unprotected'">
            {{ encryptionStatus?.isEncrypted ? 'Protected' : 'Not protected' }}
          </span>
        </div>

        <div class="status-details" v-if="encryptionStatus?.isEncrypted">
          <div class="algo-name">
            <span>{{ encryptionStatus.algorithm || 'Unknown' }}</span>
            <span class="nist-stars">
              <span v-for="n in (encryptionStatus.nistLevel || 0)" :key="n" class="star filled">*</span>
              <span v-for="n in 5 - (encryptionStatus.nistLevel || 0)" :key="'e' + n" class="star empty">o</span>
            </span>
          </div>
          <div class="status-meta">
            <span class="meta-label">Key</span>
            <span class="mono">{{ encryptionStatus.keyId || '--' }}</span>
          </div>
          <div class="status-meta" v-if="encryptionStatus.encryptedAt">
            <span class="meta-label">Encrypted</span>
            <span class="mono">{{ formatDate(encryptionStatus.encryptedAt) }}</span>
          </div>
        </div>
        <div class="status-details" v-else>
          <p class="unprotected-msg">No encryption active yet. Generate a key below to protect your files.</p>
        </div>

        <div class="nist-viz">
          <span class="nist-label">Strength</span>
          <div class="nist-circles">
            <div v-for="n in 5" :key="n" class="nist-circle" :class="{ filled: n <= (encryptionStatus?.nistLevel || 0) }">
              <span class="circle-num">{{ n }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="web-note" :class="{ info: !webLocked }">{{ cryptoNote }}</div>

      <div class="section">
        <h3 class="section-title"><AppIcon name="solar:key-bold" :size="13" /> New key</h3>
        <div class="algo-buttons">
          <button v-for="(info, algo) in ENCRYPTION_INFO" :key="algo" class="algo-btn" :disabled="webLocked" :title="webLocked ? 'Needs the desktop app or offline build' : 'Generate ' + info.name" @click="handleGenerate(algo as EncryptionAlgo)">
            <div class="algo-top">
              <span class="nist-badge">L{{ info.nistLevel }}</span>
            </div>
            <span class="algo-name">{{ info.name }}</span>
            <span class="algo-desc text-muted">{{ info.description }}</span>
          </button>
        </div>
      </div>

      <div class="section" v-if="encryptionKeys.length > 0">
        <h3 class="section-title"><AppIcon name="solar:key-bold" :size="13" /> Keys ({{ encryptionKeys.length }})</h3>
        <div class="keys-list">
          <div v-for="key in encryptionKeys" :key="key.id" class="key-card">
            <div class="key-header">
              <span class="key-algo">{{ key.algorithmDisplay }}</span>
              <span class="nist-badge small">L{{ key.nistLevel }}</span>
            </div>
            <div class="key-pub-preview mono">{{ key.publicKeyPreview.slice(0, 16) }}..</div>
            <div class="key-date text-muted">{{ formatDate(key.createdAt) }}</div>
          </div>
        </div>
      </div>

      <div class="section" v-if="selectedFile">
        <h3 class="section-title"><AppIcon name="solar:lock-bold" :size="13" /> Encrypt selected file</h3>
        <p class="selected-file-name">{{ selectedFile.name }}</p>
        <div class="encrypt-actions">
          <select v-model="encAlgo" class="encrypt-select">
            <option v-for="(info, algo) in ENCRYPTION_INFO" :key="algo" :value="algo">{{ info.name }} (L{{ info.nistLevel }})</option>
          </select>
          <button class="encrypt-btn" :disabled="webLocked" :title="webLocked ? 'Needs the desktop app or offline build' : 'Encrypt file'" @click="handleEncrypt"><AppIcon name="solar:lock-bold" :size="14" /></button>
        </div>
      </div>
    </div>

    <!-- ══ COMPRESS (merged compression panel) ══ -->
    <div v-else class="sh-compress">
      <div class="section">
        <h3 class="section-title"><AppIcon name="solar:archive-bold" :size="13" /> Algorithm</h3>
        <div class="algo-list">
          <button
            v-for="(info, type) in COMPRESSION_INFO"
            :key="type"
            class="algo-btn"
            :class="{ selected: cmpAlgo === type }"
            :disabled="webLocked || !layerCapable(type as CompressionType)"
            :title="webLocked || !layerCapable(type as CompressionType) ? 'Not available in this build' : `Compress with ${info.name}`"
            @click="cmpAlgo = type as CompressionType"
          >
            <div class="algo-header">
              <span class="algo-name">{{ info.name }}</span>
              <span class="algo-speed">{{ info.speed }}</span>
            </div>
            <span class="algo-desc text-muted">{{ info.description }}</span>
          </button>
        </div>
      </div>

      <div class="web-note" :class="{ info: !webLocked }">{{ compressNote }}</div>

      <div class="section" v-if="selectedFile">
        <h3 class="section-title"><AppIcon name="solar:file-bold" :size="13" /> Selected file</h3>
        <p class="selected-file-name">{{ selectedFile.name }}</p>
        <button class="compress-btn" :disabled="webLocked" :title="webLocked ? 'Needs the desktop app or offline build' : 'Compress file'" @click="handleCompress"><AppIcon name="solar:archive-bold" :size="14" /> Compress</button>
      </div>

      <div class="section" v-if="compressionStats">
        <h3 class="section-title"><AppIcon name="solar:chart-bold" :size="13" /> Result</h3>
        <div class="stats-card">
          <div class="stat-row">
            <span class="stat-key text-muted">Original</span>
            <span class="stat-value">{{ humanBytes(compressionStats.originalSize) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-key text-muted">Compressed</span>
            <span class="stat-value">{{ humanBytes(compressionStats.compressedSize) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-key text-muted">Ratio</span>
            <span class="stat-value">{{ (compressionStats.ratio * 100).toFixed(1) }}%</span>
          </div>
          <div class="stat-row">
            <span class="stat-key text-muted">Time</span>
            <span class="stat-value">{{ compressionStats.durationMs }}ms</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { humanBytes } from '@/utils/format'
import { isStaticHost } from '@/composables/useTauri'
import { compressionCapable } from '@/composables/useWasmCrypto'
import type { EncryptionAlgo, CompressionType } from '@/types'
import { ENCRYPTION_INFO, COMPRESSION_INFO } from '@/types'

const store = useAppStore()
const emit = defineEmits<{ close: [] }>()

// Merged shield window: `compression` opens here on the compress tab.
const props = defineProps<{ tab?: string }>()
const activeTab = ref<'shield' | 'compress'>(props.tab === 'compress' ? 'compress' : 'shield')
watch(() => props.tab, (t) => { if (t === 'shield' || t === 'compress') activeTab.value = t })

// Static/offline build: the wasm pack runs the real ciphers, keys live in
// `.cybermanju`. Dashboard build: no crypto/compression endpoint exists there.
const staticWasm = isStaticHost()
const webLocked = computed(() => !staticWasm)
const cryptoNote = computed(() =>
  webLocked
    ? 'ENCRYPTION OPS NEED THE TAURI DESKTOP APP OR THE OFFLINE BROWSER BUILD — THIS DASHBOARD BUILD SERVES NO CRYPTO ENDPOINT. STATUS + KEY LIST ABOVE ARE LIVE.'
    : 'KEYS AND PER-FILE METADATA LIVE INSIDE .CYBERMANJU. BYTES ARE SEALED WITH CHACHA20-POLY1305 (HKDF-DERIVED FROM YOUR KEYPAIR); THE ML-KEM / FRODO / AES SLOTS USE THE NEAREST WASM CIPHER AND SAY SO.'
)

// The wasm pack ships lz4 + brotli; zstd (and therefore triple) stays in the
// desktop app. The dashboard build has no compression endpoint at all.
const compressNote = computed(() => {
  if (webLocked) {
    return 'COMPRESSION NEEDS THE TAURI DESKTOP APP OR THE OFFLINE BROWSER BUILD — THIS DASHBOARD BUILD SERVES NO COMPRESSION ENDPOINT.'
  }
  return 'LZ4 + BROTLI RUN IN THE WASM PACK AND WRITE INTO .CYBERMANJU. ZSTD / TRIPLE NEED THE DESKTOP APP (THE WASM PACK HAS NO ZSTD).'
})

function layerCapable(type: CompressionType): boolean {
  return !staticWasm || compressionCapable(type)
}

const encryptionStatus = computed(() => store.encryptionStatus)
const encryptionKeys = computed(() => store.encryptionKeys)
const selectedFile = computed(() => store.selectedFile)
const compressionStats = computed(() => store.compressionStats)

const encAlgo = ref<EncryptionAlgo>('kyber1024')
const cmpAlgo = ref<CompressionType>(staticWasm ? 'lz4' : 'zstd')

function formatDate(iso: string): string {
  if (!iso) return '--'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function handleGenerate(algo: EncryptionAlgo) {
  await store.generateKeypair(algo)
}

async function handleEncrypt() {
  if (!store.selectedFileId) return
  await store.encryptFile(store.selectedFileId, encAlgo.value)
}

async function handleCompress() {
  if (!store.selectedFileId) return
  await store.compressFile(store.selectedFileId, cmpAlgo.value)
}
</script>

<style scoped>
.shield-panel {
  width: 100%;
  height: 100%;
  background: var(--ui-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  scrollbar-gutter: stable;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-family: var(--ui-font);
  color: var(--ui-text);
}
.shield-panel::-webkit-scrollbar { width: 10px; }
.shield-panel::-webkit-scrollbar-track { background: transparent; }
.shield-panel::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ui-accent) 45%, transparent);
  border-radius: var(--ui-radius-full); border: 3px solid transparent; background-clip: content-box; }
.shield-panel::-webkit-scrollbar-thumb:hover { background: var(--ui-accent); background-clip: content-box; border: 2px solid transparent; }

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-border);
}
.header-left { display: flex; align-items: center; gap: 8px; }
.icon-shield { font-size: 16px; }
.panel-title { font-size: 13px; font-weight: 600; margin: 0; }
.close-btn {
  background: none; border: 1px solid var(--ui-border); color: var(--ui-text);
  cursor: pointer; width: 24px; height: 24px; display: flex; align-items: center;
  justify-content: center; font-size: 11px; font-weight: 700;
}
.close-btn:hover { background: var(--ui-glass-2); }

.sh-tabs { display: flex; gap: 4px; }
.sh-tabs button {
  flex: 1; padding: 6px 0; font-size: 12px; font-weight: 500;
  background: transparent; border: 1px solid transparent; border-radius: 8px;
  color: var(--ui-text-3); cursor: pointer;
}
.sh-tabs button.on {
  color: var(--ui-text);
  background: color-mix(in srgb, var(--ui-text) 8%, transparent);
  font-weight: 600;
}

.sh-shield, .sh-compress { display: flex; flex-direction: column; gap: 16px; min-height: 0; }

.web-note {
  border: 1px dashed var(--ui-warning);
  color: var(--ui-warning);
  font-size: 9px;
  line-height: 1.5;
  padding: 8px 10px;
  letter-spacing: 0.3px;
}
.web-note.info {
  border-color: color-mix(in srgb, var(--ui-accent) 60%, transparent);
  color: var(--ui-accent);
}

.section { display: flex; flex-direction: column; gap: 10px; }
.section-title {
  font-size: 12px; font-weight: 600;
  color: var(--ui-text);
  margin: 0; display: flex; align-items: center; gap: 6px;
  padding-bottom: 4px; border-bottom: 1px solid var(--ui-hairline);
}

/* ── shield tab ── */
.sh-shield .status-card { border: 1px solid var(--ui-border); padding: 12px; background: var(--ui-surface); }
.sh-shield .status-card.protected { border-width: 3px; }
.sh-shield .status-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.sh-shield .status-badge { font-size: 10px; font-weight: 800; letter-spacing: 1px; padding: 3px 8px; border: 1px solid var(--ui-border); }
.sh-shield .badge-protected { background: var(--ui-glass-2); }
.sh-shield .status-details { display: flex; flex-direction: column; gap: 4px; }
.sh-shield .algo-name { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px; }
.sh-shield .nist-stars { font-size: 11px; }
.sh-shield .star.filled { color: var(--ui-text); }
.sh-shield .star.empty { color: color-mix(in srgb, var(--ui-text) 35%, transparent); }
.sh-shield .status-meta { font-size: 10px; display: flex; gap: 4px; color: color-mix(in srgb, var(--ui-text) 70%, transparent); }
.sh-shield .meta-label { color: color-mix(in srgb, var(--ui-text) 50%, transparent); min-width: 50px; }
.sh-shield .unprotected-msg { font-size: 11px; color: color-mix(in srgb, var(--ui-text) 70%, transparent); margin: 0; }
.sh-shield .nist-viz { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ui-hairline); display: flex; align-items: center; gap: 10px; }
.sh-shield .nist-label { font-size: 9px; letter-spacing: 1px; color: color-mix(in srgb, var(--ui-text) 50%, transparent); white-space: nowrap; }
.sh-shield .nist-circles { display: flex; gap: 4px; }
.sh-shield .nist-circle { width: 24px; height: 24px; border: 1px solid var(--ui-hairline); background: var(--ui-surface); display: flex; align-items: center; justify-content: center; }
.sh-shield .nist-circle.filled { border-color: var(--ui-border-strong); background: var(--ui-glass-2); }
.sh-shield .circle-num { font-size: 10px; font-weight: 700; color: color-mix(in srgb, var(--ui-text) 50%, transparent); }
.sh-shield .nist-circle.filled .circle-num { color: var(--ui-text); }
.sh-shield .algo-buttons { display: flex; flex-direction: column; gap: 6px; }
.sh-shield .algo-btn {
  background: var(--ui-surface); border: 1px solid var(--ui-border); padding: 8px 10px;
  cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 3px;
  color: var(--ui-text); font-family: var(--ui-font);
}
.sh-shield .algo-btn:hover { background: var(--ui-glass-2); }
.sh-shield .algo-btn:hover .algo-desc { color: var(--ui-text) !important; }
.sh-shield .algo-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.sh-shield .algo-top { display: flex; align-items: center; gap: 6px; }
.sh-shield .nist-badge { font-size: 9px; font-weight: 800; padding: 1px 4px; border: 1px solid var(--ui-border-strong); }
.sh-shield .nist-badge.small { font-size: 8px; }
.sh-shield .algo-name { font-size: 11px; font-weight: 700; }
.sh-shield .algo-desc { font-size: 10px; line-height: 1.3; }
.sh-shield .keys-list { display: flex; flex-direction: column; gap: 6px; }
.sh-shield .key-card { border: 1px solid var(--ui-border); padding: 8px 10px; display: flex; flex-direction: column; gap: 3px; background: var(--ui-surface); }
.sh-shield .key-header { display: flex; align-items: center; gap: 6px; }
.sh-shield .key-algo { font-size: 11px; font-weight: 700; }
.sh-shield .key-pub-preview { font-size: 10px; color: color-mix(in srgb, var(--ui-text) 50%, transparent); background: color-mix(in srgb, var(--ui-text) 6%, transparent); padding: 3px 6px; word-break: break-all; }
.sh-shield .key-date { font-size: 10px; }
.sh-shield .selected-file-name { font-size: 11px; background: color-mix(in srgb, var(--ui-text) 6%, transparent); padding: 4px 8px; border: 1px solid var(--ui-hairline); word-break: break-all; margin: 0; }
.sh-shield .encrypt-actions { display: flex; gap: 6px; }
.sh-shield .encrypt-select { flex: 1; background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); padding: 6px 8px; font-size: 10px; cursor: pointer; }
.sh-shield .encrypt-btn { background: var(--ui-glass-2); color: var(--ui-text); border: 1px solid var(--ui-border); padding: 6px 12px; font-size: 10px; font-weight: 800; cursor: pointer; }
.sh-shield .encrypt-btn:hover { background: var(--ui-surface); }
.sh-shield .encrypt-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── compress tab ── */
.sh-compress .algo-list { display: flex; flex-direction: column; gap: 6px; }
.sh-compress .algo-btn {
  background: var(--ui-surface); border: 1px solid var(--ui-border); padding: 8px 10px;
  cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 3px;
  color: var(--ui-text); font-family: var(--ui-font);
}
.sh-compress .algo-btn:hover { background: var(--ui-glass-2); }
.sh-compress .algo-btn.selected { border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.sh-compress .algo-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.sh-compress .algo-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.sh-compress .algo-name { font-size: 11px; font-weight: 700; }
.sh-compress .algo-speed { font-size: 9px; color: color-mix(in srgb, var(--ui-text) 60%, transparent); }
.sh-compress .algo-desc { font-size: 10px; line-height: 1.3; }
.sh-compress .selected-file-name { font-size: 11px; background: color-mix(in srgb, var(--ui-text) 6%, transparent); padding: 4px 8px; border: 1px solid var(--ui-hairline); word-break: break-all; margin: 0; }
.sh-compress .compress-btn {
  background: var(--ui-glass-2); color: var(--ui-text); border: 1px solid var(--ui-border);
  padding: 8px 12px; font-size: 10px; font-weight: 800; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.sh-compress .compress-btn:hover:not(:disabled) { background: var(--ui-surface); }
.sh-compress .compress-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.sh-compress .stats-card { border: 1px solid var(--ui-border); padding: 10px; display: flex; flex-direction: column; gap: 4px; }
.sh-compress .stat-row { display: flex; justify-content: space-between; font-size: 10px; }
.sh-compress .stat-key { color: color-mix(in srgb, var(--ui-text) 50%, transparent); }
.sh-compress .stat-value { font-weight: 700; }

.mono { font-family: var(--ui-font-mono); }
.text-muted { color: color-mix(in srgb, var(--ui-text) 50%, transparent) !important; }
</style>
