<!-- CyberManju OS — ContextMenu (src/components/ContextMenu.vue). -->
<!-- Role: Vue desktop UI: windows, panels, overlays. -->
<!-- Exports: module root (see items below). -->
<!-- Integrates: @/…, vue. -->
<!-- Contracts: none special (pure logic; errors bubble to caller). -->
<template>
  <Teleport to="body">
    <Transition name="ctx-fade">
      <div
        v-if="ctx.state.visible"
        ref="menuRef"
        class="ctx-menu"
        :style="menuStyle"
        role="menu"
        aria-label="Context menu"
        tabindex="-1"
        @click.stop
        @contextmenu.prevent
        @keydown="handleKeydown"
      >
        <template v-for="(item, i) in visibleItems" :key="item.id">
          <div v-if="item.divider" class="ctx-divider" role="separator" />
          <div
            v-else
            class="ctx-item"
            :class="{
              'ctx-disabled': item.disabled,
              'ctx-focused': focusIndex === i,
              'ctx-has-submenu': !!item.submenu?.length,
            }"
            role="menuitem"
            :tabindex="item.disabled ? -1 : focusIndex === i ? 0 : -1"
            :aria-disabled="!!item.disabled"
            :aria-haspopup="item.submenu?.length ? 'menu' : undefined"
            :aria-expanded="item.submenu?.length ? openSubmenuId === item.id : undefined"
            @mouseenter="onItemHover(i, item)"
            @click="onItemClick(item)"
          >
            <span class="ctx-icon"><AppIcon :name="item.icon" :size="13" /></span
            ><span class="ctx-label">{{ item.label }}</span
            ><span class="ctx-shortcut text-muted">{{ item.shortcut || '' }}</span
            ><span v-if="item.submenu?.length" class="ctx-arrow"
              ><AppIcon name="solar:alt-arrow-right-bold" :size="11"
            /></span>
          </div>
          <Teleport to="body" v-if="item.submenu?.length && openSubmenuId === item.id">
            <div
              class="ctx-menu ctx-submenu"
              :style="submenuPosition"
              role="menu"
              :aria-label="item.label + ' submenu'"
              @click.stop
              @contextmenu.prevent
              @keydown="handleSubmenuKeydown"
            >
              <template v-for="(sub, si) in item.submenu" :key="sub.id">
                <div v-if="sub.divider" class="ctx-divider" role="separator" />
                <div
                  v-else
                  class="ctx-item"
                  :class="{ 'ctx-disabled': sub.disabled, 'ctx-focused': submenuFocusIndex === si }"
                  role="menuitem"
                  :tabindex="sub.disabled ? -1 : submenuFocusIndex === si ? 0 : -1"
                  :aria-disabled="!!sub.disabled"
                  @mouseenter="submenuFocusIndex = si"
                  @click="onItemClick(sub)"
                >
                  <span class="ctx-icon"><AppIcon :name="sub.icon" :size="13" /></span
                  ><span class="ctx-label">{{ sub.label }}</span
                  ><span class="ctx-shortcut text-muted">{{ sub.shortcut || '' }}</span>
                </div>
              </template>
            </div>
          </Teleport>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useContextMenu, type ContextMenuEntry } from '@/composables/useContextMenu'
