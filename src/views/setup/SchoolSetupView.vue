<script setup lang="ts">
import { ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { CalendarOff, GraduationCap, LayoutGrid, Plus, Trash2, BookMarked } from 'lucide-vue-next'
import { attendance, school } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import LoadingPanel from '../../components/LoadingPanel.vue'

const queryClient = useQueryClient()
const error = ref('')

function invalidate(...keys: string[][]) {
  for (const key of keys) queryClient.invalidateQueries({ queryKey: key })
}

function onError(caught: unknown) {
  error.value = caught instanceof ApiError ? caught.message : 'Something went wrong.'
  setTimeout(() => (error.value = ''), 6000)
}

const classes = useQuery({ queryKey: ['school', 'classes'], queryFn: school.classes })
const sections = useQuery({ queryKey: ['school', 'sections'], queryFn: () => school.sections() })
const subjects = useQuery({ queryKey: ['school', 'subjects'], queryFn: school.subjects })
const holidays = useQuery({ queryKey: ['attendance', 'holidays'], queryFn: attendance.holidays })

// ------------------------------------------------------------------ forms

const newClass = ref({ name: '', sortOrder: 0 })
const addClass = useMutation({
  mutationFn: () => school.createClass({ name: newClass.value.name.trim(), sortOrder: Number(newClass.value.sortOrder) }),
  onSuccess: () => { newClass.value = { name: '', sortOrder: 0 }; invalidate(['school']) },
  onError,
})

const removeClass = useMutation({
  mutationFn: (id: string) => school.deleteClass(id),
  onSuccess: () => invalidate(['school']),
  onError,
})

const newSection = ref({ name: '', classId: '', capacity: '' })
const addSection = useMutation({
  mutationFn: () =>
    school.createSection({
      name: newSection.value.name.trim(),
      classId: newSection.value.classId,
      ...(newSection.value.capacity ? { capacity: Number(newSection.value.capacity) } : {}),
    }),
  onSuccess: () => { newSection.value = { name: '', classId: '', capacity: '' }; invalidate(['school']) },
  onError,
})

const newSubject = ref({ name: '' })
const addSubject = useMutation({
  mutationFn: () => school.createSubject({ name: newSubject.value.name.trim() }),
  onSuccess: () => { newSubject.value = { name: '' }; invalidate(['school']) },
  onError,
})

const newHoliday = ref({ date: '', name: '' })
const addHoliday = useMutation({
  mutationFn: () => attendance.createHoliday({ date: newHoliday.value.date, name: newHoliday.value.name.trim() }),
  onSuccess: () => { newHoliday.value = { date: '', name: '' }; invalidate(['attendance']) },
  onError,
})

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="page-head">
    <div>
      <p class="eyebrow">Configuration</p>
      <h1>School setup</h1>
      <p>Classes, sections and subjects. Everything else in EduNova hangs off these.</p>
    </div>
  </div>

  <p v-if="error" class="login-error">{{ error }}</p>

  <div class="setup-grid">
    <!-- Classes -->
    <article class="panel">
      <div class="panel-head">
        <div><h3><GraduationCap :size="16" /> Classes</h3><p>Grade levels, in order.</p></div>
      </div>

      <LoadingPanel v-if="classes.isPending.value" :rows="2" />
      <ul v-else class="setup-list">
        <li v-for="c in classes.data.value?.data ?? []" :key="c.id">
          <span><strong>{{ c.name }}</strong><small>{{ c.sectionCount }} section{{ c.sectionCount === 1 ? '' : 's' }}</small></span>
          <button
            class="icon-danger"
            :title="`Remove ${c.name}`"
            :disabled="removeClass.isPending.value"
            @click="removeClass.mutate(c.id)"
          >
            <Trash2 :size="15" />
          </button>
        </li>
        <li v-if="!classes.data.value?.data.length" class="empty-row">No classes yet.</li>
      </ul>

      <form class="add-row" @submit.prevent="addClass.mutate()">
        <input v-model="newClass.name" placeholder="Grade 9" required maxlength="60" />
        <input v-model="newClass.sortOrder" type="number" min="0" max="1000" placeholder="Order" class="narrow" />
        <button class="primary" :disabled="!newClass.name.trim() || addClass.isPending.value"><Plus :size="15" /></button>
      </form>
    </article>

    <!-- Sections -->
    <article class="panel">
      <div class="panel-head">
        <div><h3><LayoutGrid :size="16" /> Sections</h3><p>Divisions within a class, for the current session.</p></div>
      </div>

      <LoadingPanel v-if="sections.isPending.value" :rows="2" />
      <ul v-else class="setup-list">
        <li v-for="s in sections.data.value?.data ?? []" :key="s.id">
          <span>
            <strong>{{ s.className }} · {{ s.name }}</strong>
            <small>
              {{ s.studentCount }} student{{ s.studentCount === 1 ? '' : 's' }}<template v-if="s.capacity"> of {{ s.capacity }}</template>
              <template v-if="s.classTeacherName"> · {{ s.classTeacherName }}</template>
            </small>
          </span>
        </li>
        <li v-if="!sections.data.value?.data.length" class="empty-row">No sections yet.</li>
      </ul>

      <form class="add-row" @submit.prevent="addSection.mutate()">
        <select v-model="newSection.classId" required>
          <option value="" disabled>Class…</option>
          <option v-for="c in classes.data.value?.data ?? []" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <input v-model="newSection.name" placeholder="A" required maxlength="30" class="narrow" />
        <input v-model="newSection.capacity" type="number" min="1" placeholder="Cap" class="narrow" />
        <button class="primary" :disabled="!newSection.classId || !newSection.name.trim() || addSection.isPending.value">
          <Plus :size="15" />
        </button>
      </form>
    </article>

    <!-- Subjects -->
    <article class="panel">
      <div class="panel-head">
        <div><h3><BookMarked :size="16" /> Subjects</h3><p>Used by timetables and exams.</p></div>
      </div>

      <LoadingPanel v-if="subjects.isPending.value" :rows="2" />
      <ul v-else class="setup-list">
        <li v-for="s in subjects.data.value?.data ?? []" :key="s.id">
          <span><strong>{{ s.name }}</strong><small class="kind">{{ s.kind.replace('_', ' ') }}</small></span>
        </li>
        <li v-if="!subjects.data.value?.data.length" class="empty-row">No subjects yet.</li>
      </ul>

      <form class="add-row" @submit.prevent="addSubject.mutate()">
        <input v-model="newSubject.name" placeholder="Mathematics" required maxlength="80" />
        <button class="primary" :disabled="!newSubject.name.trim() || addSubject.isPending.value"><Plus :size="15" /></button>
      </form>
    </article>

    <!-- Holidays -->
    <article class="panel">
      <div class="panel-head">
        <div>
          <h3><CalendarOff :size="16" /> Holidays</h3>
          <p>Attendance cannot be recorded on these days.</p>
        </div>
      </div>

      <LoadingPanel v-if="holidays.isPending.value" :rows="2" />
      <ul v-else class="setup-list">
        <li v-for="h in holidays.data.value?.data ?? []" :key="h.id">
          <span><strong>{{ h.name }}</strong><small>{{ formatDate(h.date) }}</small></span>
        </li>
        <li v-if="!holidays.data.value?.data.length" class="empty-row">No holidays declared.</li>
      </ul>

      <form class="add-row" @submit.prevent="addHoliday.mutate()">
        <input v-model="newHoliday.date" type="date" required />
        <input v-model="newHoliday.name" placeholder="Founders Day" required maxlength="120" />
        <button class="primary" :disabled="!newHoliday.date || !newHoliday.name.trim() || addHoliday.isPending.value">
          <Plus :size="15" />
        </button>
      </form>
    </article>
  </div>
</template>

<style scoped>
.setup-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
@media (max-width: 900px) { .setup-grid { grid-template-columns: 1fr; } }

.panel-head h3 { display: flex; align-items: center; gap: 8px; }

.setup-list { list-style: none; margin: 0 0 14px; padding: 0; max-height: 260px; overflow-y: auto; }
.setup-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 2px;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
}
.setup-list li:first-child { border-top: none; }
.setup-list li > span { flex: 1; min-width: 0; }
.setup-list strong { display: block; font-size: 0.88rem; }
.setup-list small { font-size: 0.76rem; opacity: 0.55; }
/* Only the subject kind needs capitalising; it leaked onto counts like "0 sections". */
.setup-list .kind { text-transform: capitalize; }
.empty-row { font-size: 0.85rem; opacity: 0.5; padding: 14px 2px; }

.icon-danger {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: none;
  color: #b91c1c;
  cursor: pointer;
}
.icon-danger:hover:not(:disabled) { background: rgba(220, 38, 38, 0.08); }
.icon-danger:disabled { opacity: 0.4; cursor: default; }

.add-row { display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid rgba(148, 163, 184, 0.18); }
.add-row input,
.add-row select {
  flex: 1;
  min-width: 0;
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  background: var(--surface, #fff);
  font: inherit;
  font-size: 0.86rem;
}
.add-row .narrow { flex: 0 0 76px; }
.add-row .primary {
  flex: none;
  display: grid;
  place-items: center;
  width: 38px;
  border: none;
  border-radius: 9px;
  background: var(--brand, #5b4df7);
  color: #fff;
  cursor: pointer;
}
.add-row .primary:disabled { opacity: 0.5; cursor: default; }
</style>
