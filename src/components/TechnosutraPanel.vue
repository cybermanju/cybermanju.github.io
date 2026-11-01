<template>
  <section class="technosutra-panel" aria-label="Techno Sutra AR">
    <header class="technosutra-toolbar">
      <nav class="technosutra-routes" aria-label="Techno Sutra sections">
        <button
          v-for="route in TECHNOSUTRA_ROUTES"
          :key="route.id"
          class="technosutra-route"
          :class="{ active: activeRoute === route.id }"
          type="button"
          :aria-current="activeRoute === route.id ? 'page' : undefined"
          @click="activeRoute = route.id"
        >
          {{ route.label }}
        </button>
      </nav>
      <a
        class="technosutra-external"
        :href="activeUrl"
        target="_blank"
        rel="noopener noreferrer"
      >Open in new tab</a>
    </header>
    <iframe
      :key="activeRoute"
      class="technosutra-frame"
      :src="activeUrl"
      :title="`Techno Sutra — ${activeLabel}`"
      :allow="activeIframeAllow"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    />
    <footer class="technosutra-credit">
      <span>Content hosted by Techno Sutra AR</span>
      <a :href="TECHNOSUTRA_SOURCE_URL" target="_blank" rel="noopener noreferrer">Source repository</a>
    </footer>
  </section>
</template>

<script setup lang="ts">
// CyberManju OS — TechnosutraPanel (src/components/TechnosutraPanel.vue).
// Role: host the upstream Techno Sutra AR site as an isolated OS window.
// Exports: module root (see items below).
// Integrates: @/data/technosutra, vue.
// Contracts: remote content stays origin-isolated; camera/XR permissions are delegated only on the AR route.
import { computed, ref } from 'vue'
import {
  TECHNOSUTRA_ROUTES,
  TECHNOSUTRA_SOURCE_URL,
  technosutraFrameAllow,
  technosutraRouteUrl,
  type TechnosutraRouteId,
} from '@/data/technosutra'

const activeRoute = ref<TechnosutraRouteId>('home')
const activeUrl = computed(() => technosutraRouteUrl(activeRoute.value))
const activeLabel = computed(() => TECHNOSUTRA_ROUTES.find((route) => route.id === activeRoute.value)?.label ?? 'Home')
const activeIframeAllow = computed(() => technosutraFrameAllow(activeRoute.value))
</script>

<style scoped>
.technosutra-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: #09090d;
  color: #f4f2ff;
}

.technosutra-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(180, 165, 255, 0.18);
  background: #111019;
}

.technosutra-routes {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
}

.technosutra-route,
.technosutra-external {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #d0c9e8;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
}

.technosutra-route:hover,
.technosutra-external:hover {
  background: rgba(180, 165, 255, 0.1);
  color: #fff;
}

.technosutra-route.active {
  border-color: rgba(180, 165, 255, 0.28);
  background: rgba(143, 115, 255, 0.17);
  color: #fff;
}

.technosutra-external {
  flex: 0 0 auto;
  border-color: rgba(180, 165, 255, 0.2);
}

.technosutra-frame {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: #000;
}

.technosutra-credit {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  color: #9f9aae;
  font-size: 10px;
  line-height: 1.3;
}

.technosutra-credit a {
  color: #c9bdff;
  text-decoration: none;
}

.technosutra-credit a:hover {
  text-decoration: underline;
}

@media (max-width: 520px) {
  .technosutra-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .technosutra-routes {
    width: 100%;
  }

  .technosutra-external {
    align-self: flex-start;
  }
}
</style>
