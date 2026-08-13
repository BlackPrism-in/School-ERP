<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, CheckCircle2, ShieldAlert, Eye, EyeOff } from 'lucide-vue-next'
import { auth } from '../api/endpoints'
import { ApiError } from '../api/client'
import { clearSession, currentUser } from '../session'

const router = useRouter()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const show = ref(false)
const loading = ref(false)
const error = ref('')
const fieldError = ref('')
const done = ref(false)

const forced = computed(() => currentUser.value?.mustChangePassword ?? false)

/** Mirrors the server's rules so the user is not told "no" only after submitting. */
const checks = computed(() => [
  { label: 'At least 12 characters', ok: newPassword.value.length >= 12 },
  { label: 'Not a commonly guessed password', ok: newPassword.value.length === 0 || !isCommon(newPassword.value) },
  { label: 'Enough variety of characters', ok: new Set(newPassword.value).size >= 5 },
  { label: 'Different from your current password', ok: newPassword.value !== '' && newPassword.value !== currentPassword.value },
])

const BANNED = ['password', 'password1', 'password123', 'passw0rd', 'demo@123', 'admin@123',
  'welcome1', 'welcome123', 'qwerty123', 'letmein123', '123456789012',
  'school@123', 'teacher@123', 'student@123', 'changeme123']

function isCommon(value: string) {
  return BANNED.includes(value.toLowerCase())
}

const matches = computed(() => confirmPassword.value === '' || newPassword.value === confirmPassword.value)
const canSubmit = computed(
  () => checks.value.every((c) => c.ok) && matches.value && confirmPassword.value !== '' && !loading.value,
)

async function submit() {
  error.value = ''
  fieldError.value = ''
  loading.value = true

  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    // The server invalidates every session on password change, including this
    // one, so there is nothing to refresh — send them back to sign in.
    clearSession()
    done.value = true
    setTimeout(() => router.replace({ name: 'login' }), 1600)
  } catch (caught) {
    if (caught instanceof ApiError) {
      error.value = caught.message
      fieldError.value = caught.fieldError('newPassword') ?? ''
    } else {
      error.value = 'Something went wrong. Please try again.'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-visual">
      <div class="login-quote">
        <div class="quote-brand"><span>E</span> EduNova</div>
        <h1>Set a password<br>only you know.</h1>
        <p>Your account can see real student records. Choose something you have never used elsewhere.</p>
      </div>
      <div class="visual-orb one"></div>
      <div class="visual-orb two"></div>
    </div>

    <main class="login-form-wrap">
      <div class="login-form">
        <div class="mobile-login-brand"><span>E</span><strong>EduNova</strong></div>

        <div v-if="done" class="recovery-message">
          <CheckCircle2 :size="15" />
          Password updated. Taking you to sign in…
        </div>

        <template v-else>
          <p class="login-kicker">ACCOUNT SECURITY</p>
          <h2>{{ forced ? 'Set a new password' : 'Change your password' }}</h2>

          <div v-if="forced" class="forced-banner">
            <ShieldAlert :size="17" />
            <span>Your account was issued a temporary password. Set your own to continue.</span>
          </div>

          <form @submit.prevent="submit">
            <label>
              Current password
              <div class="field">
                <input v-model="currentPassword" :type="show ? 'text' : 'password'" required autocomplete="current-password" @input="error = ''" />
                <button type="button" :aria-label="show ? 'Hide' : 'Show'" @click="show = !show">
                  <EyeOff v-if="show" :size="17" /><Eye v-else :size="17" />
                </button>
              </div>
            </label>

            <label>
              New password
              <div class="field">
                <input v-model="newPassword" :type="show ? 'text' : 'password'" required autocomplete="new-password" @input="error = ''" />
              </div>
            </label>

            <ul class="password-checks">
              <li v-for="check in checks" :key="check.label" :class="{ ok: check.ok }">
                <i></i>{{ check.label }}
              </li>
            </ul>

            <label>
              Confirm new password
              <div class="field">
                <input v-model="confirmPassword" :type="show ? 'text' : 'password'" required autocomplete="new-password" />
              </div>
            </label>
            <p v-if="!matches" class="mismatch">Those passwords do not match.</p>

            <div v-if="fieldError || error" class="login-error">{{ fieldError || error }}</div>

            <button class="login-submit" :disabled="!canSubmit">
              <span v-if="loading" class="spinner"></span>
              <template v-else>Update password <ArrowRight :size="17" /></template>
            </button>
          </form>

          <p class="signout-note">Updating your password signs you out everywhere, including this device.</p>
        </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
.forced-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 0 0 18px;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 0.87rem;
  line-height: 1.45;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.28);
  color: #c2410c;
}
.forced-banner svg { flex: none; margin-top: 1px; }

.password-checks {
  list-style: none;
  margin: 10px 0 18px;
  padding: 0;
  display: grid;
  gap: 7px;
}
.password-checks li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 0.83rem;
  opacity: 0.65;
}
.password-checks li i {
  width: 15px;
  height: 15px;
  flex: none;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  opacity: 0.4;
}
.password-checks li.ok { opacity: 1; color: #15803d; }
.password-checks li.ok i {
  border-color: #15803d;
  background: #15803d;
  box-shadow: inset 0 0 0 2px #fff, inset 0 0 0 3px #15803d;
  opacity: 1;
}

.mismatch { margin: -8px 0 14px; font-size: 0.83rem; color: #dc2626; }
.signout-note { margin-top: 18px; font-size: 0.8rem; opacity: 0.6; line-height: 1.5; }
</style>
