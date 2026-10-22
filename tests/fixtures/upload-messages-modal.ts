// CyberManju OS — Upload Messages Modal Fixture (tests/fixtures/upload-messages-modal.ts).
// Role: Mount production dialogs against inert fixture state for browser accessibility checks.
// Exports: Vue app and window.__modalFixture control API.
// Integrates: FileUploadDialog, MessagesHub, shared production useFocusTrap.
// Contracts: No backend/native/message/upload IO; all transport attempts throw and increment the fixture counter.
import { createApp, defineComponent, h, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import FileUploadDialog from '@/components/FileUploadDialog.vue'
import MessagesHub from '@/components/MessagesHub.vue'

const state = reactive({ uploadOpen: false, messagesOpen: false, centerTab: 'messages' as 'messages' | 'system', messagesSeenAt: 0 })
const escapeCount = ref(0)

const controls = {
  openUpload() { state.uploadOpen = true },
  openMessages() { state.messagesOpen = true },
  openMessagesOverUpload() { state.uploadOpen = true; state.messagesOpen = true },
  closeUpload() { state.uploadOpen = false },
  closeMessages() { state.messagesOpen = false },
  closeAll() { state.messagesOpen = false; state.uploadOpen = false },
  state,
  ioAttempts: 0,
  getState: () => ({ uploadOpen: state.uploadOpen, messagesOpen: state.messagesOpen, centerTab: state.centerTab, escapeCount: escapeCount.value, ioAttempts: controls.ioAttempts }),
}

declare global {
  interface Window { __modalFixture: typeof controls & { ioAttempts: number } }
}

const Root = defineComponent({
  setup() {
    const shellEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') escapeCount.value++ }
    onMounted(() => window.addEventListener('keydown', shellEscape))
    onUnmounted(() => window.removeEventListener('keydown', shellEscape))
    window.__modalFixture = controls
    const openUpload = () => { state.uploadOpen = true }
    const openMessages = () => { state.messagesOpen = true }
    return () => h('main', { class: 'fixture-shell', onKeydown: undefined, 'data-fixture-shell': '' }, [
      h('h1', 'Modal accessibility fixture'),
      h('p', 'Production dialogs with test-only inert dependencies.'),
      h('nav', { 'aria-label': 'Fixture controls', class: 'fixture-controls' }, [
        h('button', { type: 'button', onClick: openUpload }, 'Open upload'),
        h('button', { type: 'button', onClick: openMessages }, 'Open messages'),
        h('button', { type: 'button', onClick: () => { escapeCount.value++ } }, 'Background action'),
        h('button', { type: 'button', onClick: controls.openMessagesOverUpload }, 'Open messages over upload'),
      ]),
      h('p', { role: 'status', 'aria-live': 'polite', 'data-shell-escape-count': '' }, `Shell Escape events: ${escapeCount.value}`),
      h('p', { role: 'status', 'aria-live': 'polite', 'data-io-count': '' }, `Blocked IO attempts: ${controls.ioAttempts}`),
      h(FileUploadDialog, { visible: state.uploadOpen, onClose: () => { state.uploadOpen = false } }),
      h(MessagesHub),
    ])
  },
})

createApp(Root).mount('#app')
void nextTick()
