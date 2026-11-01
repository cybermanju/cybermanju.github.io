<template>
  <main class="ts-studio">
    <header class="ts-header">
      <div class="ts-heading">
        <span class="ts-mark" aria-hidden="true"><AppIcon name="solar:library-bold" :size="22" /></span>
        <div>
          <p class="ts-eyebrow">CYBERMANJU OS APP · REN’PY VISUAL NOVEL</p>
          <h1>The Stem Array</h1>
          <p class="ts-subtitle">Play the Ren’Py visual novel inside CyberManju OS, then manage source materials and route waypoints.</p>
        </div>
      </div>
      <span class="ts-local-badge">Local to this device</span>
    </header>

    <section class="ts-notice" aria-label="Project availability">
      <AppIcon name="solar:info-circle-bold" :size="18" />
      <p>The compact Ren’Py 8.5.3 WebAssembly build passed CI at {{ TECHNOSUTRA_VN_BUILD.validationCommit }} and is staged locally for this OS app. It includes 56 optimized backgrounds and 54 runtime portraits; deployment remains pending review.</p>
    </section>

    <section class="ts-card ts-game-card" aria-labelledby="ts-game-title">
      <header class="ts-card-head">
        <div>
          <p class="ts-kicker">THE STEM ARRAY · REN’PY WASM · {{ TECHNOSUTRA_VN_BUILD.validationCommit }}</p>
          <h2 id="ts-game-title">The Stem Array — play now</h2>
          </div>
          <a class="ts-button ts-button--quiet" :href="gameUrl" target="_blank" rel="noopener noreferrer">Open separately</a>
        </header>
        <aside class="ts-sprite-status" aria-label="Status dos sprites dos mestres">
          <span class="ts-provisional-badge">PROVISÓRIO</span>
          <p><strong>Sprites dos mestres:</strong> 54 retratos frontais transparentes (600 × 800), ainda provisórios e estáticos; não há variações de boca/postura e os slots 43 e 52 não existem no conjunto upstream. O titular confirmou os direitos de distribuição pública. As capturas PNG brutas permanecem fora do pacote.<br /><small>Manifesto de proveniência: <code>integrations/renpy-technosutra/game/images/masters/sprites/manifest.json</code></small></p>
        </aside>
        <div class="ts-game-frame-wrap">
          <iframe class="ts-game-frame" :src="gameUrl" title="The Stem Array — Ren’Py WebAssembly visual novel" allow="fullscreen" allowfullscreen loading="eager" referrerpolicy="strict-origin-when-cross-origin" />
        </div>
        <p class="ts-footnote">The standalone CI smoke verified the Ren’Py canvas/runtime, all 111 progressive images, and keyboard input. It confirms startup, not a complete chapter playthrough or an authenticated-shell visual check.</p>
    </section>

    <div class="ts-grid">
      <section class="ts-card" aria-labelledby="ts-sources-title">
        <header class="ts-card-head">
          <div>
            <p class="ts-kicker">01 · SOURCE MATERIAL</p>
            <h2 id="ts-sources-title">Texts</h2>
          </div>
          <label class="ts-button ts-button--primary">
            <AppIcon name="solar:folder-bold" :size="15" /> Add .md / .pdf
            <input class="ts-file-input" type="file" accept=".md,.markdown,.pdf,text/markdown,application/pdf" multiple aria-label="Add Markdown or PDF source material" @change="onSourceFiles" />
          </label>
        </header>
        <p class="ts-help">Markdown is read locally and can be exported as supplied narration after its adaptation rights are verified. PDFs are recorded by filename only until a PDF text adapter is connected.</p>
        <div v-if="project.sourceMaterials.length === 0" class="ts-empty" role="status">
          <AppIcon name="solar:file-text-bold" :size="21" />
          <strong>Waiting for source files</strong>
          <span>Nothing is preloaded or generated.</span>
        </div>
        <ul v-else class="ts-list">
          <li v-for="source in project.sourceMaterials" :key="source.id" class="ts-row">
            <div class="ts-row-icon"><AppIcon name="solar:file-text-bold" :size="17" /></div>
            <div class="ts-row-main">
              <strong :title="source.name">{{ source.name }}</strong>
              <span>{{ source.format.toUpperCase() }} · {{ formatBytes(source.sizeBytes) }} · {{ source.format === 'markdown' && source.markdownText ? `${markdownBlockCount(source)} source blocks` : 'text not extracted' }}</span>
              <label v-if="source.format === 'markdown' && source.markdownText" class="ts-rights-check">
                <input type="checkbox" :checked="source.adaptationRights === 'authorized-for-adaptation'" @change="setAdaptationRights(source.id, $event)" />
                I have a license or separate permission that allows adapting this source.
              </label>
              <details v-if="source.format === 'markdown' && source.markdownText" class="ts-preview">
                <summary>Preview imported source text</summary>
                <pre>{{ source.markdownText }}</pre>
              </details>
            </div>
            <button class="ts-icon-button" type="button" :aria-label="`Remove ${source.name}`" @click="removeSource(source.id)"><AppIcon name="solar:close-bold" :size="18" /></button>
          </li>
        </ul>
      </section>

      <section class="ts-card" aria-labelledby="ts-route-title">
        <header class="ts-card-head">
          <div>
            <p class="ts-kicker">02 · GEOGRAPHY</p>
            <h2 id="ts-route-title">Street View route</h2>
          </div>
          <AppIcon name="solar:map-bold" :size="21" class="ts-accent-icon" />
        </header>
        <p class="ts-help">Add coordinates supplied by the owner. Opening a point hands off to Google Maps; the app does not embed, download or fabricate panorama imagery.</p>
        <form class="ts-route-form" @submit.prevent="addRoutePoint">
          <label class="ts-field ts-field--wide">Point label<input v-model="routeDraft.title" required maxlength="120" placeholder="Owner-provided place name" /></label>
          <label class="ts-field">Latitude<input v-model="routeDraft.latitude" required inputmode="decimal" type="number" min="-90" max="90" step="any" placeholder="-90 to 90" /></label>
          <label class="ts-field">Longitude<input v-model="routeDraft.longitude" required inputmode="decimal" type="number" min="-180" max="180" step="any" placeholder="-180 to 180" /></label>
          <label class="ts-field ts-field--wide">Heading (optional)<input v-model="routeDraft.heading" inputmode="decimal" type="number" min="-180" max="360" step="any" placeholder="Google Maps camera heading" /></label>
          <button class="ts-button ts-button--primary ts-add-point" type="submit"><AppIcon name="solar:add-bold" :size="15" /> Add waypoint</button>
        </form>
        <div v-if="project.routePoints.length === 0" class="ts-empty ts-empty--compact">
          <strong>No route points yet</strong>
          <span>Use real coordinates from the project owner.</span>
        </div>
        <ul v-else class="ts-list ts-list--routes">
          <li v-for="point in project.routePoints" :key="point.id" class="ts-row">
            <div class="ts-row-icon"><AppIcon name="solar:map-bold" :size="17" /></div>
            <div class="ts-row-main">
              <strong>{{ point.title }}</strong>
              <span class="ts-coordinates">{{ point.latitude }}, {{ point.longitude }}<template v-if="point.heading !== undefined"> · {{ point.heading }}°</template></span>
            </div>
            <button class="ts-button ts-button--quiet" type="button" @click="openStreetView(point)">Open Street View</button>
            <button class="ts-icon-button" type="button" :aria-label="`Remove waypoint ${point.title}`" @click="removeRoutePoint(point.id)"><AppIcon name="solar:close-bold" :size="18" /></button>
          </li>
        </ul>
      </section>

      <section class="ts-card ts-card--integrations" aria-labelledby="ts-integrations-title">
        <header class="ts-card-head">
          <div>
            <p class="ts-kicker">03 · CONNECTORS</p>
            <h2 id="ts-integrations-title">Integration points</h2>
          </div>
        </header>
        <div class="ts-connector">
          <span class="ts-connector-icon"><AppIcon name="solar:file-text-bold" :size="18" /></span>
          <div><strong>PDF text extraction</strong><span>The picker remains metadata-only; the authorized chapter adaptation is in the Ren’Py source, not this web deployment.</span></div>
          <span class="ts-state">LIMITED</span>
        </div>
        <div class="ts-connector">
          <span class="ts-connector-icon"><AppIcon name="solar:info-circle-bold" :size="18" /></span>
          <div><strong>Voice output</strong><span>Waiting for the owner’s separate voice app and adapter contract.</span></div>
          <span class="ts-state">WAITING</span>
        </div>
        <div class="ts-connector">
          <span class="ts-connector-icon"><AppIcon name="solar:code-bold" :size="18" /></span>
          <div><strong>Ren’Py runtime</strong><span>WebAssembly source/build script exist, but the latest package has not passed an in-panel smoke test.</span></div>
          <span class="ts-state">PENDING</span>
        </div>
        <div class="ts-connector">
          <span class="ts-connector-icon"><AppIcon name="solar:file-text-bold" :size="18" /></span>
          <div><strong>Original artwork</strong><span>57 visuals: an original opening environment plus 56 chapter backgrounds; no Street View-derived art.</span></div>
          <span class="ts-state">PACKAGED</span>
        </div>
      </section>

      <section class="ts-card ts-card--export" aria-labelledby="ts-export-title">
        <header class="ts-card-head">
          <div>
            <p class="ts-kicker">04 · HANDOFF</p>
            <h2 id="ts-export-title">Ren’Py export</h2>
          </div>
          <AppIcon name="solar:download-bold" :size="21" class="ts-accent-icon" />
        </header>
        <p class="ts-help">The separate .rpy export uses only Markdown you import and authorize, plus route points you enter. Ren’Py source files are maintained in integrations/renpy-technosutra/.</p>
        <div class="ts-export-actions">
          <button class="ts-button ts-button--primary" type="button" :disabled="!canExportScript" @click="downloadScript"><AppIcon name="solar:code-bold" :size="15" /> Export script.rpy</button>
          <button class="ts-button ts-button--quiet" type="button" @click="downloadManifest"><AppIcon name="solar:file-text-bold" :size="15" /> Export project manifest</button>
        </div>
        <p class="ts-footnote">Script export requires each imported Markdown source to have verified adaptation rights. The source adaptation uses the separate permission confirmed for the supplied PDF. Nothing is uploaded or shared automatically.</p>
      </section>
    </div>

    <p class="ts-status" role="status" aria-live="polite">{{ feedback }}</p>
    <p class="ts-storage-note">Autosave: {{ storageReady ? 'this device’s local browser storage' : 'session only (local storage unavailable)' }}. Nothing is uploaded or synced by this app.</p>
  </main>
