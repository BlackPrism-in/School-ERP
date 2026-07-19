<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, CheckCircle2, Circle, Clock3, X, Trash2 } from 'lucide-vue-next'
import type { Role } from '../data'
const props=defineProps<{role:Role}>()
type Task={id:number;title:string;due:string;priority:'Priority'|'Normal';done:boolean}
const defaults:Record<Role,Task[]>={
 superadmin:[{id:1,title:'Approve admission shortlist',due:'Due today',priority:'Priority',done:false},{id:2,title:'Review payroll authorization',due:'Tomorrow',priority:'Priority',done:false},{id:3,title:'Sign compliance report',due:'24 Jul',priority:'Normal',done:true}],
 admin:[{id:1,title:'Verify admission documents',due:'Due today',priority:'Priority',done:false},{id:2,title:'Resolve fee reconciliation',due:'Tomorrow',priority:'Priority',done:false},{id:3,title:'Submit monthly attendance',due:'24 Jul',priority:'Normal',done:true}],
 teacher:[{id:1,title:'Review Grade 8 assignments',due:'Due today',priority:'Priority',done:false},{id:2,title:'Mark Grade 9B attendance',due:'10:15 AM',priority:'Priority',done:false},{id:3,title:'Prepare science assessment',due:'24 Jul',priority:'Normal',done:false}],
 student:[{id:1,title:'Submit mathematics assignment',due:'Due today',priority:'Priority',done:false},{id:2,title:'Return library book',due:'Friday',priority:'Normal',done:false}],
 guardian:[{id:1,title:'Pay Term II fee',due:'28 Jul',priority:'Priority',done:false},{id:2,title:'Confirm PTM attendance',due:'Tomorrow',priority:'Normal',done:false}]
}
const key=computed(()=>`edunova-tasks-${props.role}`)
const tasks=ref<Task[]>(JSON.parse(localStorage.getItem(key.value)||'null')||defaults[props.role])
const modal=ref(false),title=ref(''),due=ref('Tomorrow'),priority=ref<'Priority'|'Normal'>('Normal')
function persist(){localStorage.setItem(key.value,JSON.stringify(tasks.value))}
function toggle(task:Task){task.done=!task.done;persist()}
function add(){if(!title.value.trim())return;tasks.value.push({id:Date.now(),title:title.value,due:due.value,priority:priority.value,done:false});persist();title.value='';modal.value=false}
function remove(id:number){tasks.value=tasks.value.filter(t=>t.id!==id);persist()}
</script>
<template><article class="panel tasks"><div class="panel-head"><div><h3>Tasks & reminders</h3><p>{{tasks.filter(t=>!t.done).length}} remaining · Keep your day on track</p></div><button class="icon-button" @click="modal=true"><Plus :size="18"/></button></div><div v-if="tasks.length"><div v-for="task in tasks" :key="task.id" class="task-row"><button class="task-toggle" @click="toggle(task)"><CheckCircle2 v-if="task.done" :size="19"/><Circle v-else :size="19"/></button><span :class="{done:task.done}"><strong>{{task.title}}</strong><small><Clock3 :size="13"/>{{task.due}}</small></span><span :class="['priority',task.priority==='Priority'?'high':'normal']">{{task.priority}}</span><button class="task-delete" @click="remove(task.id)"><Trash2 :size="14"/></button></div></div><div v-else class="task-empty"><CheckCircle2 :size="25"/><strong>All caught up!</strong><span>Add a new reminder whenever you need one.</span></div>
<div v-if="modal" class="modal-backdrop" @click.self="modal=false"><form class="task-modal" @submit.prevent="add"><div class="modal-head"><div><p>NEW REMINDER</p><h2>Add a task</h2></div><button type="button" @click="modal=false"><X :size="18"/></button></div><label>Task title<input v-model="title" required autofocus placeholder="What needs to be done?"/></label><div class="task-form-grid"><label>Due date<select v-model="due"><option>Due today</option><option>Tomorrow</option><option>24 Jul</option><option>Next week</option></select></label><label>Priority<select v-model="priority"><option>Normal</option><option>Priority</option></select></label></div><div class="modal-actions"><button type="button" class="secondary" @click="modal=false">Cancel</button><button class="primary">Add reminder</button></div></form></div></article></template>
