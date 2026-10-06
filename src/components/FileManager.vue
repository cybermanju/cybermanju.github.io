<template>
  <div ref="rootRef" class="fm" :class="{ 'fm-drop': isOverDropZone }" tabindex="0" @keydown="onKeydown">
    <div class="fm-aurora" aria-hidden="true" />
    <div class="fm-grain" aria-hidden="true" />

    <!-- ══ TOP COMMAND BAR ══ -->
    <header class="fm-top">
      <div class="fm-nav">
        <button class="fm-ibtn" title="Back" aria-label="Back" :disabled="!canBack" @click="goBack"><AppIcon name="solar:alt-arrow-left-bold" :size="15" /></button>
        <button class="fm-ibtn" title="Forward" aria-label="Forward" :disabled="!canFwd" @click="goFwd"><AppIcon name="solar:alt-arrow-right-bold" :size="15" /></button>
        <button class="fm-ibtn" title="Up one level" aria-label="Up" @click="goUp"><AppIcon name="solar:alt-arrow-up-bold" :size="15" /></button>
        <button class="fm-ibtn" title="Home" aria-label="Home" @click="goHome"><AppIcon name="solar:house-bold" :size="15" /></button>
        <button class="fm-ibtn" title="Refresh" aria-label="Refresh" @click="refresh"><AppIcon name="solar:refresh-bold" :size="15" /></button>
      </div>

      <nav class="fm-crumbs" aria-label="Breadcrumb">
        <button
          v-for="(c, i) in crumbs"
          :key="i"
          class="fm-crumb"
          :class="{ active: i === crumbs.length - 1 }"
          :title="c.path"
          @click="jumpCrumb(c.path)"
        >
          <AppIcon v-if="i === 0" name="solar:ssd-square-bold" :size="12" />
          <AppIcon v-else-if="i === crumbs.length - 1" name="solar:folder-open-bold" :size="12" />
          <AppIcon v-else name="solar:folder-bold" :size="12" />
          <span>{{ c.label }}</span>
          <span v-if="i < crumbs.length - 1" class="fm-crumb-sep">/</span>
        </button>
      </nav>

      <div class="fm-search">
        <AppIcon name="solar:magnifier-bold" :size="13" />
        <input v-model="filterQuery" placeholder="Filter + ⏎ global search…" aria-label="Filter files" @keydown.enter="globalSearch" />
        <button v-if="filterQuery" class="fm-x" title="Clear" aria-label="Clear filter" @click="filterQuery = ''"><AppIcon name="solar:close-bold" :size="11" /></button>
      </div>

      <div class="fm-viewswitch" role="tablist" aria-label="View mode">
        <button
          v-for="v in viewModes"
          :key="v.id"
          role="tab"
          :aria-selected="view === v.id"
          class="fm-vbtn"
          :class="{ active: view === v.id }"
          :title="v.hint"
          @click="setView(v.id)"
        >
          <AppIcon :name="v.icon" :size="14" />
        </button>
      </div>

      <div class="fm-topactions">
        <button class="fm-pill" title="New folder" @click="dlgFolder = true"><AppIcon name="solar:add-folder-bold" :size="13" /> <span>New</span></button>
        <button class="fm-pill" title="Upload / new file" @click="onUploadClick"><AppIcon name="solar:upload-bold" :size="13" /> <span>File</span></button>
        <button class="fm-pill ghost" :class="{ on: termOpen }" title="Toggle inline terminal (cybsh here)" @click="toggleTerm"><AppIcon name="solar:file-terminal-bold" :size="13" /> <span>Terminal</span></button>
        <button class="fm-pill ghost" :class="{ on: inspectorOpen }" title="Toggle inspector" @click="inspectorOpen = !inspectorOpen"><AppIcon name="solar:info-circle-bold" :size="13" /> <span>Info</span></button>
      </div>
    </header>

    <!-- ══ SUB BAR: live volume / sync / selection ══ -->
    <div class="fm-sub">
      <span class="fm-stat"><b>{{ sortedFiles.length }}</b> items</span>
      <span class="fm-dot" />
      <span class="fm-stat"><b>{{ selCount }}</b> selected · <b>{{ humanBytes(selBytes) }}</b></span>
      <span class="fm-dot" />
      <span class="fm-stat hide-sm">{{ humanBytes(folderBytes) }} in view</span>
      <span class="fm-spacer" />
      <div v-if="df" class="fm-vol" :title="`${humanBytes(df.usedBytes)} of ${humanBytes(df.totalBytes)} — ${df.diskCount} disks`">
        <div class="fm-volbar"><i :style="{ width: volPct + '%' }" /></div>
        <span class="fm-stat mono">{{ volPct.toFixed(0) }}% vol</span>
      </div>
      <button
        v-for="p in providerChips"
        :key="p.id"
        class="fm-pchip"
        :class="{ off: !p.enabled }"
        :title="`${p.label} — ${p.enabled ? 'enabled' : 'disabled'}${p.detail ? ' · ' + p.detail : ''}`"
        @click="openSync(p.id)"
      >
        <i :style="{ background: p.color }" />
        {{ p.short }}
      </button>
      <button class="fm-pill xs ghost" title="Open sync panel" @click="wm.open('sync')"><AppIcon name="solar:refresh-bold" :size="11" /> Sync</button>
      <button class="fm-pill xs ghost" title="Open disks & volume" @click="wm.open('disks')"><AppIcon name="solar:ssd-square-bold" :size="11" /> Disks</button>
    </div>

    <!-- ══ MAIN SPLIT ══ -->
    <div class="fm-main" :class="{ 'no-side': !sideOpen, 'no-insp': !inspectorOpen }">
      <!-- SIDEBAR -->
      <aside v-if="sideOpen" class="fm-side">
        <div class="fm-side-sec">
          <div class="fm-side-h">VOLUME</div>
          <button class="fm-srow" :class="{ active: !scopeFolder }" @click="goHome">
            <AppIcon name="solar:ssd-square-bold" :size="14" />
            <span class="t">Vault root</span>
            <span class="m mono">{{ humanBytes(df?.totalBytes) }}</span>
          </button>
          <button
            v-for="d in store.disks"
            :key="d.id"
            class="fm-srow"
            :title="`${d.name} · ${d.provider} · ${humanBytes(d.usedBytes)} / ${humanBytes(d.capacityBytes)} · ${d.state}`"
            @click="wm.open('disks')"
          >
            <i class="fm-pdot" :class="d.state" />
            <span class="t truncate">{{ d.name }}</span>
            <span class="m mono">{{ Math.round(diskPct(d.usedBytes, d.capacityBytes)) }}%</span>
          </button>
          <div v-if="!store.disks.length" class="fm-sempty">No disks — create one in Disks.</div>
        </div>
        <div class="fm-side-sec">
          <div class="fm-side-h">FOLDERS</div>
          <button
            v-for="f in folders"
            :key="f.id"
            class="fm-srow"
            :class="{ active: store.selectedFileId === f.id }"
            @click="openFolder(f)"
            @dblclick="openFolder(f)"
            @contextmenu.prevent="fileMenu($event, f)"
          >
            <AppIcon name="solar:folder-bold" :size="14" />
            <span class="t truncate">{{ f.name }}</span>
          </button>
          <div v-if="!folders.length" class="fm-sempty">No subfolders here.</div>
        </div>
        <div class="fm-side-sec">
          <div class="fm-side-h">FAVORITES · {{ store.starredFiles.length }}</div>
          <button
            v-for="f in store.starredFiles.slice(0, 8)"
            :key="f.id"
            class="fm-srow"
            @click="revealFile(f)"
          >
            <AppIcon name="solar:star-bold" :size="13" />
            <span class="t truncate">{{ f.name }}</span>
          </button>
          <div v-if="!store.starredFiles.length" class="fm-sempty">Star anything to pin it.</div>
        </div>
        <div class="fm-side-sec">
          <div class="fm-side-h">TAGS</div>
          <div class="fm-tags">
            <button v-for="t in allTags.slice(0, 14)" :key="t" class="fm-tag" @click="filterQuery = t">#{{ t }}</button>
            <span v-if="!allTags.length" class="fm-sempty">No tags yet.</span>
          </div>
        </div>
      </aside>

      <!-- CENTER -->
      <section class="fm-center">
        <div class="fm-ctool">
          <button class="fm-ibtn sm" :title="sideOpen ? 'Hide sidebar' : 'Show sidebar'" @click="sideOpen = !sideOpen"><AppIcon name="solar:sidebar-bold" :size="13" /></button>
          <select v-model="sortField" class="fm-select" title="Sort by" aria-label="Sort by">
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="date">Modified</option>
            <option value="type">Type</option>
          </select>
          <button class="fm-ibtn sm" :title="sortDir === 'asc' ? 'Ascending — flip to descending' : 'Descending — flip to ascending'" @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'">
            <AppIcon :name="sortDir === 'asc' ? 'solar:sort-from-bottom-to-top-bold' : 'solar:sort-from-top-to-bottom-bold'" :size="13" />
          </button>
          <button class="fm-chipbtn" :class="{ on: showHidden }" title="Show hidden files" @click="showHidden = !showHidden">hidden</button>
          <button class="fm-chipbtn" :class="{ on: onlyMedia }" title="Only media" @click="onlyMedia = !onlyMedia">media</button>
          <button class="fm-chipbtn" :class="{ on: density === 'compact' }" title="Toggle compact density" @click="density = density === 'compact' ? 'cozy' : 'compact'">compact</button>
          <span class="fm-spacer" />
          <button class="fm-pill xs" title="Select all (Ctrl+A)" @click="selectAll">All</button>
          <button class="fm-pill xs ghost" title="Clear selection (Esc)" @click="clearSel">None</button>
          <button class="fm-pill xs ghost" title="Open current folder in cybsh" @click="openFolderInTerm()"><AppIcon name="solar:file-terminal-bold" :size="11" /> cd here</button>
        </div>

        <div v-if="selCount > 0" class="fm-bulk" role="toolbar" aria-label="Bulk actions">
          <span class="fm-bulk-n">{{ selCount }} selected · {{ humanBytes(selBytes) }}</span>
          <button title="Encrypt" @click="bulkEncrypt"><AppIcon name="solar:lock-bold" :size="12" /></button>
          <button title="Compress (zstd)" @click="bulkCompress"><AppIcon name="solar:archive-bold" :size="12" /></button>
          <button title="Sync to provider…" @click="bulkSync"><AppIcon name="solar:cloud-bold" :size="12" /></button>
          <button title="Star" @click="bulkStar"><AppIcon name="solar:star-bold" :size="12" /></button>
          <button title="Copy" @click="copySel"><AppIcon name="solar:copy-bold" :size="12" /></button>
          <button title="Cut" @click="cutSel"><AppIcon name="solar:scissors-bold" :size="12" /></button>
          <button title="Paste here" :disabled="!clipboard.ids.length" @click="pasteHere"><AppIcon name="solar:clipboard-paste-bold" :size="12" /></button>
          <button class="danger" title="Delete" @click="askDeleteSel"><AppIcon name="solar:trash-bin-trash-bold" :size="12" /></button>
          <button title="Clear" @click="clearSel"><AppIcon name="solar:close-bold" :size="12" /></button>
        </div>

        <!-- GRID -->
        <div
          v-if="view === 'grid' || view === 'masonry'"
          ref="scrollRef"
          class="fm-grid"
          :class="[view, density]"
          @scroll="onScroll"
          @contextmenu.prevent="bgMenu($event)"
        >
          <button
            v-for="f in renderFiles"
            :key="f.id"
            v-memo="[f.name, f.sizeBytes, f.modifiedAt, isSel(f.id), isBulk(f.id), f.encrypted, encLayer(f), f.isStarred]"
            class="fm-card"
            :class="{ sel: isSel(f.id), bulk: isBulk(f.id) }"
            :title="f.name"
            @click="clickFile(f, $event)"
            @dblclick="openFile(f)"
            @contextmenu.prevent.stop="fileMenu($event, f)"
            draggable="true"
            @dragstart="onDrag($event, f)"
          >
            <span class="fm-check" :class="{ on: isBulk(f.id) }" @click.stop="toggleBulk(f.id)">{{ isBulk(f.id) ? '✓' : '' }}</span>
            <span class="fm-thumb">
              <img v-if="f.thumbnailPath" :src="f.thumbnailPath" alt="" loading="lazy" decoding="async" @error="hideImg" />
              <AppIcon v-else :name="iconFor(f)" :size="26" />
            </span>
            <span class="fm-cname truncate">{{ f.name }}</span>
            <span class="fm-cmeta mono">{{ humanBytes(f.sizeBytes) }}</span>
            <span class="fm-flags">
              <AppIcon v-if="f.encrypted" name="solar:lock-bold" :size="10" title="Encrypted" />
              <AppIcon v-if="encLayer(f) !== 'none'" name="solar:archive-bold" :size="10" title="Compressed" />
              <AppIcon v-if="f.isStarred" name="solar:star-bold" :size="10" title="Starred" />
              <AppIcon v-if="f.gpsLat != null" name="solar:map-point-bold" :size="10" title="Geo-tagged" />
            </span>
          </button>
          <div v-if="!renderFiles.length && !store.isLoading" class="fm-empty">
            <AppIcon name="solar:folder-open-bold" :size="30" />
            <p>Empty folder</p>
            <span>Drop files, paste, upload — or create something new.</span>
          </div>
          <div v-if="store.isLoading" class="fm-empty"><span class="fm-spin" /> Loading…</div>
          <button v-if="renderLimit < sortedFiles.length" class="fm-more" @click="renderLimit += 300">Show more ({{ sortedFiles.length - renderLimit }} left)</button>
        </div>

        <!-- LIST / DETAILS -->
        <div
          v-else-if="view === 'list' || view === 'details'"
          ref="scrollRef"
          class="fm-listwrap"
          @scroll="onScroll"
          @contextmenu.prevent="bgMenu($event)"
        >
          <div class="fm-lhead" :class="density">
            <span class="c0" @click="selectAll" title="Select all"><span class="fm-check sm" :class="{ on: allBulk }">{{ allBulk ? '✓' : '' }}</span></span>
            <span class="c1" @click="setSort('name')">Name {{ arrow('name') }}</span>
            <span class="c2" @click="setSort('size')">Size {{ arrow('size') }}</span>
            <span v-if="view === 'details'" class="c3">Algo / Layer</span>
            <span v-else class="c3" @click="setSort('type')">Type {{ arrow('type') }}</span>
            <span class="c4" @click="setSort('date')">Modified {{ arrow('date') }}</span>
            <span class="c5">Hash</span>
            <span class="c6">Flags</span>
          </div>
          <div class="fm-lbody">
            <div
              v-for="f in renderFiles"
              :key="f.id"
              v-memo="[f.name, f.sizeBytes, f.modifiedAt, isSel(f.id), isBulk(f.id), f.encrypted, encLayer(f), f.isStarred]"
              class="fm-lrow"
              :class="[{ sel: isSel(f.id), bulk: isBulk(f.id) }, density]"
              @click="clickFile(f, $event)"
              @dblclick="openFile(f)"
              @contextmenu.prevent.stop="fileMenu($event, f)"
              draggable="true"
              @dragstart="onDrag($event, f)"
            >
              <span class="c0"><span class="fm-check sm" :class="{ on: isBulk(f.id) }" @click.stop="toggleBulk(f.id)">{{ isBulk(f.id) ? '✓' : '' }}</span></span>
              <span class="c1">
                <span class="fm-ficon"><img v-if="f.thumbnailPath" :src="f.thumbnailPath" alt="" loading="lazy" decoding="async" @error="hideImg" /><AppIcon v-else :name="iconFor(f)" :size="15" /></span>
                <span class="truncate" :title="f.name">{{ f.name }}</span>
              </span>
              <span class="c2 mono">{{ humanBytes(f.sizeBytes) }}</span>
              <span v-if="view === 'details'" class="c3 mono">{{ cryptoLabel(f) }}</span>
              <span v-else class="c3 dim truncate">{{ shortType(f) }}</span>
              <span class="c4 mono dim">{{ fmtDate(f.modifiedAt) }}</span>
              <span class="c5 mono dim">{{ f.hashBlake3 ? f.hashBlake3.slice(0, 10) + '…' : '—' }}</span>
              <span class="c6">
                <AppIcon v-if="f.encrypted" name="solar:lock-bold" :size="11" title="Encrypted" />
                <AppIcon v-if="encLayer(f) !== 'none'" name="solar:archive-bold" :size="11" title="Compressed" />
                <AppIcon v-if="f.isStarred" name="solar:star-bold" :size="11" title="Starred" />
              </span>
            </div>
            <div v-if="!renderFiles.length && !store.isLoading" class="fm-empty"><p>No files match.</p></div>
            <button v-if="renderLimit < sortedFiles.length" class="fm-more" @click="renderLimit += 300">Show more ({{ sortedFiles.length - renderLimit }} left)</button>
          </div>
        </div>

        <!-- COLUMNS (macOS-style) -->
        <div v-else class="fm-cols" @contextmenu.prevent="bgMenu($event)">
          <div class="fm-col">
            <div class="fm-col-h">This folder</div>
            <button
              v-for="f in sortedFiles"
              :key="f.id"
              class="fm-colrow"
              :class="{ sel: isSel(f.id) || colPreview?.id === f.id }"
              @click="peekColumn(f)"
              @dblclick="openFile(f)"
              @contextmenu.prevent.stop="fileMenu($event, f)"
            >
              <AppIcon :name="iconFor(f)" :size="14" />
              <span class="truncate">{{ f.name }}</span>
              <AppIcon v-if="f.fileType === 'folder'" name="solar:alt-arrow-right-bold" :size="11" />
            </button>
          </div>
          <div class="fm-col preview">
            <div class="fm-col-h">{{ colPreview ? colPreview.name : 'Preview' }}</div>
            <div v-if="colPreview" class="fm-colprev">
              <AppIcon :name="iconFor(colPreview)" :size="40" />
              <div class="mono dim">{{ humanBytes(colPreview.sizeBytes) }} · {{ shortType(colPreview) }}</div>
              <div class="mono dim">{{ cryptoLabel(colPreview) }}</div>
              <div class="fm-colbtns">
                <button class="fm-pill xs" @click="openFile(colPreview!)">Open</button>
                <button class="fm-pill xs ghost" @click="openFolderInTerm(colPreview!)">Terminal</button>
              </div>
            </div>
            <div v-else class="fm-sempty">Select an item to preview.</div>
          </div>
        </div>

        <!-- STATUS BAR -->
        <footer class="fm-status">
          <span class="mono truncate" :title="store.currentPath">{{ store.currentPath }}</span>
          <span class="fm-dot" />
          <span v-if="active" class="truncate">▸ {{ active.name }} <span class="mono dim">{{ humanBytes(active.sizeBytes) }}</span></span>
          <span v-else class="dim">▸ nothing selected</span>
          <span class="fm-spacer" />
          <span v-if="active?.encrypted" class="fm-sbadge lock">🔒 {{ (active.encryptionAlgorithm || 'enc').toUpperCase() }}</span>
          <span v-if="active && encLayer(active) !== 'none'" class="fm-sbadge zip">🗜 {{ encLayer(active).toUpperCase() }}</span>
          <span v-if="clipboard.ids.length" class="fm-sbadge clip">📋 {{ clipboard.ids.length }} {{ clipboard.mode }}</span>
          <span class="mono dim hide-sm">{{ renderFiles.length }}/{{ sortedFiles.length }}</span>
        </footer>

        <!-- INLINE TERMINAL -->
        <div v-if="termOpen" class="fm-term">
          <div class="fm-term-h">
            <AppIcon name="solar:file-terminal-bold" :size="13" />
            <span class="mono">cybsh — {{ termCwd }}</span>
            <span v-if="store.shellBusy" class="fm-spin sm" />
            <span class="fm-spacer" />
            <button class="fm-ibtn sm" title="ls here" @click="runTerm('ls -la ' + sh(termCwd))">ls</button>
            <button class="fm-ibtn sm" title="Open full terminal window" @click="wm.open('terminal')">⧉</button>
            <button class="fm-ibtn sm" title="Close terminal" @click="termOpen = false"><AppIcon name="solar:close-bold" :size="11" /></button>
          </div>
          <div ref="termScrollRef" class="fm-term-body">
            <div v-for="l in termLines" :key="l.id" class="fm-term-l" :class="l.kind">{{ l.text }}</div>
          </div>
          <form class="fm-term-in" @submit.prevent="submitTerm">
            <span class="mono">❯</span>
            <input ref="termInputRef" v-model="termInput" class="mono" :placeholder="`run in ${termCwd}… (try: ls, stat <file>, sync status)`" aria-label="Terminal input" @keydown.up.prevent="termHist(-1)" @keydown.down.prevent="termHist(1)" />
          </form>
        </div>
      </section>

      <!-- INSPECTOR -->
      <aside v-if="inspectorOpen" class="fm-insp">
        <div v-if="!active" class="fm-iempty">
          <AppIcon name="solar:file-search-bold" :size="28" />
          <p>Select a file</p>
          <span>Full metadata, crypto, distribution, versions & sharing live here.</span>
          <div v-if="df" class="fm-volcard">
            <div class="fm-side-h">VOLUME HEALTH</div>
            <div class="fm-volbar big"><i :style="{ width: volPct + '%' }" /></div>
            <div class="mono dim">{{ humanBytes(df.usedBytes) }} / {{ humanBytes(df.totalBytes) }} · {{ df.diskCount }} disks</div>
            <button class="fm-pill xs" @click="wm.open('disks')">Manage disks</button>
          </div>
        </div>
        <template v-else>
          <div class="fm-ihead">
            <span class="fm-ithumb"><AppIcon :name="iconFor(active)" :size="22" /></span>
            <div class="fm-ititle">
              <div class="truncate" :title="active.name"><b>{{ active.name }}</b></div>
              <div class="mono dim truncate">{{ active.path || store.currentPath }}</div>
            </div>
            <button class="fm-ibtn sm" title="Open in full terminal" @click="openFolderInTerm(active, true)"><AppIcon name="solar:file-terminal-bold" :size="13" /></button>
          </div>
          <div class="fm-tabs" role="tablist" aria-label="Inspector tabs">
            <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="inspTab === t.id" :class="{ active: inspTab === t.id }" @click="inspTab = t.id; onTab(t.id)">{{ t.label }}</button>
          </div>
          <div class="fm-ibody">
            <!-- INFO -->
            <div v-if="inspTab === 'info'" class="fm-isec">
              <div class="fm-kv"><span>Size</span><b class="mono">{{ humanBytes(active.sizeBytes) }}</b></div>
              <div class="fm-kv"><span>Type</span><b>{{ shortType(active) }}</b></div>
              <div class="fm-kv"><span>MIME</span><b class="mono">{{ active.mimeType || '—' }}</b></div>
              <div class="fm-kv"><span>Modified</span><b class="mono">{{ fmtDate(active.modifiedAt) }}</b></div>
              <div class="fm-kv"><span>Created</span><b class="mono">{{ fmtDate(active.createdAt) }}</b></div>
              <div class="fm-kv hash"><span>BLAKE3</span><b class="mono" :title="active.hashBlake3">{{ active.hashBlake3 || '—' }}</b></div>
              <div class="fm-kv"><span>Starred</span><button class="fm-pill xs" @click="store.toggleStar(active!.id)">{{ active.isStarred ? '★ yes' : '☆ star it' }}</button></div>
              <div v-if="active.tags?.length" class="fm-kv"><span>Tags</span><b>{{ active.tags.join(', ') }}</b></div>
              <div class="fm-tagedit">
                <span class="fm-tagedit__label">TAGS — TEACH SEARCH</span>
                <div class="fm-tagedit__chips">
                  <span v-for="t in (active.tags || [])" :key="t" class="fm-tagedit__chip">
                    {{ t }}
                    <button type="button" class="fm-tagedit__x" :aria-label="`Remove tag ${t}`" title="Remove" @click="removeTag(t)">×</button>
                  </span>
                  <span v-if="!(active.tags || []).length" class="fm-sempty">No tags — add one to improve search.</span>
                </div>
                <form class="fm-tagedit__form" @submit.prevent="addTag()">
                  <input
                    v-model="tagDraft"
                    class="fm-tagedit__input"
                    type="text"
                    placeholder="Add tag… (Enter)"
                    aria-label="Add tag"
                    maxlength="48"
                  />
                  <button type="submit" class="fm-pill xs" :disabled="!tagDraft.trim() || tagSaving">Add</button>
                </form>
              </div>
              <div v-if="active.gpsLat != null" class="fm-kv"><span>GPS</span><b class="mono">{{ active.gpsLat.toFixed(4) }}, {{ active.gpsLon?.toFixed(4) }}</b></div>
              <div class="fm-btnrow">
                <button class="fm-pill xs" @click="openFile(active)">Open</button>
                <button class="fm-pill xs ghost" @click="wm.open('preview')">Preview</button>
                <button class="fm-pill xs ghost" @click="copyPath(active)">Copy path</button>
                <button class="fm-pill xs ghost" @click="beginRename(active)">Rename</button>
              </div>
              <div class="fm-btnrow">
                <button class="fm-pill xs ghost" @click="openFolderInTerm(active)">Terminal here</button>
                <button class="fm-pill xs ghost" @click="store.fetchFileVersions(active!.id); inspTab = 'vers'">Versions</button>
                <button class="fm-pill xs ghost danger" @click="askDelete(active)">Delete</button>
              </div>
            </div>
            <!-- CRYPTO -->
            <div v-else-if="inspTab === 'crypto'" class="fm-isec">
              <div class="fm-side-h">ENCRYPTION — ACTUAL STATE</div>
              <div class="fm-cryptocard" :class="{ on: active.encrypted }">
                <div class="fm-kv"><span>Status</span><b>{{ active.encrypted ? '🔒 ENCRYPTED' : '🔓 plain' }}</b></div>
                <div class="fm-kv"><span>Algorithm</span><b>{{ activeAlgoName }}</b></div>
                <div v-if="active.encrypted" class="fm-kv"><span>NIST level</span><b>L{{ activeNist }} {{ '●'.repeat(activeNist) }}{{ '○'.repeat(Math.max(0, 5 - activeNist)) }}</b></div>
                <div v-if="keyIdOf(active)" class="fm-kv"><span>Key ID</span><b class="mono">{{ keyIdOf(active) }}</b></div>
              </div>
              <div class="fm-algos">
                <button v-for="(info, algo) in ENCRYPTION_INFO" :key="algo" class="fm-algo" :class="{ cur: (active.encryptionAlgorithm || '').toLowerCase() === String(algo).toLowerCase() }" :title="info.description" @click="encryptWith(String(algo))">
                  <b>{{ info.name }}</b><span>L{{ info.nistLevel }}</span>
                </button>
              </div>
              <div class="fm-btnrow">
                <button v-if="!active.encrypted" class="fm-pill xs" @click="encryptWith('hybrid')">Encrypt · hybrid</button>
                <button v-else class="fm-pill xs" @click="store.decryptFile(active!.id)">Decrypt</button>
                <button class="fm-pill xs ghost" @click="wm.open('encryption')">Key manager</button>
              </div>
              <div class="fm-side-h">COMPRESSION — ACTUAL STATE</div>
              <div class="fm-cryptocard" :class="{ on: encLayer(active) !== 'none' }">
                <div class="fm-kv"><span>Layers</span><b>{{ (active.compressionLayers || []).join(' → ') || 'none' }}</b></div>
                <div v-if="store.compressionStats" class="fm-kv"><span>Last run</span><b class="mono">{{ humanBytes(store.compressionStats.originalSize) }} → {{ humanBytes(store.compressionStats.compressedSize) }} ({{ (store.compressionStats.ratio * 100).toFixed(1) }}%)</b></div>
                <div v-if="active.hashBlake3" class="fm-kv"><span>Integrity</span><b class="mono">blake3 ✓ pinned</b></div>
              </div>
              <div class="fm-algos">
                <button v-for="(info, t) in COMPRESSION_INFO" :key="t" class="fm-algo" :class="{ cur: encLayer(active) === t }" :title="info.description" @click="compressWith(String(t))">
                  <b>{{ info.name }}</b><span>{{ info.speed }}</span>
                </button>
              </div>
              <div class="fm-btnrow">
                <button class="fm-pill xs" @click="compressWith('zstd')">Compress · zstd</button>
                <button v-if="encLayer(active) !== 'none'" class="fm-pill xs ghost" @click="store.decompressFile(active!.id)">Decompress</button>
                <button class="fm-pill xs ghost" @click="wm.open('compression')">Engine</button>
              </div>
            </div>
            <!-- DISTRIBUTION -->
            <div v-else-if="inspTab === 'distro'" class="fm-isec">
              <div class="fm-side-h">WHERE IS IT? — PROVIDER DISTRIBUTION</div>
              <div class="fm-kv"><span>Vault file</span><b class="mono">.cybermanju</b></div>
              <div class="fm-kv"><span>Volume</span><b class="mono">{{ df ? `${humanBytes(df.usedBytes)} / ${humanBytes(df.totalBytes)}` : '—' }}</b></div>
              <div class="fm-distro">
                <div v-for="c in store.syncConfigs" :key="c.id" class="fm-drow" :title="c.basePath || c.repoName || c.backendType">
                  <i :style="{ background: backendColor(c.backendType) }" />
                  <span class="t truncate"><b>{{ backendLabel(c.backendType) }}</b> <span class="dim">{{ c.name || '' }}</span></span>
                  <span class="mono dim">{{ c.placement || 'whole' }}{{ c.parity ? '·p' + c.parity : '' }}</span>
                  <span class="fm-dstat" :class="{ on: c.enabled }">{{ c.enabled ? 'on' : 'off' }}</span>
                  <button class="fm-pill xs" title="Sync this file now" @click="syncFileTo(c.id)">⇪</button>
                  <button class="fm-pill xs ghost" title="Probe remote copy" @click="probeRemote(c.id)">locate</button>
                </div>
                <div v-if="!store.syncConfigs.length" class="fm-sempty">No providers configured — <button class="fm-link" @click="wm.open('sync')">add one in Sync</button>.</div>
              </div>
              <div v-if="remoteHits.length" class="fm-side-h">REMOTE COPIES FOUND · {{ remoteHits.length }}</div>
              <div v-for="r in remoteHits" :key="r.url + r.path" class="fm-kv small">
                <span class="truncate" :title="r.path">{{ r.name }}</span>
                <b class="mono">{{ humanBytes(r.sizeBytes) }}</b>
              </div>
              <div v-if="probing" class="dim mono">probing remotes…</div>
              <div class="fm-side-h">DISKS HOLDING THE VOLUME</div>
              <div v-for="d in store.disks" :key="d.id" class="fm-kv small">
                <span class="truncate" :title="d.containerPath || d.name">{{ d.name }} · {{ d.provider }}</span>
                <b class="mono">{{ Math.round(diskPct(d.usedBytes, d.capacityBytes)) }}%</b>
              </div>
              <div class="fm-btnrow">
                <button class="fm-pill xs ghost" @click="wm.open('sync')">Sync panel</button>
                <button class="fm-pill xs ghost" @click="wm.open('disks')">Disks</button>
                <button class="fm-pill xs ghost" @click="restoreToVault">Restore ↓</button>
              </div>
            </div>
            <!-- VERSIONS -->
            <div v-else-if="inspTab === 'vers'" class="fm-isec">
              <div class="fm-side-h">VERSION HISTORY</div>
              <div v-for="v in store.fileVersions" :key="v.id" class="fm-kv small">
                <span>v{{ v.versionNumber }} · {{ fmtDate(v.createdAt) }}</span>
                <button class="fm-pill xs ghost" @click="store.revertToVersion(active!.id, v.id)">revert</button>
              </div>
              <div v-if="!store.fileVersions.length" class="fm-sempty">No snapshots yet.</div>
              <div class="fm-btnrow">
                <button class="fm-pill xs" @click="store.createVersion(active!.id)">Snapshot now</button>
                <button class="fm-pill xs ghost" @click="store.snapshotAllVersions()">Snapshot all</button>
              </div>
              <div class="fm-side-h">PERMISSIONS</div>
              <div class="fm-btnrow"><button class="fm-pill xs ghost" @click="wm.open('permissions')">Open ACL editor</button></div>
            </div>
            <!-- SHARE -->
            <div v-else class="fm-isec">
              <div class="fm-side-h">SHARE LINK</div>
              <div class="fm-btnrow">
                <button class="fm-pill xs" @click="makeShare(24)">24h link</button>
                <button class="fm-pill xs ghost" @click="makeShare(168)">7d link</button>
                <button class="fm-pill xs ghost" @click="store.fetchShareLinks()">Refresh</button>
              </div>
              <div v-if="lastShare" class="fm-sharebox mono">{{ lastShare }}</div>
              <div v-for="s in sharesForActive" :key="s.id" class="fm-kv small">
                <span class="mono truncate" :title="s.url">{{ s.url }}</span>
                <button class="fm-pill xs ghost" @click="copyText(s.url)">copy</button>
              </div>
              <div v-if="!sharesForActive.length" class="fm-sempty">No active links for this file.</div>
              <div class="fm-side-h">ADD TO COLLECTION</div>
              <div class="fm-btnrow">
                <button v-for="c in store.collections.slice(0, 4)" :key="c.id" class="fm-pill xs ghost" @click="store.addToCollection(c.id, active!.id)">{{ c.name }}</button>
              </div>
            </div>
          </div>
        </template>
      </aside>
    </div>

    <!-- dialogs -->
    <Teleport to="body">
      <div v-if="dlgFolder" class="fm-ov" @click.self="dlgFolder = false">
        <div class="fm-modal">
          <h3>New folder</h3>
          <input ref="folderRef" v-model="dlgFolderName" placeholder="folder name" @keyup.enter="doMkdir" />
          <div class="fm-mrow"><button class="fm-pill ghost" @click="dlgFolder = false">Cancel</button><button class="fm-pill" @click="doMkdir">Create</button></div>
        </div>
      </div>
      <div v-if="dlgRename" class="fm-ov" @click.self="dlgRename = null">
        <div class="fm-modal">
          <h3>Rename</h3>
          <input ref="renameRef" v-model="dlgRenameName" @keyup.enter="doRename" />
          <div class="fm-mrow"><button class="fm-pill ghost" @click="dlgRename = null">Cancel</button><button class="fm-pill" @click="doRename">Rename</button></div>
        </div>
      </div>
      <div v-if="dlgDelete" class="fm-ov" @click.self="dlgDelete = null">
        <div class="fm-modal danger">
          <h3>Delete {{ dlgDeleteMany ? dlgDeleteMany + ' items' : '“' + (dlgDelete.name || '') + '”' }}?</h3>
          <p class="dim">Moves to Trash — restorable.</p>
          <div class="fm-mrow"><button class="fm-pill ghost" @click="dlgDelete = null; dlgDeleteMany = 0">Cancel</button><button class="fm-pill danger" @click="doDelete">Delete</button></div>
        </div>
      </div>
      <div v-if="dlgSync" class="fm-ov" @click.self="dlgSync = null">
        <div class="fm-modal">
          <h3>Sync {{ (dlgSyncIds?.length || 1) }} file(s) to…</h3>
          <button v-for="c in store.syncConfigs.filter(c => c.enabled)" :key="c.id" class="fm-srow wide" @click="doSyncTo(c.id)">
            <i class="fm-pdot" :style="{ background: backendColor(c.backendType) }" />
            <span class="t">{{ backendLabel(c.backendType) }} {{ c.name ? '· ' + c.name : '' }}</span>
          </button>
          <div v-if="!store.syncConfigs.filter(c => c.enabled).length" class="fm-sempty">No enabled providers — open Sync first.</div>
          <div class="fm-mrow"><button class="fm-pill ghost" @click="dlgSync = null">Cancel</button><button class="fm-pill ghost" @click="wm.open('sync')">Sync panel</button></div>
        </div>
      </div>
      <input ref="filePickRef" type="file" multiple hidden @change="onFilesPicked" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useDropZone } from '@vueuse/core'
