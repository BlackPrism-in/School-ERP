<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck, CheckCircle2, KeyRound } from 'lucide-vue-next'
import { auth } from '../api/endpoints'
import { ApiError } from '../api/client'
import { refreshSession } from '../session'

const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const totp = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')
const needsTotp = ref(false)
const totpInput = ref<HTMLInputElement | null>(null)

const recoveryMode = ref(false)
const recoverySent = ref(false)
const recoveryEmail = ref('')

const canSubmit = computed(() => email.value.trim() !== '' && password.value !== '' && !loading.value)

async function submit() {
  error.value = ''
  loading.value = true

  try {
    await auth.login(email.value.trim(), password.value, needsTotp.value ? totp.value.trim() : undefined)
    await refreshSession()

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/app'
    await router.replace(redirect)
  } catch (caught) {
    if (!(caught instanceof ApiError)) {
      error.value = 'Something went wrong. Please try again.'
      return
    }

    if (caught.code === 'mfa_required') {
      // Second factor needed. The password was already accepted, so keep it
      // and just ask for the code.
      if (!needsTotp.value) {
        needsTotp.value = true
        error.value = ''
        await nextTick()
        totpInput.value?.focus()
      } else {
        error.value = 'That code was not accepted. Try the next one from your app.'
        totp.value = ''
      }
      return
    }

    error.value = caught.message
    if (caught.code !== 'account_locked') password.value = ''
  } finally {
    loading.value = false
  }
}

async function sendRecovery() {
  error.value = ''
  loading.value = true
  try {
    await auth.forgotPassword(recoveryEmail.value.trim() || email.value.trim())
    recoverySent.value = true
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : 'Could not send the reset link.'
  } finally {
    loading.value = false
  }
}

function backToPassword() {
  needsTotp.value = false
  totp.value = ''
  error.value = ''
}
</script>

<template>
  <div class="login-page">
    <div class="login-visual">
      <button class="back-home" @click="router.push('/')"><ArrowLeft :size="17" /> Back to website</button>
      <div class="login-quote">
        <div class="quote-brand"><span>E</span> EduNova</div>
        <h1>School feels simpler<br>when everything connects.</h1>
        <p>One secure home for learning, communication and operations.</p>
      </div>
      <div class="visual-orb one"></div>
      <div class="visual-orb two"></div>
    </div>

    <main class="login-form-wrap">
      <div class="login-form">
        <div class="mobile-login-brand"><span>E</span><strong>EduNova</strong></div>

        <!-- Password reset request -->
        <template v-if="recoveryMode">
          <p class="login-kicker">ACCOUNT RECOVERY</p>
          <h2>Reset your password</h2>
          <p class="login-sub">We’ll email you a link to set a new password.</p>

          <div v-if="recoverySent" class="recovery-message">
            <CheckCircle2 :size="15" />
            If that address has an account, a reset link is on its way.
          </div>

          <form v-else @submit.prevent="sendRecovery">
            <label>
              Email address
              <div class="field">
                <input v-model="recoveryEmail" type="email" required autocomplete="email" :placeholder="email || 'you@school.edu'" />
              </div>
            </label>
            <div v-if="error" class="login-error">{{ error }}</div>
            <button class="login-submit" :disabled="loading">
              <span v-if="loading" class="spinner"></span>
              <template v-else>Send reset link <ArrowRight :size="17" /></template>
            </button>
          </form>

          <button class="link-button" @click="recoveryMode = false; recoverySent = false; error = ''">
            Back to sign in
          </button>
        </template>

        <!-- Second factor -->
        <template v-else-if="needsTotp">
          <p class="login-kicker">TWO-FACTOR AUTHENTICATION</p>
          <h2>Enter your code</h2>
          <p class="login-sub">Open your authenticator app and enter the 6-digit code. You can also use a recovery code.</p>

          <form @submit.prevent="submit">
            <label>
              Authentication code
              <div class="field">
                <input
                  ref="totpInput"
                  v-model="totp"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="123456"
                  required
                  @input="error = ''"
                />
                <KeyRound :size="17" />
              </div>
            </label>
            <div v-if="error" class="login-error">{{ error }}</div>
            <button class="login-submit" :disabled="loading || !totp">
              <span v-if="loading" class="spinner"></span>
              <template v-else>Verify <ArrowRight :size="17" /></template>
            </button>
          </form>

          <button class="link-button" @click="backToPassword">Use a different account</button>
        </template>

        <!-- Password -->
        <template v-else>
          <p class="login-kicker">WELCOME BACK</p>
          <h2>Sign in to your workspace</h2>
          <p class="login-sub">Use the account your school administrator issued you.</p>

          <form @submit.prevent="submit">
            <label>
              Email address
              <div class="field">
                <input v-model="email" type="email" required autocomplete="username" placeholder="you@school.edu" @input="error = ''" />
              </div>
            </label>

            <label>
              Password
              <div class="field">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  required
                  autocomplete="current-password"
                  @input="error = ''"
                />
                <button type="button" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword">
                  <EyeOff v-if="showPassword" :size="17" />
                  <Eye v-else :size="17" />
                </button>
              </div>
            </label>

            <div class="form-row">
              <span></span>
              <a href="#" @click.prevent="recoveryMode = true; recoveryEmail = email; error = ''">Forgot password?</a>
            </div>

            <div v-if="error" class="login-error">{{ error }}</div>

            <button class="login-submit" :disabled="!canSubmit">
              <span v-if="loading" class="spinner"></span>
              <template v-else>Sign in <ArrowRight :size="17" /></template>
            </button>
          </form>

          <div class="demo-note">
            <ShieldCheck :size="18" />
            <span>
              <strong>No shared accounts</strong>
              <small>Every person signs in as themselves — that is what makes the audit trail meaningful.</small>
            </span>
          </div>
        </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
.link-button {
  margin-top: 18px;
  background: none;
  border: none;
  padding: 0;
  color: var(--brand, #5b4df7);
  font: inherit;
  font-size: 0.88rem;
  cursor: pointer;
}
.link-button:hover { text-decoration: underline; }
.form-row span { flex: 1; }
</style>