</template>

<script setup lang="ts">
// CyberManju OS — Technosutra Studio (src/components/TechnosutraStudio.vue).
// Role: isolated local authoring bridge for the owner-supplied Technosutra sources and Street View route.
// Exports: Vue window panel for source registration, waypoint editing and Ren’Py file handoff.
// Integrates: app-local model/adapters, openExternalUrl and AppIcon; no backend or media generation.
// Contracts: Markdown contents stay under the app's localStorage key; PDF bytes are never read; voice stays unavailable until connected.
import AppIcon from '@/components/AppIcon.vue'
import { TECHNOSUTRA_VN_BUILD } from '@/data/technosutra-vn'
import { computed, reactive, ref, watch } from 'vue'
import { openExternalUrl } from '@/utils/openExternal'
import {
  createEmptyProject,
  exportManifest,
  googleStreetViewUrl,
  loadProject,
  markdownBlocks,
  MAX_MARKDOWN_BYTES,
  renderRenpyScript,
  saveProject,
  validateRoutePoint,
  type RoutePoint,
  type SourceMaterial,
  type TechnosutraProject,
} from '@/integrations/renpy-technosutra/model'

const project = ref<TechnosutraProject>(loadProject())
const gameUrl = new URL(`${import.meta.env.BASE_URL}${TECHNOSUTRA_VN_BUILD.assetBasePath}index.html`, window.location.origin).href
const feedback = ref('Ready. Waiting for the owner-provided source material and route points.')
const storageReady = ref(typeof localStorage !== 'undefined')
const routeDraft = reactive({ title: '', latitude: '', longitude: '', heading: '' })
const canExportScript = computed(() => {
  const sources = project.value.sourceMaterials.filter(source => source.format === 'markdown' && source.markdownText?.trim())
  return sources.length > 0 && markdownBlocks(project.value).length > 0 &&
    sources.every(source => source.adaptationRights === 'authorized-for-adaptation')
})