import { useAppStore } from '@/stores/app'
import { useWindowManager } from '@/composables/useWindowManager'
import { useContextMenu } from '@/composables/useContextMenu'
import { invoke } from '@/composables/useTauri'
import { humanBytes, diskPct } from '@/utils/format'
import { trackShellCwd } from '@/utils/shellCwd'
import { ENCRYPTION_INFO, COMPRESSION_INFO, SYNC_BACKEND_INFO } from '@/types'
import type { FileNode, SyncBackendType } from '@/types'

const store = useAppStore()
const wm = useWindowManager()
const ctx = useContextMenu()

type ViewId = 'grid' | 'list' | 'columns' | 'details' | 'masonry'
const viewModes: { id: ViewId; icon: string; hint: string }[] = [
  { id: 'grid', icon: 'solar:grid-3x3-bold', hint: 'Grid (Ctrl+G)' },
  { id: 'list', icon: 'solar:list-bold', hint: 'List (Ctrl+L)' },
  { id: 'details', icon: 'solar:checklist-bold', hint: 'Details — crypto + hash columns' },
  { id: 'columns', icon: 'solar:columns-3-bold', hint: 'Columns (macOS style)' },
  { id: 'masonry', icon: 'solar:widget-2-bold', hint: 'Masonry' },
]
const view = ref<ViewId>((['grid', 'list', 'masonry'].includes(store.viewMode) ? store.viewMode : 'grid') as ViewId)
function setView(v: ViewId) {
  view.value = v
  if (v === 'grid' || v === 'list' || v === 'masonry') store.viewMode = v
  else store.viewMode = v === 'details' ? 'list' : 'grid'
}

