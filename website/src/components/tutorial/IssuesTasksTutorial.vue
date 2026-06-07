<script setup lang="ts">
/**
 * IssuesTasksTutorial — 教程 7: 问题与任务
 * 创建 issue 表单 + 分配 owner + 状态时间线
 */
import { ref, computed } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import StepperTimeline from '@/components/common/StepperTimeline.vue'

const issueTitle = ref('')
const selectedOwner = ref('coder')
const issueCreated = ref(false)

const agents = [
  { id: 'coder', label: 'Coder' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'tester', label: 'Tester' },
  { id: 'pm', label: 'PM' },
  { id: 'researcher', label: 'Researcher' },
]

const taskStatus = ref<'idle' | 'start' | 'report' | 'block' | 'complete'>('idle')

function createIssue() {
  if (!issueTitle.value.trim()) return
  issueCreated.value = true
  taskStatus.value = 'start'
}

function advanceTask() {
  const flow = ['start', 'report', 'block', 'complete'] as const
  const idx = flow.indexOf(taskStatus.value as any)
  if (idx < flow.length - 1) {
    taskStatus.value = flow[idx + 1]
  }
}

const steps = computed(() => [
  { label: '创建', status: issueCreated.value ? 'done' as const : 'pending' as const },
  { label: '分配', status: issueCreated.value ? 'done' as const : 'pending' as const },
  { label: 'start', status: taskStatus.value !== 'idle' ? 'done' as const : 'pending' as const },
  { label: 'report', status: ['report', 'block', 'complete'].includes(taskStatus.value) ? 'done' as const : taskStatus.value === 'start' ? 'active' as const : 'pending' as const },
  { label: 'complete', status: taskStatus.value === 'complete' ? 'done' as const : 'pending' as const },
])
</script>

<template>
  <div class="tut-issues">
    <h2>7. 问题与任务</h2>
    <p>Lead 创建 issue 并分配 owner，owner 更新任务状态。</p>

    <div class="issue-form">
      <div class="form-field">
        <label>Issue 标题</label>
        <input v-model="issueTitle" placeholder="Build UI components..." :disabled="issueCreated" />
      </div>
      <div class="form-field">
        <label>分配给</label>
        <select v-model="selectedOwner" :disabled="issueCreated">
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.label }}</option>
        </select>
      </div>
      <button class="create-btn" @click="createIssue" :disabled="!issueTitle.trim() || issueCreated">
        {{ issueCreated ? '✓ Issue 已创建' : '创建 Issue' }}
      </button>
    </div>

    <div v-if="issueCreated" class="issue-result fade-in">
      <StepperTimeline :steps="steps" />

      <TerminalPane title="task-update" :show-dots="true">
        <div class="task-output">
          <div><span class="text-cyan">Issue:</span> {{ issueTitle }}</div>
          <div><span class="text-cyan">Owner:</span> {{ selectedOwner }}</div>
          <div><span class="text-cyan">Status:</span> <span class="text-green">{{ taskStatus }}</span></div>
        </div>
      </TerminalPane>

      <button class="advance-btn" @click="advanceTask" :disabled="taskStatus === 'complete'">
        {{ taskStatus === 'complete' ? '✓ 任务完成' : '推进任务状态 →' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.issue-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: var(--space-4) 0;
}
.form-field label {
  display: block;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-3);
  margin-bottom: var(--space-1);
  text-transform: uppercase;
}
.form-field input,
.form-field select {
  width: 100%;
  padding: var(--space-2);
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
.form-field input:focus,
.form-field select:focus {
  border-color: var(--cyan);
  outline: none;
}
.form-field input:disabled,
.form-field select:disabled {
  opacity: 0.6;
}
.create-btn {
  padding: var(--space-2) var(--space-6);
  background: var(--bg-3);
  border: 1px solid var(--green);
  border-radius: var(--radius-sm);
  color: var(--green);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.create-btn:hover:not(:disabled) {
  background: rgba(0, 255, 65, 0.1);
}
.create-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.issue-result {
  margin-top: var(--space-6);
}
.task-output {
  font-size: var(--text-sm);
  line-height: 1.8;
}
.advance-btn {
  margin-top: var(--space-4);
  padding: var(--space-2) var(--space-6);
  background: var(--bg-3);
  border: 1px solid var(--cyan);
  border-radius: var(--radius-sm);
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.advance-btn:hover:not(:disabled) {
  background: rgba(0, 212, 255, 0.1);
}
.advance-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
