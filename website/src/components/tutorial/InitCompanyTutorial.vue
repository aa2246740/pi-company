<script setup lang="ts">
/**
 * InitCompanyTutorial — 教程 2: 初始化公司
 * 命令复制 + 终端预览 + 磁盘变化
 */
import { ref } from 'vue'
import CodeBlock from '@/components/terminal/CodeBlock.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const currentStep = ref(0)

const steps = [
  {
    title: '初始化',
    command: 'pi-company --root ./my-project init --id demo',
    output: [
      { text: '✓ Initialized .pi-company/', type: 'success' },
      { text: '  Created company.yaml', type: 'info' },
      { text: '  Created events/', type: 'info' },
      { text: '  Created mailbox/', type: 'info' },
      { text: '  Updated .gitignore', type: 'info' },
      { text: '✓ Company "demo" ready', type: 'success' },
    ],
  },
  {
    title: '查看状态',
    command: 'pi-company --root ./my-project status',
    output: [
      { text: 'Company: demo', type: 'default' },
      { text: '', type: 'default' },
      { text: 'Agents:', type: 'header' },
      { text: '  (none)', type: 'muted' },
      { text: '', type: 'default' },
      { text: 'Issues: 0 | PRs: 0', type: 'default' },
      { text: 'Rate Limit: none', type: 'success' },
    ],
  },
  {
    title: '启动 Lead',
    command: 'eval "$(pi-company --root ./my-project launch-command lead)"',
    output: [
      { text: '✓ Lead agent launched', type: 'success' },
      { text: '  Monitoring issues, PRs, and mailbox', type: 'info' },
      { text: '◈ Ready for human steering', type: 'info' },
    ],
  },
]

function nextStep() {
  if (currentStep.value < steps.length - 1) currentStep.value++
}
function prevStep() {
  if (currentStep.value > 0) currentStep.value--
}
</script>

<template>
  <div class="tut-init">
    <h2>2. 初始化公司</h2>
    <p>跟随步骤从零创建一个 pi-company 实例。</p>

    <!-- 步骤指示器 -->
    <div class="step-indicator">
      <button
        v-for="(step, i) in steps"
        :key="i"
        class="step-dot"
        :class="{ 'step-dot--active': i === currentStep, 'step-dot--done': i < currentStep }"
        @click="currentStep = i"
      >
        {{ i + 1 }}
      </button>
    </div>

    <!-- 当前步骤 -->
    <div class="step-content fade-in" :key="currentStep">
      <h4>{{ steps[currentStep].title }}</h4>
      <CodeBlock :code="steps[currentStep].command" prompt="$ " />

      <TerminalPane title="output" :show-dots="true">
        <div v-for="(line, j) in steps[currentStep].output" :key="j" class="output-line">
          <span :class="{
            'text-green': line.type === 'success',
            'text-cyan': line.type === 'info',
            'text-muted': line.type === 'muted',
            'text-amber': line.type === 'header',
          }">{{ line.text }}</span>
        </div>
      </TerminalPane>
    </div>

    <!-- 导航 -->
    <div class="step-nav">
      <button class="btn btn--sm" @click="prevStep" :disabled="currentStep === 0">← 上一步</button>
      <span class="step-nav__counter">{{ currentStep + 1 }} / {{ steps.length }}</span>
      <button class="btn btn--sm btn--primary" @click="nextStep" :disabled="currentStep === steps.length - 1">下一步 →</button>
    </div>
  </div>
</template>

<style scoped>
.step-indicator {
  display: flex;
  gap: var(--space-2);
  margin: var(--space-4) 0;
}
.step-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border-2);
  background: var(--bg-3);
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.step-dot--active {
  border-color: var(--cyan);
  color: var(--cyan);
  background: rgba(0, 212, 255, 0.1);
}
.step-dot--done {
  border-color: var(--green);
  color: var(--green);
  background: rgba(0, 255, 65, 0.1);
}
.step-content h4 {
  font-family: var(--font-pixel);
  color: var(--cyan);
  margin-bottom: var(--space-2);
}
.output-line {
  line-height: 1.8;
}
.step-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-4);
}
.step-nav__counter {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-3);
}
.btn {
  padding: var(--space-1) var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  background: var(--bg-3);
  color: var(--text-2);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.btn:hover:not(:disabled) {
  border-color: var(--cyan);
  color: var(--cyan);
}
.btn--primary {
  border-color: var(--green);
  color: var(--green);
}
.btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