const sortField = ref<'name' | 'size' | 'date' | 'type'>('name')
const sortDir = ref<'asc' | 'desc'>('asc')
const filterQuery = ref('')
const showHidden = ref(false)
const onlyMedia = ref(false)
const density = ref<'cozy' | 'compact'>('cozy')
const renderLimit = ref(240)
const sideOpen = ref(true)
const inspectorOpen = ref(true)
const inspTab = ref<'info' | 'crypto' | 'distro' | 'vers' | 'share'>('info')
const tabs = [
  { id: 'info', label: 'Info' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'distro', label: 'Distro' },
  { id: 'vers', label: 'Vers' },
  { id: 'share', label: 'Share' },
] as const

const rootRef = ref<HTMLElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const filePickRef = ref<HTMLInputElement | null>(null)
const folderRef = ref<HTMLInputElement | null>(null)
const renameRef = ref<HTMLInputElement | null>(null)

// ── nav history ──
const hist = ref<string[]>([store.currentPath || '/'])
const histIdx = ref(0)
const canBack = computed(() => histIdx.value > 0)
const canFwd = computed(() => histIdx.value < hist.value.length - 1)
function pushHist(p: string) {
  if (hist.value[histIdx.value] === p) return
  hist.value = hist.value.slice(0, histIdx.value + 1)
  hist.value.push(p)
  histIdx.value = hist.value.length - 1
}
async function navTo(path: string) {
  store.currentPath = path
  pushHist(path)
  renderLimit.value = 240
  colPreview.value = null
  await store.fetchFiles(path)
}
function goBack() { if (canBack.value) { histIdx.value--; store.currentPath = hist.value[histIdx.value]; void store.fetchFiles(store.currentPath) } }
function goFwd() { if (canFwd.value) { histIdx.value++; store.currentPath = hist.value[histIdx.value]; void store.fetchFiles(store.currentPath) } }
function goUp() {
  const p = store.currentPath.replace(/\/+$/, '') || '/'
  if (p === '/' || p === '') return navTo('/')
  navTo(p.split('/').slice(0, -1).join('/') || '/')
}
function goHome() { store.selectFile(null); void navTo('/') }
function refresh() { void Promise.all([store.fetchFiles(store.currentPath), store.fetchOsDf(), store.fetchSyncConfigs(), store.fetchDisks()]) }
function jumpCrumb(p: string) { store.selectFile(null); void navTo(p) }
const crumbs = computed(() => {
  const p = store.currentPath || '/'
  const parts = p.split('/').filter(Boolean)
  const out = [{ label: 'vault', path: '/' }]
  let acc = ''
  for (const part of parts) { acc += '/' + part; out.push({ label: part, path: acc }) }
  return out
})