function newId(): string {
  try { return crypto.randomUUID() } catch { return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
function markdownBlockCount(source: SourceMaterial): number {
  const oneSource = { ...createEmptyProject(), sourceMaterials: [source] }
  return markdownBlocks(oneSource).length
}
function onSourceFiles(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void importSources(files)
}
async function importSources(files: File[]) {
  for (const file of files) {
    const extension = file.name.toLowerCase().split('.').pop()
    const format = extension === 'pdf' ? 'pdf' : extension === 'md' || extension === 'markdown' ? 'markdown' : null
    if (!format) {
      feedback.value = `Skipped “${file.name}”: choose a .md, .markdown or .pdf file.`
      continue
    }
    const material: SourceMaterial = {
      id: newId(), name: file.name.slice(0, 240), format, sizeBytes: file.size, addedAt: new Date().toISOString(), adaptationRights: 'unverified',
    }
    if (format === 'markdown') {
      if (file.size > MAX_MARKDOWN_BYTES) {
        feedback.value = `Skipped “${file.name}”: Markdown is limited to ${formatBytes(MAX_MARKDOWN_BYTES)} per file for local storage.`
        continue
      }
      try {
        material.markdownText = await file.text()
      } catch {
        feedback.value = `Could not read “${file.name}”. The source was not added.`
        continue
      }
    }
    project.value.sourceMaterials.push(material)
    feedback.value = format === 'pdf'
      ? `Registered “${file.name}” by name only; PDF extraction is not connected.`
      : `Imported Markdown source “${file.name}” locally. No text was generated.`
  }
}
function removeSource(id: string) {
  project.value.sourceMaterials = project.value.sourceMaterials.filter(source => source.id !== id)
  feedback.value = 'Source reference removed from this local project.'
}
function setAdaptationRights(id: string, event: Event) {
  const source = project.value.sourceMaterials.find(item => item.id === id)
  if (!source) return
  source.adaptationRights = (event.currentTarget as HTMLInputElement).checked ? 'authorized-for-adaptation' : 'unverified'
  feedback.value = source.adaptationRights === 'authorized-for-adaptation'
    ? `Adaptation rights attested for “${source.name}”.`
    : `Adaptation rights remain unverified for “${source.name}”.`
}
function addRoutePoint() {
  if (!routeDraft.latitude.trim() || !routeDraft.longitude.trim()) {
    feedback.value = 'Enter both latitude and longitude.'
    return
  }
  const point = validateRoutePoint({
    id: newId(), title: routeDraft.title, latitude: routeDraft.latitude,
    longitude: routeDraft.longitude, heading: routeDraft.heading,
  })
  if (!point) {
    feedback.value = 'Check the label, coordinate ranges and optional heading.'
    return
  }
  project.value.routePoints.push(point)
  routeDraft.title = ''
  routeDraft.latitude = ''
  routeDraft.longitude = ''
  routeDraft.heading = ''
  feedback.value = `Added Street View waypoint “${point.title}”.`
}
function removeRoutePoint(id: string) {
  project.value.routePoints = project.value.routePoints.filter(point => point.id !== id)
  feedback.value = 'Waypoint removed from this local project.'
}
async function openStreetView(point: RoutePoint) {
  try {
    await openExternalUrl(googleStreetViewUrl(point))
    feedback.value = `Opened Google Street View for “${point.title}”.`
  } catch (error) {
    feedback.value = `Could not open Street View: ${error instanceof Error ? error.message : String(error)}`
  }
}
function downloadText(name: string, text: string, contentType: string) {
  const blob = new Blob([text], { type: contentType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function downloadScript() {
  try {
    downloadText('technosutra-script.rpy', renderRenpyScript(project.value), 'text/plain;charset=utf-8')
    feedback.value = 'Exported script.rpy from the imported Markdown and current route points.'
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : String(error)
  }
}
function downloadManifest() {
  downloadText('technosutra-project.json', `${JSON.stringify(exportManifest(project.value), null, 2)}\n`, 'application/json;charset=utf-8')
  feedback.value = 'Exported the metadata-only project manifest.'
}
watch(project, (value) => {
  storageReady.value = saveProject(value)
  if (!storageReady.value && !feedback.value.startsWith('Could not')) {
    feedback.value = 'Local storage is unavailable or full; edits remain in this session only.'
  }
}, { deep: true })
</script>

<style scoped>
.ts-studio { height: 100%; min-height: 100%; overflow: auto; padding: clamp(16px, 3vw, 30px); color: var(--ui-text); background: var(--ui-surface); font-family: var(--ui-font); }
.ts-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin: 0 auto 18px; max-width: 1180px; }
.ts-heading { display: flex; align-items: flex-start; gap: 14px; min-width: 0; }
.ts-mark, .ts-row-icon, .ts-connector-icon { display: grid; flex: 0 0 auto; place-items: center; color: var(--ui-accent); background: color-mix(in srgb, var(--ui-accent) 12%, var(--ui-surface)); border: 1px solid color-mix(in srgb, var(--ui-accent) 24%, var(--ui-border)); }
.ts-mark { width: 44px; height: 44px; border-radius: 14px; }
.ts-eyebrow, .ts-kicker { margin: 0 0 5px; color: var(--ui-text-3); font-size: 10px; font-weight: 750; letter-spacing: .12em; }
.ts-heading h1 { margin: 0; font-size: clamp(22px, 3vw, 30px); line-height: 1.1; }
.ts-subtitle { margin: 7px 0 0; color: var(--ui-text-2); font-size: 13px; line-height: 1.5; }
.ts-local-badge, .ts-state { align-self: flex-start; padding: 6px 9px; border: 1px solid var(--ui-border); border-radius: 999px; color: var(--ui-text-2); background: var(--ui-glass); font-size: 10px; font-weight: 700; white-space: nowrap; }
.ts-notice { display: flex; align-items: flex-start; gap: 10px; max-width: 1180px; margin: 0 auto 16px; padding: 11px 13px; color: var(--ui-text-2); background: color-mix(in srgb, var(--ui-accent) 7%, var(--ui-surface)); border: 1px solid color-mix(in srgb, var(--ui-accent) 20%, var(--ui-border)); border-radius: 12px; font-size: 12px; line-height: 1.5; }
.ts-notice :deep(svg) { flex: 0 0 auto; color: var(--ui-accent); }
.ts-notice p { margin: 0; }
.ts-sprite-status { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 12px; padding: 11px 13px; color: var(--ui-text-2); background: color-mix(in srgb, #e4a14b 8%, var(--ui-surface)); border: 1px solid color-mix(in srgb, #e4a14b 35%, var(--ui-border)); border-radius: 12px; font-size: 11px; line-height: 1.5; }
.ts-sprite-status p { margin: 0; min-width: 0; }
.ts-sprite-status small { display: inline-block; margin-top: 3px; color: var(--ui-text-3); overflow-wrap: anywhere; }
.ts-sprite-status code { font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.ts-provisional-badge { flex: 0 0 auto; padding: 4px 7px; border: 1px solid color-mix(in srgb, #e4a14b 55%, var(--ui-border)); border-radius: 999px; color: var(--ui-text-2); background: color-mix(in srgb, #e4a14b 16%, var(--ui-surface)); font-size: 9px; font-weight: 800; letter-spacing: .06em; white-space: nowrap; }
.ts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; max-width: 1180px; margin: 0 auto; align-items: start; }
.ts-game-card { width: 100%; max-width: 1180px; margin: 0 auto 14px; }
.ts-game-frame-wrap { width: 100%; min-height: 360px; max-height: 680px; aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 12px; background: #07070b; }
.ts-game-frame { display: block; width: 100%; height: 100%; min-height: 360px; border: 0; background: #07070b; }
.ts-card { min-width: 0; padding: 16px; background: var(--ui-glass); border: 1px solid var(--ui-border); border-radius: 16px; box-shadow: var(--ui-shadow-1); }
.ts-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; }
.ts-card h2 { margin: 0; font-size: 17px; }
.ts-accent-icon { color: var(--ui-accent); }
.ts-help, .ts-footnote { margin: 0 0 13px; color: var(--ui-text-3); font-size: 11px; line-height: 1.55; }
.ts-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 35px; padding: 0 11px; border: 1px solid var(--ui-border); border-radius: 10px; color: var(--ui-text); background: var(--ui-surface); font: 650 11px/1 var(--ui-font); cursor: pointer; text-decoration: none; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.ts-button:hover:not(:disabled) { border-color: var(--ui-accent); background: color-mix(in srgb, var(--ui-accent) 8%, var(--ui-surface)); }
.ts-button:active:not(:disabled) { transform: scale(.98); }
.ts-button:disabled { opacity: .48; cursor: not-allowed; }
.ts-button--primary { color: var(--ui-accent-contrast, #fff); background: var(--ui-accent); border-color: var(--ui-accent); }
.ts-button--primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ui-accent) 85%, #000); }
.ts-button--quiet { min-height: 30px; padding: 0 9px; font-size: 10px; }
.ts-file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }
.ts-button:focus-within, .ts-button:focus-visible, .ts-icon-button:focus-visible, .ts-field input:focus-visible, .ts-preview summary:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.ts-empty { display: flex; min-height: 118px; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 15px; border: 1px dashed var(--ui-border); border-radius: 12px; color: var(--ui-text-3); text-align: center; font-size: 11px; }
.ts-empty :deep(svg) { color: var(--ui-accent); }
.ts-empty strong { color: var(--ui-text-2); font-size: 12px; }
.ts-empty--compact { min-height: 74px; margin-top: 12px; }
.ts-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ts-row { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px; border: 1px solid var(--ui-border); border-radius: 11px; background: color-mix(in srgb, var(--ui-surface) 74%, transparent); }
.ts-row-icon { width: 32px; height: 32px; border-radius: 10px; }
.ts-row-main { display: grid; flex: 1 1 auto; min-width: 0; gap: 3px; }
.ts-row-main strong { overflow: hidden; color: var(--ui-text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.ts-row-main span { color: var(--ui-text-3); font-size: 10px; }
.ts-rights-check { display: flex; align-items: flex-start; gap: 6px; color: var(--ui-text-2); font-size: 10px; line-height: 1.45; }
.ts-rights-check input { flex: 0 0 auto; margin: 1px 0 0; accent-color: var(--ui-accent); }
.ts-icon-button { display: grid; flex: 0 0 auto; width: 30px; height: 30px; place-items: center; border: 0; border-radius: 8px; color: var(--ui-text-3); background: transparent; cursor: pointer; }
.ts-icon-button:hover { color: var(--ui-danger, #e45c68); background: color-mix(in srgb, var(--ui-danger, #e45c68) 10%, transparent); }
.ts-preview { margin-top: 5px; color: var(--ui-text-2); font-size: 10px; }
.ts-preview summary { width: fit-content; color: var(--ui-accent); cursor: pointer; }
.ts-preview pre { max-height: 150px; overflow: auto; padding: 9px; border-radius: 8px; color: var(--ui-text-2); background: var(--ui-surface); font: 10px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.ts-route-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-bottom: 12px; }
.ts-field { display: grid; gap: 5px; color: var(--ui-text-2); font-size: 10px; font-weight: 650; }
.ts-field--wide { grid-column: 1 / -1; }
.ts-field input { min-width: 0; height: 35px; padding: 0 9px; border: 1px solid var(--ui-border); border-radius: 9px; color: var(--ui-text); background: var(--ui-surface); font: 11px var(--ui-font); }
.ts-add-point { grid-column: 1 / -1; justify-self: start; }
.ts-coordinates { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.ts-connector { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--ui-border); }
.ts-connector-icon { width: 34px; height: 34px; border-radius: 10px; }
.ts-connector div { display: grid; flex: 1; min-width: 0; gap: 3px; }
.ts-connector strong { font-size: 11px; }
.ts-connector div span { color: var(--ui-text-3); font-size: 10px; line-height: 1.4; }
.ts-state { padding: 4px 7px; color: var(--ui-text-3); font-size: 9px; letter-spacing: .06em; }
.ts-export-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.ts-footnote { margin-bottom: 0; }
.ts-status { max-width: 1180px; margin: 14px auto 0; color: var(--ui-text-2); font-size: 11px; }
.ts-storage-note { max-width: 1180px; margin: 5px auto 0; color: var(--ui-text-3); font-size: 10px; }
@media (max-width: 720px) {
  .ts-header { flex-direction: column; }
  .ts-grid { grid-template-columns: 1fr; }
  .ts-game-frame-wrap, .ts-game-frame { min-height: 300px; }
  .ts-card-head { align-items: flex-start; }
  .ts-row { flex-wrap: wrap; }
  .ts-row-main { flex-basis: calc(100% - 52px); }
  .ts-row .ts-button--quiet { margin-left: 41px; }
}
@media (prefers-reduced-motion: reduce) { .ts-button { transition: none; } }
</style>
