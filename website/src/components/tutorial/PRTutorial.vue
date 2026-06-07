<script setup lang="ts">
/**
 * PRTutorial — 教程 9: 本地 PR 流程
 * PR 表单 + 门控状态实时更新
 */
import { ref, computed } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import GateBadge from '@/components/common/GateBadge.vue'

const prTitle = ref('feat: add component editor')
const selfTest = ref('Unit tests pass, component renders correctly')
const testBrief = ref('Validate component creation, editing, and deletion')

const hasTitle = computed(() => prTitle.value.trim().length > 0)
const hasSelfTest = computed(() => selfTest.value.trim().length > 0)
const hasTestBrief = computed(() => testBrief.value.trim().length > 0)
const isReady = computed(() => hasTitle.value && hasSelfTest.value && hasTestBrief.value)
</script>

<template>
  <div class="tut-pr">
    <h2>9. 本地 PR 流程</h2>
    <p>填写 PR 信息，观察门控状态如何变化。</p>

    <div class="pr-form">
      <div class="form-field">
        <label>PR 标题</label>
        <input v-model="prTitle" placeholder="feat: ..." />
      </div>
      <div class="form-field">
        <label>自测证据</label>
        <input v-model="selfTest" placeholder="描述你运行了什么测试..." />
      </div>
      <div class="form-field">
        <label>测试摘要</label>
        <input v-model="testBrief" placeholder="告诉 tester 验证什么..." />
      </div>
    </div>

    <div class="pr-gates">
      <GateBadge label="PR 标题" :passed="hasTitle" />
      <GateBadge label="自测证据" :passed="hasSelfTest" />
      <GateBadge label="测试摘要" :passed="hasTestBrief" />
    </div>

    <div class="pr-status" :class="isReady ? 'pr-status--ready' : 'pr-status--draft'">
      <TerminalPane :title="isReady ? 'PR READY' : 'PR DRAFT'" :show-dots="true">
        <div v-if="isReady" class="text-green">
          ✓ PR 标记为 ready<br>
          ✓ 通知 lead、reviewer、tester<br>
          → 等待审查和测试
        </div>
        <div v-else class="text-muted">
          ⊘ PR 仍为草稿<br>
          填写所有字段后标记为 ready
        </div>
      </TerminalPane>
    </div>
  </div>
</template>

<style scoped>
.pr-form {
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
  letter-spacing: 0.05em;
}
.form-field input {
  width: 100%;
  padding: var(--space-2);
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  outline: none;
  transition: border-color var(--duration-fast);
}
.form-field input:focus {
  border-color: var(--cyan);
}
.pr-gates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-4) 0;
}
.pr-status {
  margin-top: var(--space-4);
}
.pr-status--ready {
  border: 1px solid rgba(0, 255, 65, 0.3);
  border-radius: var(--radius-md);
}
.pr-status--draft {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
}
</style>