// ── file scope: children of selected folder, else current listing ──
const scopeFolder = computed(() => {
  const s = store.selectedFile
  return s && s.fileType === 'folder' ? s : null
})
const baseFiles = computed(() => {
  if (scopeFolder.value) {
    const kids = store.files.filter(f => f.parentId === scopeFolder.value!.id)
    if (kids.length) return kids
  }
  return store.files
})
const folders = computed(() => baseFiles.value.filter(f => f.fileType === 'folder').sort((a, b) => a.name.localeCompare(b.name)))
const sortedFiles = computed(() => {
  let fs = [...baseFiles.value]
  if (!showHidden.value) fs = fs.filter(f => !f.isHidden && !f.name.startsWith('.'))
  if (onlyMedia.value) fs = fs.filter(f => /^(image|video|audio)\//.test(f.mimeType || ''))
  const q = filterQuery.value.trim().toLowerCase()
  if (q) fs = fs.filter(f => f.name.toLowerCase().includes(q) || (f.mimeType || '').toLowerCase().includes(q))
  const m = sortDir.value === 'asc' ? 1 : -1
  fs.sort((a, b) => {
    if (sortField.value === 'name') return a.name.localeCompare(b.name) * m
    if (sortField.value === 'size') return (a.sizeBytes - b.sizeBytes) * m
    if (sortField.value === 'date') return (new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()) * m
    return ((a.mimeType || a.fileType) > (b.mimeType || b.fileType) ? 1 : -1) * m
  })
  // folders first on name sort
  if (sortField.value === 'name') fs.sort((a, b) => ((b.fileType === 'folder') as unknown as number) - ((a.fileType === 'folder') as unknown as number))
  return fs
})
const renderFiles = computed(() => sortedFiles.value.slice(0, renderLimit.value))
function onScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 600 && renderLimit.value < sortedFiles.value.length) renderLimit.value += 300
}
watch([filterQuery, sortField, sortDir, showHidden, onlyMedia], () => { renderLimit.value = 240 })

const folderBytes = computed(() => sortedFiles.value.reduce((s, f) => s + (f.sizeBytes || 0), 0))
const selCount = computed(() => store.selectedFileIds.length)
const selBytes = computed(() => store.selectedFileIds.reduce((s, id) => s + (store.files.find(f => f.id === id)?.sizeBytes || 0), 0))
const allBulk = computed(() => sortedFiles.value.length > 0 && sortedFiles.value.every(f => store.selectedFileIds.includes(f.id)))
const active = computed(() => store.selectedFile)
const isSel = (id: string) => store.selectedFileId === id
const isBulk = (id: string) => store.selectedFileIds.includes(id)

