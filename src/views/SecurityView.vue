<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useMutation } from '@tanstack/vue-query'
import { CheckCircle2, Copy, KeyRound, ShieldCheck, ShieldAlert } from 'lucide-vue-next'
import { auth } from '../api/endpoints'
import { ApiError } from '../api/client'
import { currentUser, refreshSession, primaryRoleLabel } from '../session'

const user = currentUser

const secret = ref('')
const otpauthUri = ref('')
const code = ref('')
const recoveryCodes = ref<string[]>([])
const error = ref('')
const copied = ref(false)

const begin = useMutation({
  mutationFn: auth.mfaBegin,
  onSuccess: (result) => {
    secret.value = result.secret
    otpauthUri.value = result.otpauthUri
    error.value = ''
  },
  onError: (caught) => {
    error.value = caught instanceof ApiError ? caught.message : 'Could not start setup.'
  },
})

const confirm = useMutation({
  mutationFn: () => auth.mfaConfirm(code.value.trim()),
  onSuccess: async (result) => {
    recoveryCodes.value = result.recoveryCodes
    secret.value = ''
    error.value = ''
    await refreshSession()
  },
  onError: (caught) => {
    error.value = caught instanceof ApiError ? caught.message : 'Could not verify that code.'
    code.value = ''
  },
})

async function copyRecovery() {
  await navigator.clipboard.writeText(recoveryCodes.value.join('\n'))
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">{{ primaryRoleLabel }}</p>
      <h1>Account security</h1>
      <p>{{ user?.email }}</p>
    </div>
  </div>

  <article class="panel">
    <div class="panel-head">
      <div><h3>Password</h3><p>Changing your password signs you out on every device.</p></div>
    </div>
    <RouterLink class="action-link" to="/change-password?voluntary=1">
      <KeyRound :size="16" /> Change password
    </RouterLink>
  </article>

  <article class="panel">
    <div class="panel-head">
      <div>
        <h3>Two-factor authentication</h3>
        <p>A code from your phone, on top of your password.</p>
      </div>
    </div>

    <!-- Already on -->
    <div v-if="user?.mfaEnabled && !recoveryCodes.length" class="status-row on">
      <ShieldCheck :size="19" />
      <div>
        <strong>Two-factor authentication is on</strong>
        <p>You’ll be asked for a code from your authenticator app each time you sign in.</p>
      </div>
    </div>

    <!-- Just enrolled: show recovery codes once -->
    <div v-else-if="recoveryCodes.length" class="recovery-block">
      <div class="status-row on">
        <CheckCircle2 :size="19" />
        <div>
          <strong>Two-factor authentication is now on</strong>
          <p>Save these recovery codes somewhere safe. Each works once, and this is the only time they’re shown.</p>
        </div>
      </div>
      <ul class="codes">
        <li v-for="rc in recoveryCodes" :key="rc">{{ rc }}</li>
      </ul>
      <button class="action-link" @click="copyRecovery">
        <Copy :size="15" /> {{ copied ? 'Copied' : 'Copy all codes' }}
      </button>
    </div>

    <!-- Enrolment in progress -->
    <div v-else-if="secret" class="enrol">
      <ol>
        <li>Open your authenticator app (Google Authenticator, Authy, 1Password…).</li>
        <li>
          Add an account and enter this key:
          <code class="secret">{{ secret }}</code>
        </li>
        <li>Enter the 6-digit code it shows.</li>
      </ol>

      <form class="confirm-form" @submit.prevent="confirm.mutate()">
        <input v-model="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="6" required />
        <button class="primary" :disabled="confirm.isPending.value || code.length < 6">
          {{ confirm.isPending.value ? 'Verifying…' : 'Verify and turn on' }}
        </button>
      </form>
      <p v-if="error" class="login-error">{{ error }}</p>
    </div>

    <!-- Not set up -->
    <div v-else>
      <div v-if="user?.mfaEnrolmentRequired" class="status-row warn">
        <ShieldAlert :size="19" />
        <div>
          <strong>Recommended for your role</strong>
          <p>Your account can read every student record in the school.</p>
        </div>
      </div>
      <button class="primary" :disabled="begin.isPending.value" @click="begin.mutate()">
        {{ begin.isPending.value ? 'Starting…' : 'Set up two-factor authentication' }}
      </button>
      <p v-if="error" class="login-error">{{ error }}</p>
    </div>
  </article>
</template>

<style scoped>
.action-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  background: none;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.action-link:hover { background: rgba(91, 77, 247, 0.06); }

.status-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 16px;
  padding: 14px 16px;
  border-radius: 12px;
}
.status-row > svg { flex: none; margin-top: 1px; }
.status-row strong { display: block; margin-bottom: 3px; }
.status-row p { margin: 0; font-size: 0.86rem; line-height: 1.5; opacity: 0.8; }
.status-row.on { background: rgba(22, 163, 74, 0.08); border: 1px solid rgba(22, 163, 74, 0.26); color: #15803d; }
.status-row.warn { background: rgba(249, 115, 22, 0.09); border: 1px solid rgba(249, 115, 22, 0.26); color: #9a3412; }

.enrol ol { margin: 0 0 18px; padding-left: 20px; line-height: 1.9; font-size: 0.9rem; }
.secret {
  display: block;
  margin-top: 6px;
  padding: 9px 12px;
  border-radius: 9px;
  font-family: ui-monospace, monospace;
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  word-break: break-all;
  background: rgba(148, 163, 184, 0.14);
}
.confirm-form { display: flex; gap: 10px; flex-wrap: wrap; }
.confirm-form input {
  width: 140px;
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  font: inherit;
  font-size: 1.05rem;
  letter-spacing: 0.18em;
  text-align: center;
}
.primary {
  padding: 11px 20px;
  border: none;
  border-radius: 10px;
  background: var(--brand, #5b4df7);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.primary:disabled { opacity: 0.6; cursor: default; }

.codes {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 0 0 14px;
  padding: 16px;
  border-radius: 12px;
  background: rgba(148, 163, 184, 0.1);
  font-family: ui-monospace, monospace;
  font-size: 0.9rem;
}
@media (max-width: 520px) { .codes { grid-template-columns: 1fr; } }
</style>