const ctx = useContextMenu()
const menuRef = ref<HTMLElement | null>(null)
const focusIndex = ref(-1)
const submenuFocusIndex = ref(-1)
const openSubmenuId = ref<string | null>(null)
const visibleItems = computed(() => ctx.state.items)
const menuStyle = ref<Record<string, string>>({ left: '0px', top: '0px' })
const submenuPosition = ref<Record<string, string>>({ left: '0px', top: '0px' })
function safeInsets() {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const values = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((value) =>
    Math.max(4, parseFloat(value) || 0),
  )
  probe.remove()
  return values
}
function constrainMenu(el: HTMLElement) {
  const [top, right, bottom, left] = safeInsets()
  const maxHeight = Math.max(0, window.innerHeight - top - bottom)
  const maxWidth = Math.max(0, window.innerWidth - left - right)
  // Apply caps before measuring: touch rows and long labels affect actual size.
  el.style.maxHeight = `${maxHeight}px`
  el.style.maxWidth = `${Math.min(300, maxWidth)}px`
  el.style.minWidth = `${Math.min(200, maxWidth)}px`
  return {
    top,
    right,
    bottom,
    left,
    maxHeight,
    maxWidth,
    width: el.offsetWidth,
    height: el.offsetHeight,
  }
}
function positionMain() {
  const el = menuRef.value
  if (!el) return
  const { top, right, bottom, left, maxHeight, maxWidth, width, height } = constrainMenu(el)
  const x = Math.max(left, Math.min(ctx.state.x, window.innerWidth - width - right))
  const y = Math.max(top, Math.min(ctx.state.y, window.innerHeight - height - bottom))
  menuStyle.value = {
    left: `${x}px`,
    top: `${y}px`,
    maxHeight: `${maxHeight}px`,
    maxWidth: `${Math.min(300, maxWidth)}px`,
    minWidth: `${Math.min(200, maxWidth)}px`,
  }
}
function positionSubmenu() {
  const sub = document.querySelector<HTMLElement>('.ctx-submenu')
  const parentIndex = visibleItems.value.findIndex((item) => item.id === openSubmenuId.value)
  if (!sub || parentIndex < 0) return
  const rowIndex = visibleItems.value.slice(0, parentIndex).filter((entry) => !entry.divider).length
  const row = menuRef.value?.querySelectorAll<HTMLElement>('.ctx-item')[rowIndex]
  const r = row?.getBoundingClientRect()
  const xBase = r?.right ?? ctx.state.x + 190
  const yBase = r?.top ?? ctx.state.y
  const { top, right, bottom, left, maxHeight, maxWidth, width, height } = constrainMenu(sub)
  const preferredX =
    xBase + width <= window.innerWidth - right ? xBase : (r?.left ?? ctx.state.x) - width
  const x = Math.max(left, Math.min(preferredX, window.innerWidth - width - right))
  const y = Math.max(top, Math.min(yBase, window.innerHeight - height - bottom))
  submenuPosition.value = {
    left: `${x}px`,
    top: `${y}px`,
    maxHeight: `${maxHeight}px`,
    maxWidth: `${Math.min(300, maxWidth)}px`,
    minWidth: `${Math.min(200, maxWidth)}px`,
  }
}
function enabledMain() {
  return visibleItems.value
    .map((it, i) => ({ it, i }))
    .filter((v) => !v.it.disabled && !v.it.divider)
}
function enabledSub() {
  const list = visibleItems.value.find((it) => it.id === openSubmenuId.value)?.submenu || []
  return list.map((it, i) => ({ it, i })).filter((v) => !v.it.disabled && !v.it.divider)
}
function setMain(index: number) {
  focusIndex.value = index
  nextTick(() => {
    const i = visibleItems.value.slice(0, index + 1).filter((it) => !it.divider).length - 1
    menuRef.value?.querySelectorAll<HTMLElement>('.ctx-item')[i]?.focus()
  })
}
function setSub(index: number) {
  submenuFocusIndex.value = index
  nextTick(() => {
    const list = visibleItems.value.find((it) => it.id === openSubmenuId.value)?.submenu || []
    const i = list.slice(0, index + 1).filter((it) => !it.divider).length - 1
    document
      .querySelector<HTMLElement>('.ctx-submenu')
      ?.querySelectorAll<HTMLElement>('.ctx-item')
      [i]?.focus()
  })
}
function onItemHover(i: number, item: ContextMenuEntry) {
  if (item.disabled || item.divider) return
  focusIndex.value = i
  if (item.submenu?.length) openSubmenu(item)
  else if (openSubmenuId.value) {
    // Keep keyboard navigation in the parent when removing the focused submenu.
    if (document.querySelector('.ctx-submenu')?.contains(document.activeElement)) setMain(i)
    openSubmenuId.value = null
  }
}
function openSubmenu(item: ContextMenuEntry) {
  openSubmenuId.value = item.id
  const first = item.submenu?.find((v) => !v.disabled && !v.divider)
  submenuFocusIndex.value = first ? item.submenu!.indexOf(first) : -1
  nextTick(() => {
    positionSubmenu()
    if (submenuFocusIndex.value >= 0) setSub(submenuFocusIndex.value)
  })
}
function onItemClick(item: ContextMenuEntry) {
  if (item.disabled || item.divider) return
  if (item.submenu?.length) {
    if (openSubmenuId.value === item.id) {
      openSubmenuId.value = null
      setMain(visibleItems.value.indexOf(item))
    } else openSubmenu(item)
    return
  }
  ctx.triggerAction(item)
  openSubmenuId.value = null
}
function move(list: { it: ContextMenuEntry; i: number }[], current: number, delta: number) {
  if (!list.length) return -1
  const at = list.findIndex((v) => v.i === current)
  if (at < 0) return delta > 0 ? list[0].i : list[list.length - 1].i
  return list[(at + delta + list.length) % list.length].i
}
function handleKeydown(e: KeyboardEvent) {
  const list = enabledMain()
  const idx = list.findIndex((v) => v.i === focusIndex.value)
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    setMain(move(list, focusIndex.value, e.key === 'ArrowDown' ? 1 : -1))
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    if (list.length) setMain(e.key === 'Home' ? list[0].i : list[list.length - 1].i)
  } else if (e.key === 'ArrowRight' && list[idx]?.it.submenu?.length) {
    e.preventDefault()
    openSubmenu(list[idx].it)
  } else if ((e.key === 'Enter' || e.key === ' ') && list[idx]) {
    e.preventDefault()
    onItemClick(list[idx].it)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    ctx.close()
  }
}
function handleSubmenuKeydown(e: KeyboardEvent) {
  const list = enabledSub()
  const idx = list.findIndex((v) => v.i === submenuFocusIndex.value)
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    setSub(move(list, submenuFocusIndex.value, e.key === 'ArrowDown' ? 1 : -1))
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    if (list.length) setSub(e.key === 'Home' ? list[0].i : list[list.length - 1].i)
  } else if ((e.key === 'Enter' || e.key === ' ') && list[idx]) {
    e.preventDefault()
    onItemClick(list[idx].it)
  } else if (e.key === 'Escape' || e.key === 'ArrowLeft') {
    e.preventDefault()
    const id = openSubmenuId.value
    openSubmenuId.value = null
    nextTick(() => {
      const parentIndex = visibleItems.value.findIndex((it) => it.id === id)
      setMain(parentIndex)
    })
  } else if (e.key === 'ArrowRight' && list[idx]?.it.submenu?.length) {
    e.preventDefault()
    openSubmenu(list[idx].it)
  }
}
function closeOnScroll(event: Event) {
  if (!ctx.state.visible) return
  if (menuRef.value?.contains(event.target as Node)) positionSubmenu()
  else if (!document.querySelector('.ctx-submenu')?.contains(event.target as Node)) ctx.close()
}
function closeOnResize() {
  if (ctx.state.visible) {
    positionMain()
    positionSubmenu()
  }
}
function closeOnOutsideClick() {
  if (ctx.state.visible) ctx.close()
}
watch(
  () => ctx.state.visible,
  (v) => {
    if (v)
      nextTick(() => {
        positionMain()
        menuRef.value?.focus()
      })
    else {
      openSubmenuId.value = null
      focusIndex.value = -1
      submenuFocusIndex.value = -1
    }
  },
)
watch(
  () => ctx.state.items,
  () => nextTick(positionMain),
)
onMounted(() => {
  nextTick(positionMain)
  document.addEventListener('scroll', closeOnScroll, true)
  window.addEventListener('resize', closeOnResize)
  document.addEventListener('click', closeOnOutsideClick)
})
onUnmounted(() => {
  document.removeEventListener('scroll', closeOnScroll, true)
  window.removeEventListener('resize', closeOnResize)
  document.removeEventListener('click', closeOnOutsideClick)
})
</script>
<style scoped>
.ctx-menu {
  position: fixed;
  box-sizing: border-box;
  z-index: 10100;
  background: var(--ui-glass-2);
  border: 1px solid var(--ui-border);
  min-width: 200px;
  max-width: min(300px, calc(100vw - 8px));
  padding: 4px;
  font-family: var(--ui-font);
  font-size: 13px;
  color: var(--ui-text);
  box-shadow: var(--ui-shadow-menu);
  outline: none;
  backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  -webkit-backdrop-filter: blur(var(--ui-blur)) saturate(var(--ui-saturate));
  border-radius: var(--ui-radius-lg);
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.ctx-submenu {
  position: fixed;
  z-index: 10101;
  border-radius: var(--ui-radius-lg);
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 5px 8px;
  border-radius: var(--ui-radius-sm);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  color: var(--ui-text);
  transition: background-color var(--ui-dur-fast) ease-out;
}
.ctx-item:hover,
.ctx-focused {
  background: var(--ui-accent);
  color: var(--ui-on-accent);
}
.ctx-item:hover .ctx-shortcut,
.ctx-focused .ctx-shortcut {
  color: inherit;
}
.ctx-disabled {
  opacity: 0.35;
  cursor: default;
  pointer-events: none;
}
.ctx-icon {
  width: 16px;
  flex-shrink: 0;
  display: inline-flex;
  justify-content: center;
  color: var(--ui-text-2);
}
.ctx-item:hover .ctx-icon,
.ctx-focused .ctx-icon {
  color: inherit;
}
.ctx-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: lowercase;
}
.ctx-label::first-letter {
  text-transform: uppercase;
}
.ctx-shortcut {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ui-text-3);
  margin-left: 12px;
}
.ctx-arrow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.ctx-divider {
  height: 1px;
  background: var(--ui-separator);
  margin: 4px 8px;
}
.ctx-fade-enter-active,
.ctx-fade-leave-active {
  transition: opacity 0.1s ease;
}
.ctx-fade-enter-from,
.ctx-fade-leave-to {
  opacity: 0;
}
@media (pointer: coarse) {
  .ctx-item {
    min-height: 44px;
    padding: 8px 10px;
    font-size: 15px;
  }
}
</style>