const df = computed(() => store.osDf)
const volPct = computed(() => { const d = df.value; return !d || !d.totalBytes ? 0 : Math.min(100, (d.usedBytes / d.totalBytes) * 100) })
const allTags = computed(() => [...new Set(store.files.flatMap(f => f.tags || []))].sort())

function backendLabel(b: SyncBackendType | string) { return (SYNC_BACKEND_INFO as Record<string, { name: string }>)[b]?.name ?? b }
function backendColor(b: SyncBackendType | string) { return (SYNC_BACKEND_INFO as Record<string, { color: string }>)[b]?.color ?? '#8b93a7' }
const providerChips = computed(() => store.syncConfigs.map(c => ({
  id: c.id,
  label: backendLabel(c.backendType),
  short: backendLabel(c.backendType).split(' ')[0],
  color: backendColor(c.backendType),
  enabled: c.enabled,
  detail: c.repoName || c.basePath || '',
})))
function openSync(_id: string) { wm.open('sync') }

// ── icons / labels ──
function iconFor(f: FileNode): string {
  if (f.fileType === 'folder') return 'solar:folder-bold'
  if (f.encrypted) return 'solar:lock-bold'
  if (encLayer(f) !== 'none') return 'solar:archive-bold'
  const m = f.mimeType || ''
  if (m.startsWith('image/')) return 'solar:gallery-bold'
  if (m.startsWith('video/')) return 'solar:videocamera-bold'
  if (m.startsWith('audio/')) return 'solar:music-note-bold'
  if (/pdf/.test(m)) return 'solar:file-favourite-bold'
  if (/zip|tar|gz|rar|7z|archive/.test(m)) return 'solar:archive-bold'
  if (/text|json|xml|javascript|code/.test(m)) return 'solar:file-text-bold'
  return 'solar:file-bold'
}
function encLayer(f: FileNode): string { return (f.compressionLayers && f.compressionLayers[0]) || 'none' }
function shortType(f: FileNode): string {
  if (f.fileType === 'folder') return 'Folder'
  const m = f.mimeType || ''
  if (!m) return 'File'
  if (m.startsWith('image/')) return 'Image'
  if (m.startsWith('video/')) return 'Video'
  if (m.startsWith('audio/')) return 'Audio'
  if (m.includes('pdf')) return 'PDF'
  if (/zip|tar|gz|rar|7z/.test(m)) return 'Archive'
  if (/text|json|xml/.test(m)) return 'Text'
  return m.split('/')[1]?.toUpperCase() || 'File'
}
function cryptoLabel(f: FileNode): string {
  const e = f.encrypted ? (f.encryptionAlgorithm || 'ENC').toUpperCase() : 'plain'
  const c = encLayer(f)
  return c === 'none' ? e : `${e} · ${c.toUpperCase()}`
}
function fmtDate(s: string): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function arrow(f: string) { return sortField.value === f ? (sortDir.value === 'asc' ? '↑' : '↓') : '' }
function setSort(f: 'name' | 'size' | 'date' | 'type') {
  if (sortField.value === f) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortField.value = f; sortDir.value = 'asc' }
}
function hideImg(e: Event) { (e.target as HTMLImageElement).style.display = 'none' }

