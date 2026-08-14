<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AlertTriangle, Receipt, Search, Undo2, WalletCards } from 'lucide-vue-next'
import { fees, students } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import { can } from '../../session'
import LoadingPanel from '../../components/LoadingPanel.vue'
import ErrorPanel from '../../components/ErrorPanel.vue'

const queryClient = useQueryClient()

const search = ref('')
const debounced = ref('')
const selectedId = ref('')

let timer: ReturnType<typeof setTimeout>
watch(search, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => (debounced.value = v), 300)
})

const results = useQuery({
  queryKey: computed(() => ['students', 'feeSearch', debounced.value]),
  queryFn: () => students.list({ q: debounced.value, pageSize: 8 }),
  enabled: computed(() => debounced.value.trim().length >= 2),
})

const ledger = useQuery({
  queryKey: computed(() => ['fees', 'student', selectedId.value]),
  queryFn: () => fees.forStudent(selectedId.value),
  enabled: computed(() => Boolean(selectedId.value)),
})

type Ledger = {
  invoices: Record<string, string>[]
  payments: Record<string, string>[]
  totals: { billed: string; paid: string; outstanding: string }
}
const data = computed(() => ledger.data.value as unknown as Ledger | undefined)

/**
 * Amounts are handled as strings the whole way. Parsing to a float to add
 * ₹0.10 and ₹0.20 gives ₹0.30000000000000004, and a school reconciling a
 * day's cash does not need that.
 */
const amount = ref('')
const method = ref('cash')
const referenceNo = ref('')
const collectError = ref('')
const lastReceipt = ref('')

const outstanding = computed(() => data.value?.totals.outstanding ?? '0.00')

const amountValid = computed(() => {
  if (!/^\d+(\.\d{1,2})?$/.test(amount.value)) return false
  // String compare would be wrong here; this one comparison is safe because
  // it is only gating the button — the server re-checks in SQL.
  return Number(amount.value) > 0 && Number(amount.value) <= Number(outstanding.value)
})

const collect = useMutation({
  mutationFn: () =>
    fees.collect({
      studentId: selectedId.value,
      amount: amount.value,
      method: method.value,
      ...(referenceNo.value.trim() ? { referenceNo: referenceNo.value.trim() } : {}),
    }),
  onSuccess: async (result) => {
    lastReceipt.value = result.receiptNo
    amount.value = ''
    referenceNo.value = ''
    collectError.value = ''
    await queryClient.invalidateQueries({ queryKey: ['fees'] })
  },
  onError: (caught) => {
    collectError.value = caught instanceof ApiError ? caught.message : 'Could not record the payment.'
  },
})

const reversing = ref<string | null>(null)
const reversalReason = ref('')

const reverse = useMutation({
  mutationFn: (paymentId: string) => fees.reverse(paymentId, reversalReason.value.trim()),
  onSuccess: async () => {
    reversing.value = null
    reversalReason.value = ''
    await queryClient.invalidateQueries({ queryKey: ['fees'] })
  },
})

