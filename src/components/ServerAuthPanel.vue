<script setup lang="ts">
// CyberManju OS — Docker/web login gate.
//
// Shown on every device that reaches the dashboard (:3456) without a valid
// JWT: first run offers bootstrap registration, afterwards username+password
// sign-in. Provider OAuth (Google/GitHub/GitLab, Connections tab) is a
// SEPARATE system for sync tokens — it never authenticates /api calls, so
// the old "reconnect with OAuth" hint is gone on purpose.
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useAppStore } from '@/stores/app'
import { getServerUrl } from '@/composables/useTauri'

const store = useAppStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirm = ref('')
const displayName = ref('')

onMounted(async () => {
  await store.checkAuthStatus()
  // First run (no accounts yet): default to registration.
  if (store.needsSetup) mode.value = 'register'
})

const heading = computed(() =>
  mode.value === 'register' ? 'Create the first account' : 'Sign in to CyberManju OS'
)

const canSubmit = computed(() => {
  if (!username.value.trim() || !password.value) return false
  if (mode.value === 'register' && password.value !== confirm.value) return false
  return !store.authBusy
})

async function submit() {
  const user = username.value.trim()
  if (!user || !password.value) return
  if (mode.value === 'register') {
    if (password.value !== confirm.value) return
    const ok = await store.register(user, password.value, displayName.value.trim() || undefined)
    if (ok) {
      username.value = ''
      password.value = ''
      confirm.value = ''
      displayName.value = ''
    }
  } else {
    const ok = await store.login(user, password.value)
    if (ok) {
      username.value = ''
      password.value = ''
    }
  }
}

function switchMode(next: 'login' | 'register') {
  mode.value = next
  password.value = ''
  confirm.value = ''
}

const serverLabel = computed(() => {
  try {
    const configured = getServerUrl()
    if (configured) return configured
    if (typeof window !== 'undefined' && window.location?.port === '3456') {
      return window.location.origin
    }
  } catch {
    // Fall through to the default below.
  }
  return 'http://<server>:3456'
})
</script>

<template>
  <div class="auth-gate" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title">
    <div class="auth-card">
      <div class="auth-brand">
        <img class="auth-logo" src="/bhumisparsha.png" alt="Bhumisparsha" width="40" height="40" />
        <div>
          <h1 id="auth-gate-title" class="auth-title">{{ heading }}</h1>
          <p class="auth-sub">{{ serverLabel }}</p>
        </div>
      </div>

      <p v-if="mode === 'register'" class="auth-hint">
        No dashboard accounts exist yet — this creates the first one. Public
        registration closes afterwards by design; further accounts are created
        by an admin in Accounts → Users.
      </p>
      <p v-else class="auth-hint">
        Dashboard username + password. This signs in <em>this browser</em> —
        every new device signs in once the same way. Cloud OAuth (Google /
        GitHub / GitLab) lives in Accounts → Connections and is separate.
      </p>

      <form class="auth-form" @submit.prevent="submit">
        <label class="auth-field">
          <span>Username</span>
          <input
            v-model="username"
            class="auth-input"
            type="text"
            autocomplete="username"
            placeholder="e.g. admin"
            aria-label="Username"
          />
        </label>
        <label v-if="mode === 'register'" class="auth-field">
          <span>Display name (optional)</span>
          <input
            v-model="displayName"
            class="auth-input"
            type="text"
            autocomplete="nickname"
            placeholder="e.g. NAS Owner"
            aria-label="Display name"
          />
        </label>
        <label class="auth-field">
          <span>Password</span>
          <input
            v-model="password"
            class="auth-input"
            type="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            placeholder="••••••••"
            aria-label="Password"
          />
        </label>
        <label v-if="mode === 'register'" class="auth-field">
          <span>Confirm password</span>
          <input
            v-model="confirm"
            class="auth-input"
            type="password"
            autocomplete="new-password"
            placeholder="••••••••"
            aria-label="Confirm password"
          />
        </label>

        <p v-if="store.authError" class="auth-error" role="alert">{{ store.authError }}</p>

        <button class="auth-submit" type="submit" :disabled="!canSubmit">
          <AppIcon :name="mode === 'register' ? 'solar:user-plus-bold' : 'solar:login-bold'" :size="15" />
          {{ store.authBusy ? 'Working…' : mode === 'register' ? 'Create account & sign in' : 'Sign in' }}
        </button>
      </form>

      <div class="auth-switch">
        <button
          v-if="mode === 'login'"
          class="auth-link"
          type="button"
          @click="switchMode('register')"
        >
          No account yet? Create the first one
        </button>
        <button
          v-else
          class="auth-link"
          type="button"
          @click="switchMode('login')"
        >
          Already have an account? Sign in
        </button>
        <button class="auth-link muted" type="button" @click="store.checkAuthStatus()">
          Re-check server
        </button>
      </div>

      <p class="auth-foot">
        Headless install? Set
        <code>CYBERMANJU_ADMIN_USERNAME</code> +
        <code>CYBERMANJU_ADMIN_PASSWORD</code> once to provision an admin,
        then remove them after the first login.
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-gate {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: radial-gradient(1200px 600px at 50% -10%, rgb(120 80 255 / 0.14), transparent),
    rgb(0 0 0 / 0.72);
  backdrop-filter: blur(6px);
}
.auth-card {
  width: min(430px, 100%);
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 14px;
  background: linear-gradient(180deg, #14101f 0%, #0b0b10 100%);
  color: #f2efff;
  padding: 22px 22px 16px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.6);
}
.auth-brand {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.auth-logo {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 10px;
  flex-shrink: 0;
}
.auth-title {
  font-size: 17px;
  margin: 0;
  letter-spacing: 0.02em;
}
.auth-sub {
  margin: 2px 0 0;
  font-size: 12px;
  opacity: 0.65;
  font-family: ui-monospace, monospace;
}
.auth-hint {
  font-size: 12.5px;
  line-height: 1.5;
  opacity: 0.8;
  margin: 8px 0 14px;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.auth-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 1;
}
.auth-field > span {
  opacity: 0.65;
}
.auth-input {
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 9px;
  background: rgb(255 255 255 / 0.05);
  color: inherit;
  padding: 10px 12px;
  font-size: 14px;
  text-transform: none;
  letter-spacing: normal;
  outline: none;
}
.auth-input:focus {
  border-color: #8b7bff;
  box-shadow: 0 0 0 2px rgb(139 123 255 / 0.3);
}
.auth-error {
  font-size: 12.5px;
  color: #ff9d9d;
  margin: 0;
  word-break: break-word;
}
.auth-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 11px 14px;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  color: #0b0b10;
  background: linear-gradient(180deg, #cfc6ff, #9d8cff);
}
.auth-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.auth-switch {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  gap: 8px;
  flex-wrap: wrap;
}
.auth-link {
  background: none;
  border: none;
  padding: 0;
  color: #bdb2ff;
  font-size: 12.5px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.auth-link.muted {
  color: rgb(255 255 255 / 0.5);
}
.auth-foot {
  margin: 14px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  opacity: 0.55;
}
.auth-foot code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
</style>