// ── selection / open ──
function clickFile(f: FileNode, e: MouseEvent) {
  if (e.metaKey || e.ctrlKey) { toggleBulk(f.id); return }
  if (e.shiftKey && store.selectedFileId) {
    const ids = sortedFiles.value.map(x => x.id)
    const a = ids.indexOf(store.selectedFileId)
    const b = ids.indexOf(f.id)
    if (a >= 0 && b >= 0) {
      store.selectedFileIds = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
      store.isMultiSelect = true
      return
    }
  }
  store.selectFile(f.id)
}
function toggleBulk(id: string) {
  const i = store.selectedFileIds.indexOf(id)
  if (i >= 0) store.selectedFileIds.splice(i, 1)
  else store.selectedFileIds.push(id)
  store.isMultiSelect = store.selectedFileIds.length > 0
}
function selectAll() { store.selectedFileIds = sortedFiles.value.map(f => f.id); store.isMultiSelect = true }
function clearSel() { store.selectedFileIds = []; store.isMultiSelect = false }
function openFolder(f: FileNode) {
  store.selectFile(f.id)
  const p = f.path || (store.currentPath.replace(/\/+$/, '') + '/' + f.name)
  void navTo(p)
}
function openFile(f: FileNode) {
  if (f.fileType === 'folder') return openFolder(f)
  store.selectFile(f.id)
  wm.open('preview')
}
function revealFile(f: FileNode) {
  store.selectFile(f.id)
  if (f.path) void navTo(f.path.split('/').slice(0, -1).join('/') || '/')
}
const colPreview = ref<FileNode | null>(null)
function peekColumn(f: FileNode) { store.selectFile(f.id); colPreview.value = f }
function globalSearch() {
  const q = filterQuery.value.trim()
  if (!q) return
  store.searchQuery = q
  wm.open('search')
  void store.searchFiles(q)
}
function onDrag(e: DragEvent, f: FileNode) { e.dataTransfer?.setData('text/plain', f.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy' }

// ── context menus (reuse registered contexts) ──
function fileMenu(e: MouseEvent, f: FileNode) {
  ctx.replaceEntries('file_grid_item', [
    { id: 'open', label: 'OPEN', icon: 'solar:folder-open-bold', action: () => openFile(f) },
    { id: 'terminal', label: 'OPEN IN TERMINAL', icon: 'solar:file-terminal-bold', action: () => openFolderInTerm(f) },
    { id: 'preview', label: 'QUICK LOOK', icon: 'solar:eye-bold', action: () => { store.selectFile(f.id); wm.open('preview') } },
    { id: 'div0', label: '', divider: true },
    { id: 'compress', label: 'COMPRESS · ZSTD', icon: 'solar:archive-bold', action: () => store.compressFile(f.id, 'zstd') },
    { id: 'encrypt', label: 'ENCRYPT · HYBRID', icon: 'solar:lock-bold', action: () => store.encryptFile(f.id, 'hybrid') },
    { id: 'decrypt', label: 'DECRYPT', icon: 'solar:lock-unlocked-bold', action: () => store.decryptFile(f.id) },
    { id: 'decompress', label: 'DECOMPRESS', icon: 'solar:archive-up-bold', action: () => store.decompressFile(f.id) },
    { id: 'div1', label: '', divider: true },
    { id: 'sync', label: 'SYNC TO PROVIDER…', icon: 'solar:cloud-bold', action: () => { dlgSyncIds.value = [f.id]; dlgSync.value = true } },
    { id: 'share', label: 'SHARE LINK', icon: 'solar:share-bold', action: () => { store.selectFile(f.id); inspTab.value = 'share'; inspectorOpen.value = true; void makeShare(24) } },
    { id: 'star', label: f.isStarred ? 'UNSTAR' : 'STAR', icon: 'solar:star-bold', action: () => store.toggleStar(f.id) },
    { id: 'rename', label: 'RENAME', icon: 'solar:pen-bold', action: () => beginRename(f) },
    { id: 'duplicate', label: 'DUPLICATE', icon: 'solar:copy-add-bold', action: () => store.duplicateFileContext(f.id) },
    { id: 'div2', label: '', divider: true },
    { id: 'versions', label: 'VERSIONS', icon: 'solar:history-bold', action: () => { store.selectFile(f.id); inspTab.value = 'vers'; inspectorOpen.value = true; void store.fetchFileVersions(f.id) } },
    { id: 'perms', label: 'PERMISSIONS', icon: 'solar:key-bold', action: () => { store.selectFile(f.id); wm.open('permissions') } },
    { id: 'delete', label: 'DELETE', icon: 'solar:trash-bin-trash-bold', action: () => askDelete(f) },
  ])
  ctx.open(e, 'file_grid_item')
}
function bgMenu(e: MouseEvent) { ctx.open(e, 'file_grid_bg') }

// ── clipboard copy/cut/paste ──
const clipboard = ref<{ ids: string[]; mode: 'copy' | 'cut' }>({ ids: [], mode: 'copy' })
function copySel() { clipboard.value = { ids: [...store.selectedFileIds], mode: 'copy' }; store.notifySuccess(`Copied ${clipboard.value.ids.length} item(s)`) }
function cutSel() { clipboard.value = { ids: [...store.selectedFileIds], mode: 'cut' }; store.notifySuccess(`Cut ${clipboard.value.ids.length} item(s) — paste to move`) }
async function pasteHere() {
  const { ids, mode } = clipboard.value
  for (const id of ids) {
    try { await store.duplicateFileContext(id); if (mode === 'cut') await store.deleteFile(id) } catch { /* per-file toast already shown */ }
  }
  if (mode === 'cut') clipboard.value = { ids: [], mode: 'copy' }
  await store.fetchFiles(store.currentPath)
}

// ── bulk ──
async function bulkEncrypt() { for (const id of [...store.selectedFileIds]) { try { await store.encryptFile(id, 'hybrid') } catch {} } clearSel() }
async function bulkCompress() { for (const id of [...store.selectedFileIds]) { try { await store.compressFile(id, 'zstd') } catch {} } clearSel() }
function bulkSync() { dlgSyncIds.value = [...store.selectedFileIds]; dlgSync.value = true }
function bulkStar() { for (const id of store.selectedFileIds) store.toggleStar(id); clearSel() }
function askDeleteSel() { dlgDelete.value = null; dlgDeleteMany.value = store.selectedFileIds.length }

// ── dialogs ──
const dlgFolder = ref(false)
const dlgFolderName = ref('')
const dlgRename = ref<FileNode | null>(null)
const dlgRenameName = ref('')
const dlgDelete = ref<FileNode | null>(null)
const dlgDeleteMany = ref(0)
const dlgSync = ref<boolean | null>(null)
const dlgSyncIds = ref<string[]>([])
watch(dlgFolder, v => { if (v) nextTick(() => folderRef.value?.focus()) })
async function doMkdir() {
  if (!dlgFolderName.value.trim()) return
  await store.createFolder(dlgFolderName.value.trim(), scopeFolder.value?.id || '')
  dlgFolderName.value = ''
  dlgFolder.value = false
}
function beginRename(f: FileNode) { dlgRename.value = f; dlgRenameName.value = f.name; nextTick(() => renameRef.value?.focus()) }
async function doRename() {
  if (dlgRename.value && dlgRenameName.value.trim()) await store.renameFile(dlgRename.value.id, dlgRenameName.value.trim())
  dlgRename.value = null
}
function askDelete(f: FileNode) { dlgDeleteMany.value = 0; dlgDelete.value = f }
// ── user tags (teach search/parse + scene matching on any file) ──
const tagDraft = ref('')
const tagSaving = ref(false)
async function addTag() {
  const file = active.value
  const tag = tagDraft.value.trim()
  if (!file || !tag || tagSaving.value) return
  if ((file.tags || []).some(t => t.toLowerCase() === tag.toLowerCase())) {
    tagDraft.value = ''
    return
  }
  tagSaving.value = true
  try {
    await store.setFileTags(file.id, [...(file.tags || []), tag])
    tagDraft.value = ''
  } finally {
    tagSaving.value = false
  }
}
async function removeTag(tag: string) {
  const file = active.value
  if (!file || tagSaving.value) return
  tagSaving.value = true
  try {
    await store.setFileTags(file.id, (file.tags || []).filter(t => t !== tag))
  } finally {
    tagSaving.value = false
  }
}
async function doDelete() {
  if (dlgDeleteMany.value > 0) await store.batchDeleteFiles([...store.selectedFileIds])
  else if (dlgDelete.value) await store.deleteFile(dlgDelete.value.id)
  dlgDelete.value = null
  dlgDeleteMany.value = 0
}
async function doSyncTo(configId: string) {
  const ids = dlgSyncIds.value.length ? dlgSyncIds.value : [...store.selectedFileIds]
  dlgSync.value = null
  dlgSyncIds.value = []
  if (!ids.length) { store.notifyError('Nothing to sync', 'select a file first'); return }
  await store.startSync(configId, ids)
  clearSel()
}

// ── upload / new file ──
function onUploadClick() { filePickRef.value?.click() }
// OS file drops anywhere on the manager (VueUse useDropZone): same pipeline
// as the picker, so dragging from the host OS just works.
async function uploadDroppedFiles(files: File[] | null) {
  if (!files?.length) return
  for (const f of files) {
    try {
      const buf = new Uint8Array(await f.arrayBuffer())
      await invoke('upload_file', { fileName: f.name, fileData: Array.from(buf), parentPath: store.currentPath })
    } catch (err) { store.notifyError(`Upload failed: ${f.name}`, err) }
  }
  await store.fetchFiles(store.currentPath)
  store.notifySuccess(`Upload complete (${files.length})`)
}
const { isOverDropZone } = useDropZone(rootRef, { onDrop: (files) => void uploadDroppedFiles(files ?? []) })
async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const list = input.files
  if (!list?.length) return
  for (const f of Array.from(list)) {
    try {
      const buf = new Uint8Array(await f.arrayBuffer())
      await invoke('upload_file', { fileName: f.name, fileData: Array.from(buf), parentPath: store.currentPath })
    } catch (err) { store.notifyError(`Upload failed: ${f.name}`, err) }
  }
  input.value = ''
  await store.fetchFiles(store.currentPath)
  store.notifySuccess('Upload complete')
}
async function copyPath(f: FileNode) { try { await navigator.clipboard.writeText(f.path || f.name) } catch {} }
async function copyText(t: string) { try { await navigator.clipboard.writeText(t) } catch {} }

// ── crypto quick actions ──
const activeAlgoName = computed(() => {
  const a = (active.value?.encryptionAlgorithm || '').toLowerCase()
  const hit = Object.entries(ENCRYPTION_INFO).find(([k]) => k.toLowerCase() === a)
  return hit ? hit[1].name : (active.value?.encrypted ? (active.value?.encryptionAlgorithm || 'ENCRYPTED').toUpperCase() : '—')
})
const activeNist = computed(() => {
  const a = (active.value?.encryptionAlgorithm || '').toLowerCase()
  const hit = Object.entries(ENCRYPTION_INFO).find(([k]) => k.toLowerCase() === a)
  return hit ? hit[1].nistLevel : 0
})
function keyIdOf(f: FileNode): string {
  const k = (f.contextData as Record<string, unknown> | undefined)?.keyId
  return k ? String(k).slice(0, 18) + '…' : ''
}
async function encryptWith(algo: string) { if (active.value) await store.encryptFile(active.value.id, algo) }
async function compressWith(layer: string) { if (active.value) await store.compressFile(active.value.id, layer) }

// ── distribution ──
const probing = ref(false)
const remoteHits = ref<{ name: string; path: string; sizeBytes: number; url: string }[]>([])
async function probeRemote(configId: string) {
  const cfg = store.syncConfigs.find(c => c.id === configId)
  if (!cfg || !active.value) return
  probing.value = true
  try {
    const rem = await store.listRemoteFiles(cfg, '')
    remoteHits.value = rem.filter(r => r.name.toLowerCase().includes(active.value!.name.toLowerCase().split('.')[0])).slice(0, 12)
    if (!remoteHits.value.length) store.notifySuccess('Probe done — no name match on this provider')
  } finally { probing.value = false }
}
async function syncFileTo(configId: string) { if (active.value) await store.startSync(configId, [active.value.id]) }
async function restoreToVault() {
  if (!active.value) return
  const cfg = store.syncConfigs.find(c => c.enabled)
  if (!cfg) { wm.open('sync'); return }
  await store.restoreSyncFile(cfg.id, active.value.id)
}
function onTab(t: string) {
  if (!active.value) return
  if (t === 'vers') void store.fetchFileVersions(active.value.id)
  if (t === 'share') void store.fetchShareLinks()
  if (t === 'crypto') void store.fetchEncryptionStatus()
  if (t === 'distro') void Promise.all([store.fetchSyncConfigs(), store.fetchOsDf(), store.fetchDisks()])
}
watch(() => store.selectedFileId, id => {
  if (!id) return
  if (inspTab.value === 'vers') void store.fetchFileVersions(id)
  if (inspTab.value === 'crypto') void store.fetchEncryptionStatus()
})

// ── share ──
const lastShare = ref('')
const sharesForActive = computed(() => active.value ? store.shareLinks.filter(s => s.fileId === active.value!.id) : [])
async function makeShare(hours: number) {
  if (!active.value) return
  const s = await store.generateShareLink(active.value.id, hours)
  if (s) { lastShare.value = s.url; await copyText(s.url) }
}

// ── inline terminal (cybsh, scoped to current folder) ──
const termOpen = ref(false)
const termCwd = ref(store.currentPath || '/')
const termInput = ref('')
const termLines = ref<{ id: number; kind: string; text: string }[]>([])
const termHistArr = ref<string[]>([])
const termHistIdx = ref(-1)
const termScrollRef = ref<HTMLElement | null>(null)
const termInputRef = ref<HTMLInputElement | null>(null)
let termId = 0
function termPush(kind: string, text: string) {
  for (const line of text.split('\n')) {
    if (line === '' && kind !== 'in') continue
    termLines.value.push({ id: ++termId, kind, text: line || ' ' })
  }
  if (termLines.value.length > 500) termLines.value.splice(0, termLines.value.length - 500)
  nextTick(() => { const el = termScrollRef.value; if (el) el.scrollTop = el.scrollHeight })
}
function sh(p: string) { return `"${p.replace(/"/g, '\\"')}"` }
async function runTerm(line: string) {
  const full = line.trim()
  if (!full) return
  termPush('in', '❯ ' + full)
  // Same mirror as CodeStudio: the server shell is stateful, so track `cd`
  // (plain, relative, quoted, chained) instead of letting the label go stale.
  termCwd.value = trackShellCwd(termCwd.value, full)
  const res = await store.execShellLine(full)
  termPush(res.ok ? 'out' : 'err', res.output || (res.ok ? 'ok' : 'failed'))
}
function submitTerm() {
  const v = termInput.value
  termInput.value = ''
  if (v.trim()) { termHistArr.value.unshift(v); termHistIdx.value = -1 }
  void runTerm(v)
}
function termHist(d: -1 | 1) {
  const n = termHistIdx.value + d
  if (n >= -1 && n < termHistArr.value.length) {
    termHistIdx.value = n
    termInput.value = n === -1 ? '' : termHistArr.value[n]
  }
}
function toggleTerm() {
  termOpen.value = !termOpen.value
  if (termOpen.value) {
    termCwd.value = active.value?.fileType === 'folder' ? (active.value.path || store.currentPath) : store.currentPath
    nextTick(() => termInputRef.value?.focus())
    if (!termLines.value.length) void runTerm(`ls -la ${sh(termCwd.value)}`)
  }
}
function openFolderInTerm(f?: FileNode, full = false) {
  const p = f ? (f.fileType === 'folder' ? (f.path || store.currentPath + '/' + f.name) : store.currentPath) : store.currentPath
  if (full) { wm.open('terminal'); void store.execShellLine(`cd ${sh(p)}`) }
  else {
    termOpen.value = true
    termCwd.value = p
    nextTick(() => termInputRef.value?.focus())
    void runTerm(`cd ${sh(p)} && ls -la`)
  }
}

// ── keyboard ──
function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
  if (e.key === 'Delete' || e.key === 'Backspace') { if (store.selectedFileIds.length) askDeleteSel(); else if (active.value) askDelete(active.value) }
  else if (e.key === 'F2' && active.value) beginRename(active.value)
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll() }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') copySel()
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') cutSel()
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') void pasteHere()
  else if (e.key === 'Enter' && active.value) openFile(active.value)
  else if (e.key === 'Escape') { clearSel(); termOpen.value = false }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const ids = sortedFiles.value.map(f => f.id)
    let i = active.value ? ids.indexOf(active.value.id) : -1
    i = e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1)
    if (ids[i]) store.selectFile(ids[i])
  }
}

onMounted(() => {
  void Promise.all([store.fetchOsDf(), store.fetchSyncConfigs(), store.fetchDisks(), store.fetchCollections()]).catch(() => {})
  void store.fetchFiles(store.currentPath)
})
</script>

<style scoped>
.fm { position: relative; display: flex; flex-direction: column; height: 100%; overflow: hidden; outline: none;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 55%, transparent), color-mix(in srgb, var(--ui-content) 96%, transparent));
  color: var(--ui-text); font-size: 12px; }
.fm-aurora { position: absolute; inset: -20%; pointer-events: none; z-index: 0;
  background: radial-gradient(38% 34% at 12% 0%, color-mix(in srgb, var(--ui-accent) 14%, transparent), transparent 70%),
    radial-gradient(40% 36% at 88% 100%, color-mix(in srgb, var(--ui-info) 10%, transparent), transparent 70%);
  animation: fm-drift 24s ease-in-out infinite alternate; }
@keyframes fm-drift { from { transform: translate3d(-1.5%, -1%, 0); } to { transform: translate3d(1.5%, 1.5%, 0) scale(1.04); } }
.fm-grain { position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: .5;
  background-image: radial-gradient(color-mix(in srgb, var(--ui-text) 5%, transparent) 1px, transparent 1px); background-size: 22px 22px; }