function money(value: string | undefined) {
  if (value === undefined) return '—'
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function select(id: string) {
  selectedId.value = id
  lastReceipt.value = ''
  collectError.value = ''
}
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">Finance</p>
      <h1>Collect fees</h1>
      <p>Find a student, then take the payment.</p>
    </div>
  </div>

  <div class="toolbar-search">
    <Search :size="17" />
    <input v-model="search" placeholder="Search by name or admission number…" />
  </div>

  <ul v-if="results.data.value?.data.length && !selectedId" class="result-list">
    <li v-for="s in results.data.value.data" :key="s.id">
      <button @click="select(s.id)">
        <strong>{{ s.firstName }} {{ s.lastName ?? '' }}</strong>
        <small>{{ s.admissionNo }}<template v-if="s.className"> · {{ s.className }} {{ s.sectionName }}</template></small>
      </button>
    </li>
  </ul>

  <div v-if="!selectedId" class="empty-state">
    <WalletCards :size="32" />
    <h3>No student selected</h3>
    <p>Search above to open a student's fee ledger.</p>
  </div>

  <template v-else>
    <button class="back-link" @click="selectedId = ''">← Choose a different student</button>

    <LoadingPanel v-if="ledger.isPending.value" :rows="4" label="Loading ledger…" />
    <ErrorPanel
      v-else-if="ledger.isError.value"
      :error="ledger.error.value"
      context="Could not load the ledger"
      @retry="ledger.refetch"
    />

    <template v-else-if="data">
      <div class="totals">
        <div><small>Billed</small><strong>{{ money(data.totals.billed) }}</strong></div>
        <div><small>Paid</small><strong class="paid">{{ money(data.totals.paid) }}</strong></div>
        <div><small>Outstanding</small><strong class="due">{{ money(data.totals.outstanding) }}</strong></div>
      </div>

      <div v-if="lastReceipt" class="receipt-banner">
        <Receipt :size="19" />
        <div><strong>Payment recorded</strong><p>Receipt {{ lastReceipt }}</p></div>
      </div>

      <article v-if="can('fee.collect') && Number(outstanding) > 0" class="panel">
        <div class="panel-head"><div><h3>Take a payment</h3></div></div>
        <form class="collect-form" @submit.prevent="collect.mutate()">
          <label>
            Amount
            <input v-model="amount" inputmode="decimal" placeholder="0.00" required />
          </label>
          <label>
            Method
            <select v-model="method">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </label>
          <label>
            Reference
            <input v-model="referenceNo" placeholder="UTR / cheque no." maxlength="80" />
          </label>
          <button class="primary" :disabled="!amountValid || collect.isPending.value">
            {{ collect.isPending.value ? 'Recording…' : 'Record payment' }}
          </button>
        </form>
        <p v-if="amount && !amountValid" class="hint-error">
          Enter an amount up to {{ money(outstanding) }}, with at most two decimal places.
        </p>
        <p v-if="collectError" class="login-error">{{ collectError }}</p>
      </article>

      <article class="panel">
        <div class="panel-head"><div><h3>Invoices</h3></div></div>
        <table class="data-table">
          <thead>
            <tr><th>Invoice</th><th>Due</th><th class="num">Net</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr v-for="i in data.invoices" :key="i.id">
              <td class="mono">{{ i.invoiceNo }}</td>
              <td>{{ new Date(i.dueDate).toLocaleDateString('en-IN') }}</td>
              <td class="num">{{ money(i.netAmount) }}</td>
              <td class="num">{{ money(i.paidAmount) }}</td>
              <td class="num"><strong>{{ money(i.balanceAmount) }}</strong></td>
              <td><span :class="['badge', i.status]">{{ String(i.status).replace('_', ' ') }}</span></td>
            </tr>
            <tr v-if="!data.invoices.length"><td colspan="6" class="muted">No invoices raised.</td></tr>
          </tbody>
        </table>
      </article>

      <article class="panel">
        <div class="panel-head"><div><h3>Payments</h3><p>Receipts are permanent. A mistake is corrected by a reversal, never a deletion.</p></div></div>
        <table class="data-table">
          <thead>
            <tr><th>Receipt</th><th>Date</th><th>Method</th><th class="num">Amount</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="p in data.payments" :key="p.id" :class="{ reversed: p.status === 'reversed' }">
              <td class="mono">{{ p.receiptNo }}</td>
              <td>{{ new Date(p.paidOn).toLocaleDateString('en-IN') }}</td>
              <td class="cap">{{ String(p.method).replace('_', ' ') }}</td>
              <td class="num">{{ money(p.amount) }}</td>
              <td>
                <span :class="['badge', p.status]">{{ p.status }}</span>
                <small v-if="p.reversalReason" class="reason">{{ p.reversalReason }}</small>
              </td>
              <td>
                <button
                  v-if="p.status === 'completed' && can('fee.reverse')"
                  class="mini danger"
                  @click="reversing = String(p.id)"
                >
                  <Undo2 :size="13" /> Reverse
                </button>
              </td>
            </tr>
            <tr v-if="!data.payments.length"><td colspan="6" class="muted">No payments recorded.</td></tr>
          </tbody>
        </table>
      </article>
    </template>
  </template>

  <!-- Reversal -->
  <div v-if="reversing" class="modal-backdrop" @click.self="reversing = null">
    <div class="modal" role="dialog" aria-modal="true">
      <h2><AlertTriangle :size="19" /> Reverse this payment?</h2>
      <p class="confirm-body">
        The original receipt stays exactly as issued — a parent may be holding a printout of it. A
        separate reversal receipt is created and the balance goes back on the invoice.
      </p>
      <label class="field-label">
        Reason
        <input v-model="reversalReason" placeholder="e.g. Cheque bounced" maxlength="300" />
      </label>
      <div class="modal-actions">
        <button class="secondary" @click="reversing = null">Cancel</button>
        <button
          class="danger"
          :disabled="reversalReason.trim().length < 3 || reverse.isPending.value"
          @click="reverse.mutate(reversing!)"
        >
          {{ reverse.isPending.value ? 'Reversing…' : 'Reverse payment' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar-search {
  display: flex; align-items: center; gap: 9px;
  max-width: 480px; padding: 0 12px; margin-bottom: 16px;
  border-radius: 11px; border: 1px solid rgba(148, 163, 184, 0.3); background: var(--surface, #fff);
}
.toolbar-search input { flex: 1; padding: 11px 0; border: none; background: none; font: inherit; outline: none; }

.result-list { list-style: none; margin: 0 0 18px; padding: 0; max-width: 480px; display: grid; gap: 6px; }
.result-list button {
  width: 100%; text-align: left; padding: 10px 13px;
  border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.24);
  background: var(--surface, #fff); font: inherit; cursor: pointer;
}
.result-list button:hover { border-color: var(--brand, #5b4df7); }
.result-list strong { display: block; font-size: 0.9rem; }
.result-list small { font-size: 0.78rem; opacity: 0.6; }

.back-link { border: none; background: none; padding: 0 0 14px; font: inherit; font-size: 0.86rem; opacity: 0.7; cursor: pointer; }

.totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 18px; }
@media (max-width: 620px) { .totals { grid-template-columns: 1fr; } }
.totals > div {
  padding: 15px 18px; border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.22); background: var(--surface, #fff);
}
.totals small { display: block; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.55; margin-bottom: 5px; }
.totals strong { font-size: 1.3rem; font-variant-numeric: tabular-nums; }
.totals .paid { color: #15803d; }
.totals .due { color: #b91c1c; }

.receipt-banner {
  display: flex; gap: 12px; align-items: center;
  margin-bottom: 18px; padding: 14px 18px; border-radius: 14px;
  background: rgba(22, 163, 74, 0.08); border: 1px solid rgba(22, 163, 74, 0.26); color: #15803d;
}
.receipt-banner strong { display: block; }
.receipt-banner p { margin: 2px 0 0; font-size: 0.86rem; font-variant-numeric: tabular-nums; }

.collect-form { display: grid; grid-template-columns: 140px 150px 1fr auto; gap: 12px; align-items: end; }
@media (max-width: 760px) { .collect-form { grid-template-columns: 1fr; } }
.collect-form label { display: grid; gap: 6px; font-size: 0.82rem; font-weight: 600; }
.collect-form input, .collect-form select {
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.34); background: var(--surface, #fff);
  font: inherit; font-weight: 400;
}
.collect-form .primary {
  padding: 11px 18px; border: none; border-radius: 10px;
  background: var(--brand, #5b4df7); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
.collect-form .primary:disabled { opacity: 0.5; cursor: default; }
.hint-error { margin: 10px 0 0; font-size: 0.82rem; color: #b91c1c; }

.data-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.data-table th {
  padding: 9px 12px; text-align: left; font-size: 0.72rem;
  text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
}
.data-table td { padding: 10px 12px; border-bottom: 1px solid rgba(148, 163, 184, 0.12); }
.data-table tbody tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
th.num { text-align: right; }
.mono { font-variant-numeric: tabular-nums; }
.cap { text-transform: capitalize; }
.muted { opacity: 0.45; }
tr.reversed { opacity: 0.6; }
tr.reversed .mono { text-decoration: line-through; }
.reason { display: block; font-size: 0.74rem; opacity: 0.6; }

.badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.73rem; font-weight: 600; text-transform: capitalize; background: rgba(148,163,184,0.16); }
.badge.paid, .badge.completed { background: rgba(22, 163, 74, 0.13); color: #15803d; }
.badge.partly_paid { background: rgba(234, 88, 12, 0.12); color: #c2410c; }
.badge.issued { background: rgba(59, 130, 246, 0.12); color: #1d4ed8; }
.badge.reversed { background: rgba(220, 38, 38, 0.11); color: #b91c1c; }

.mini {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.32); background: none;
  font: inherit; font-size: 0.77rem; cursor: pointer;
}
.mini.danger { color: #b91c1c; border-color: rgba(220, 38, 38, 0.3); }

.empty-state {
  display: grid; justify-items: center; gap: 8px;
  padding: 48px 24px; text-align: center;
  border-radius: 16px; border: 1px dashed rgba(148, 163, 184, 0.42);
}
.empty-state svg { opacity: 0.4; }
.empty-state h3 { margin: 6px 0 0; }
.empty-state p { margin: 0; opacity: 0.68; }

.modal-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px; background: rgba(15,23,42,0.45); }
.modal { width: min(480px, 100%); padding: 24px; border-radius: 18px; background: var(--surface, #fff); box-shadow: 0 30px 70px rgba(15,23,42,0.28); }
.modal h2 { display: flex; align-items: center; gap: 9px; margin: 0 0 10px; font-size: 1.08rem; color: #b91c1c; }
.confirm-body { margin: 0 0 16px; font-size: 0.88rem; line-height: 1.55; opacity: 0.78; }
.field-label { display: grid; gap: 6px; font-size: 0.84rem; font-weight: 600; }
.field-label input { padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.34); font: inherit; font-weight: 400; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.modal-actions button { padding: 10px 18px; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; }
.modal-actions .secondary { border: 1px solid rgba(148,163,184,0.34); background: none; }
.modal-actions .danger { border: 1px solid rgba(220,38,38,0.4); background: #dc2626; color: #fff; }
.modal-actions .danger:disabled { opacity: 0.5; cursor: default; }
</style>