.fm > *:not(.fm-aurora):not(.fm-grain) { position: relative; z-index: 1; }
/* OS drop target (VueUse useDropZone): host-OS files land straight in the vault. */
.fm-drop { outline: 2px dashed color-mix(in srgb, var(--ui-accent) 70%, transparent); outline-offset: -6px; }

/* top bar */
.fm-top { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  background: var(--ui-glass); border-bottom: 1px solid var(--ui-hairline);
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate)); -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate)); }
.fm-nav { display: flex; gap: 2px; }
.fm-ibtn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 9px;
  border: 1px solid transparent; background: transparent; color: var(--ui-text-2); cursor: pointer;
  transition: all var(--ui-dur-fast) var(--ui-ease-out); }
.fm-ibtn:hover:not(:disabled) { background: var(--ui-accent-softer); color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 30%, transparent); }
.fm-ibtn:disabled { opacity: .3; cursor: default; }
.fm-ibtn.sm { width: 24px; height: 24px; border-radius: 7px; }
.fm-crumbs { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; padding: 3px 8px;
  background: color-mix(in srgb, var(--ui-text) 4%, transparent); border: 1px solid var(--ui-hairline); border-radius: 10px; }
.fm-crumb { display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border-radius: 7px; white-space: nowrap;
  color: var(--ui-text-3); background: transparent; border: none; cursor: pointer; font-size: 11.5px; font-weight: 600; }
.fm-crumb:hover { color: var(--ui-text); background: var(--ui-accent-softer); }
.fm-crumb.active { color: var(--ui-accent); }
.fm-crumb-sep { opacity: .4; margin-left: 5px; }
.fm-search { display: flex; align-items: center; gap: 6px; min-width: 170px; max-width: 250px; padding: 0 9px; height: 30px;
  border-radius: 10px; border: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-text) 4%, transparent); color: var(--ui-text-3); }
.fm-search:focus-within { border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); box-shadow: var(--ui-glow-soft); color: var(--ui-accent); }
.fm-search input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--ui-text); font-size: 12px; }
.fm-x { background: none; border: none; color: var(--ui-text-3); cursor: pointer; display: flex; }
.fm-viewswitch { display: flex; gap: 2px; padding: 2px; border-radius: 10px; border: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-text) 3%, transparent); }
.fm-vbtn { display: flex; padding: 5px 8px; border-radius: 7px; border: none; background: transparent; color: var(--ui-text-3); cursor: pointer; }
.fm-vbtn.active { background: var(--ui-accent-softer); color: var(--ui-accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-accent) 35%, transparent); }
.fm-topactions { display: flex; gap: 6px; }
.fm-pill { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 999px; cursor: pointer;
  font-size: 11px; font-weight: 700; color: var(--ui-text); background: var(--ui-accent-softer);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 35%, transparent); transition: all var(--ui-dur-fast) var(--ui-ease-out); white-space: nowrap; }
.fm-pill:hover { transform: translateY(-1px); box-shadow: var(--ui-glow-soft); }
.fm-pill.ghost { background: color-mix(in srgb, var(--ui-text) 5%, transparent); border-color: var(--ui-hairline); color: var(--ui-text-2); }
.fm-pill.ghost.on { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.fm-pill.xs { padding: 3px 9px; font-size: 10px; }
.fm-pill.danger { background: color-mix(in srgb, var(--ui-danger) 14%, transparent); border-color: color-mix(in srgb, var(--ui-danger) 50%, transparent); color: var(--ui-danger); }

/* sub bar */
.fm-sub { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--ui-hairline);
  background: color-mix(in srgb, var(--ui-surface) 70%, transparent); font-size: 10.5px; overflow-x: auto; }
.fm-stat { color: var(--ui-text-3); white-space: nowrap; } .fm-stat b { color: var(--ui-text); }
.fm-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--ui-text-faint); flex-shrink: 0; }
.fm-spacer { flex: 1; }
.fm-vol { display: flex; align-items: center; gap: 6px; }
.fm-volbar { width: 90px; height: 6px; border-radius: 99px; background: color-mix(in srgb, var(--ui-text) 10%, transparent); overflow: hidden; }
.fm-volbar.big { width: 100%; height: 8px; }
.fm-volbar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--ui-accent), var(--ui-info)); transition: width .5s var(--ui-ease-out); }
.fm-pchip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 6px; border-radius: 99px; cursor: pointer;
  border: 1px solid var(--ui-hairline); background: var(--ui-glass); color: var(--ui-text-2); font-size: 10px; font-weight: 700; white-space: nowrap; }
.fm-pchip i { width: 7px; height: 7px; border-radius: 50%; }
.fm-pchip.off { opacity: .45; }
.fm-pchip:hover { border-color: color-mix(in srgb, var(--ui-accent) 40%, transparent); color: var(--ui-text); }

/* main split */
.fm-main { flex: 1; display: grid; grid-template-columns: 212px 1fr 300px; min-height: 0; }
.fm-main.no-side { grid-template-columns: 0 1fr 300px; }
.fm-main.no-insp { grid-template-columns: 212px 1fr 0; }
.fm-main.no-side.no-insp { grid-template-columns: 0 1fr 0; }
.fm-side { border-right: 1px solid var(--ui-hairline); overflow-y: auto; padding: 8px; background: color-mix(in srgb, var(--ui-surface) 55%, transparent); backdrop-filter: blur(8px); }
.fm-main.no-side .fm-side { display: none; }
.fm-side-sec { margin-bottom: 12px; }
.fm-side-h { font-size: 9px; font-weight: 800; letter-spacing: .12em; color: var(--ui-text-3); padding: 4px 6px; }
.fm-srow { display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 8px; border-radius: 9px; cursor: pointer;
  background: transparent; border: 1px solid transparent; color: var(--ui-text-2); font-size: 11.5px; text-align: left; }
.fm-srow:hover { background: var(--ui-accent-softer); color: var(--ui-text); }
.fm-srow.active { background: var(--ui-accent-softer); border-color: color-mix(in srgb, var(--ui-accent) 35%, transparent); color: var(--ui-text); }
.fm-srow.wide { border: 1px solid var(--ui-hairline); margin-bottom: 6px; }
.fm-srow .t { flex: 1; min-width: 0; font-weight: 600; } .fm-srow .m { font-size: 9.5px; color: var(--ui-text-3); }
.fm-sempty { font-size: 10.5px; color: var(--ui-text-3); padding: 6px 8px; }
.fm-pdot { width: 8px; height: 8px; border-radius: 50%; background: var(--ui-success); flex-shrink: 0; }
.fm-pdot.detached, .fm-pdot.error { background: var(--ui-danger); }
.fm-tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 4px; }
.fm-tag { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 99px; cursor: pointer;
  border: 1px solid var(--ui-hairline); background: var(--ui-glass); color: var(--ui-text-2); }
.fm-tag:hover { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.fm-link { background: none; border: none; color: var(--ui-accent); cursor: pointer; font-weight: 700; }

/* center */
.fm-center { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.fm-ctool { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--ui-hairline); }
.fm-select { background: color-mix(in srgb, var(--ui-text) 5%, transparent); border: 1px solid var(--ui-hairline); color: var(--ui-text);
  font-size: 10.5px; font-weight: 700; padding: 4px 6px; border-radius: 8px; cursor: pointer; }
.fm-chipbtn { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; padding: 3px 9px; border-radius: 99px; cursor: pointer;
  border: 1px solid var(--ui-hairline); background: transparent; color: var(--ui-text-3); }
.fm-chipbtn.on { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 50%, transparent); background: var(--ui-accent-softer); }
.fm-bulk { display: flex; align-items: center; gap: 4px; padding: 5px 10px; background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--ui-accent) 30%, transparent); }
.fm-bulk-n { font-size: 10.5px; font-weight: 800; color: var(--ui-accent); margin-right: 6px; }
.fm-bulk button { display: inline-flex; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--ui-hairline);
  background: var(--ui-glass); color: var(--ui-text-2); cursor: pointer; }
.fm-bulk button:hover:not(:disabled) { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 40%, transparent); }
.fm-bulk button:disabled { opacity: .35; } .fm-bulk button.danger { color: var(--ui-danger); }

/* grid — perf: containment + content-visibility */
.fm-grid { flex: 1; overflow-y: auto; padding: 12px; display: grid; gap: 10px; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); }
.fm-grid.masonry { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.fm-grid.compact { gap: 6px; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
.fm-card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 14px 8px 10px;
  border-radius: 16px; cursor: pointer; content-visibility: auto; contain-intrinsic-size: auto 132px;
  background: var(--ui-glass); border: 1px solid var(--ui-border);
  backdrop-filter: blur(var(--ui-blur)); -webkit-backdrop-filter: blur(var(--ui-blur));
  transition: transform var(--ui-dur-fast) var(--ui-ease-spring), border-color var(--ui-dur-fast), box-shadow var(--ui-dur-fast); }
.fm-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); box-shadow: var(--ui-glow-soft); }
.fm-card.sel { border-color: color-mix(in srgb, var(--ui-accent) 65%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-accent) 45%, transparent), var(--ui-glow-soft); }
.fm-card.bulk { border-style: dashed; }
.fm-check { position: absolute; top: 7px; left: 7px; width: 16px; height: 16px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800; border: 1px solid var(--ui-border-strong); color: transparent; background: transparent; cursor: pointer; }
.fm-check.on, .fm-card:hover .fm-check { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.fm-check.on { background: var(--ui-accent-softer); }
.fm-check.sm { position: static; width: 14px; height: 14px; }
.fm-thumb { height: 44px; display: flex; align-items: center; justify-content: center; color: var(--ui-text-2); }
.fm-thumb img { max-width: 64px; max-height: 44px; border-radius: 8px; object-fit: cover; }
.fm-card.sel .fm-thumb { color: var(--ui-accent); }
.fm-cname { font-size: 11px; font-weight: 650; width: 100%; text-align: center; }
.fm-cmeta { font-size: 9.5px; color: var(--ui-text-3); }
.fm-flags { position: absolute; top: 8px; right: 8px; display: flex; gap: 3px; color: var(--ui-text-3); }
.fm-empty { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 48px 20px; color: var(--ui-text-3); }
.fm-empty p { font-weight: 800; color: var(--ui-text-2); margin: 0; } .fm-empty span { font-size: 11px; }
.fm-more { grid-column: 1 / -1; padding: 8px; border-radius: 10px; border: 1px dashed var(--ui-border-strong);
  background: transparent; color: var(--ui-text-2); cursor: pointer; font-weight: 700; }
.fm-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--ui-accent) 30%, transparent);
  border-top-color: var(--ui-accent); animation: fm-rot .7s linear infinite; display: inline-block; }
.fm-spin.sm { width: 11px; height: 11px; }
@keyframes fm-rot { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .fm-spin { animation: none; }
}

/* list */
.fm-listwrap { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.fm-lhead, .fm-lrow { display: grid; grid-template-columns: 30px minmax(0, 3fr) 90px 130px 120px 110px 60px; align-items: center; gap: 6px; padding: 0 10px; }
.fm-lhead { height: 30px; flex-shrink: 0; font-size: 9px; font-weight: 800; letter-spacing: .1em; color: var(--ui-text-3);
  border-bottom: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-surface) 70%, transparent); }
.fm-lhead.compact { height: 26px; }
.fm-lhead span { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm-lhead span:hover { color: var(--ui-text); }
.fm-lbody { flex: 1; overflow-y: auto; }
.fm-lrow { height: 34px; border-bottom: 1px solid var(--ui-hairline); cursor: pointer; content-visibility: auto; contain-intrinsic-size: auto 34px; font-size: 11.5px; }
.fm-lrow.compact { height: 28px; }
.fm-lrow:hover { background: color-mix(in srgb, var(--ui-text) 4%, transparent); }
.fm-lrow.sel { background: var(--ui-accent-softer); box-shadow: inset 2px 0 0 var(--ui-accent); }
.fm-lrow.bulk { background: color-mix(in srgb, var(--ui-accent) 7%, transparent); }
.fm-lrow .c1 { display: flex; align-items: center; gap: 7px; min-width: 0; font-weight: 600; }
.fm-ficon { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; color: var(--ui-text-2); flex-shrink: 0; }
.fm-ficon img { max-width: 22px; max-height: 22px; border-radius: 5px; }
.mono { font-family: var(--ui-font-mono); font-size: 10.5px; }
.dim { color: var(--ui-text-3); }
.c0 { display: flex; justify-content: center; } .c2 { text-align: right; } .c6 { display: flex; gap: 4px; color: var(--ui-text-3); }

/* columns */
.fm-cols { flex: 1; display: grid; grid-template-columns: 1fr 240px; min-height: 0; }
.fm-col { overflow-y: auto; border-right: 1px solid var(--ui-hairline); }
.fm-col-h { position: sticky; top: 0; padding: 7px 10px; font-size: 9px; font-weight: 800; letter-spacing: .12em; color: var(--ui-text-3);
  background: color-mix(in srgb, var(--ui-surface) 85%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--ui-hairline); }
.fm-colrow { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; background: transparent; border: none;
  border-bottom: 1px solid var(--ui-hairline); color: var(--ui-text-2); cursor: pointer; font-size: 12px; text-align: left; }
.fm-colrow:hover { background: var(--ui-accent-softer); }
.fm-colrow.sel { background: var(--ui-accent-softer); color: var(--ui-text); box-shadow: inset 2px 0 0 var(--ui-accent); }
.fm-colprev { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 22px 14px; color: var(--ui-text-2); text-align: center; }
.fm-colbtns { display: flex; gap: 6px; }

/* status + terminal */
.fm-status { display: flex; align-items: center; gap: 8px; padding: 5px 10px; font-size: 10.5px;
  border-top: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-surface) 75%, transparent); overflow: hidden; white-space: nowrap; }
.fm-sbadge { font-size: 9.5px; font-weight: 800; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--ui-hairline); }
.fm-sbadge.lock { color: var(--ui-warning); border-color: color-mix(in srgb, var(--ui-warning) 45%, transparent); }
.fm-sbadge.zip { color: var(--ui-info); border-color: color-mix(in srgb, var(--ui-info) 45%, transparent); }
.fm-sbadge.clip { color: var(--ui-accent); border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.fm-term { border-top: 1px solid color-mix(in srgb, var(--ui-accent) 30%, transparent); background: rgba(0,0,0,.55);
  backdrop-filter: blur(12px); display: flex; flex-direction: column; height: 190px; flex-shrink: 0; }
.fm-term-h { display: flex; align-items: center; gap: 7px; padding: 5px 10px; color: var(--ui-text-2); border-bottom: 1px solid var(--ui-hairline); font-size: 10.5px; }
.fm-term-body { flex: 1; overflow-y: auto; padding: 6px 10px; font-family: var(--ui-font-mono); font-size: 10.5px; }
.fm-term-l.in { color: var(--ui-accent); font-weight: 700; }
.fm-term-l.out { color: var(--ui-text-2); white-space: pre-wrap; word-break: break-word; }
.fm-term-l.err { color: var(--ui-danger); white-space: pre-wrap; }
.fm-term-in { display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-top: 1px solid var(--ui-hairline); color: var(--ui-accent); }
.fm-term-in input { flex: 1; background: transparent; border: none; outline: none; color: var(--ui-text); font-size: 11.5px; }

/* inspector */
.fm-insp { border-left: 1px solid var(--ui-hairline); display: flex; flex-direction: column; min-height: 0; min-width: 0;
  background: var(--ui-glass); backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate)); -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate)); }
.fm-main.no-insp .fm-insp { display: none; }
.fm-iempty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 34px 18px; color: var(--ui-text-3); text-align: center; }
.fm-iempty p { font-weight: 800; color: var(--ui-text-2); margin: 0; } .fm-iempty span { font-size: 11px; }
.fm-volcard { width: 100%; margin-top: 12px; padding: 10px; border-radius: 12px; border: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-text) 3%, transparent); display: flex; flex-direction: column; gap: 7px; }
.fm-ihead { display: flex; align-items: center; gap: 8px; padding: 10px; border-bottom: 1px solid var(--ui-hairline); }
.fm-ithumb { width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: var(--ui-accent-softer); color: var(--ui-accent); border: 1px solid color-mix(in srgb, var(--ui-accent) 35%, transparent); }
.fm-ititle { flex: 1; min-width: 0; font-size: 12px; } .fm-ititle .mono { font-size: 9.5px; }
.fm-tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--ui-hairline); }
.fm-tabs button { flex: 1; padding: 6px 2px; font-size: 9.5px; font-weight: 800; letter-spacing: .06em; cursor: pointer;
  background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--ui-text-3); }
.fm-tabs button.active { color: var(--ui-accent); border-bottom-color: var(--ui-accent); }
.fm-ibody { flex: 1; overflow-y: auto; padding: 10px; }
.fm-isec { display: flex; flex-direction: column; gap: 8px; }
.fm-kv { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; }
.fm-kv span { color: var(--ui-text-3); flex-shrink: 0; } .fm-kv b { font-weight: 650; text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.fm-kv.small { font-size: 10.5px; } .fm-kv.hash b { font-size: 9px; word-break: break-all; }
.fm-btnrow { display: flex; flex-wrap: wrap; gap: 5px; }
.fm-tagedit { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--ui-hairline); }
.fm-tagedit__label { font-size: 9px; font-weight: 700; letter-spacing: 0.8px; color: var(--ui-text-3); }
.fm-tagedit__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.fm-tagedit__chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; padding: 2px 4px 2px 8px; border-radius: var(--ui-radius-full); border: 1px solid color-mix(in srgb, var(--ui-accent) 35%, transparent); background: var(--ui-accent-softer); color: var(--ui-text); }
.fm-tagedit__x { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; border: none; background: transparent; color: var(--ui-text-3); cursor: pointer; font-size: 12px; line-height: 1; }
.fm-tagedit__x:hover { color: var(--ui-danger); }
.fm-tagedit__form { display: flex; gap: 6px; }
.fm-tagedit__input { flex: 1; min-width: 0; background: color-mix(in srgb, var(--ui-surface) 80%, transparent); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); color: var(--ui-text); font-family: var(--ui-font); font-size: 11px; padding: 4px 8px; outline: none; }
.fm-tagedit__input:focus { border-color: color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.fm-cryptocard { padding: 9px 10px; border-radius: 12px; border: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-text) 3%, transparent); display: flex; flex-direction: column; gap: 5px; }
.fm-cryptocard.on { border-color: color-mix(in srgb, var(--ui-warning) 45%, transparent); box-shadow: 0 0 18px color-mix(in srgb, var(--ui-warning) 12%, transparent); }
.fm-algos { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.fm-algo { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; border-radius: 10px; cursor: pointer; text-align: left;
  border: 1px solid var(--ui-hairline); background: transparent; color: var(--ui-text-2); }
.fm-algo b { font-size: 10px; } .fm-algo span { font-size: 9px; color: var(--ui-text-3); font-weight: 800; }
.fm-algo:hover { border-color: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.fm-algo.cur { border-color: color-mix(in srgb, var(--ui-accent) 60%, transparent); background: var(--ui-accent-softer); }
.fm-distro { display: flex; flex-direction: column; gap: 5px; }
.fm-drow { display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 10px; border: 1px solid var(--ui-hairline); background: color-mix(in srgb, var(--ui-text) 2%, transparent); }
.fm-drow i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.fm-drow .t { flex: 1; min-width: 0; font-size: 10.5px; }
.fm-dstat { font-size: 8.5px; font-weight: 800; padding: 1px 7px; border-radius: 99px; background: color-mix(in srgb, var(--ui-text) 8%, transparent); color: var(--ui-text-3); }
.fm-dstat.on { background: color-mix(in srgb, var(--ui-success) 18%, transparent); color: var(--ui-success); }
.fm-sharebox { padding: 8px; border-radius: 9px; border: 1px dashed color-mix(in srgb, var(--ui-accent) 50%, transparent);
  background: var(--ui-accent-softer); color: var(--ui-accent); font-size: 10px; word-break: break-all; }

/* dialogs */
.fm-ov { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--ui-bg-deep) 60%, transparent); backdrop-filter: blur(6px); }
.fm-modal { width: 330px; max-width: 92vw; padding: 18px; border-radius: 18px; background: var(--ui-glass-2);
  border: 1px solid var(--ui-border-strong); box-shadow: var(--ui-shadow-3); backdrop-filter: blur(var(--ui-blur-strong)) saturate(var(--ui-saturate)); }
.fm-modal h3 { margin: 0 0 10px; font-size: 13px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; }
.fm-modal p { margin: 0 0 10px; }
.fm-modal input { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 10px; margin-bottom: 12px;
  background: color-mix(in srgb, var(--ui-text) 5%, transparent); border: 1px solid var(--ui-border); color: var(--ui-text); outline: none; }
.fm-modal input:focus { border-color: color-mix(in srgb, var(--ui-accent) 60%, transparent); }
.fm-mrow { display: flex; justify-content: flex-end; gap: 8px; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hide-sm { }
@media (max-width: 1100px) { .fm-main { grid-template-columns: 180px 1fr 260px; } .fm-main.no-side { grid-template-columns: 0 1fr 260px; } }
@media (max-width: 900px) {
  .fm-main, .fm-main.no-side, .fm-main.no-insp { grid-template-columns: 1fr; }
  .fm-side, .fm-insp { display: none; }
  .hide-sm { display: none; }
  .fm-top { flex-wrap: wrap; } .fm-crumbs { order: 5; flex-basis: 100%; }
}
</style>
