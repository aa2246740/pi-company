<script setup lang="ts">
/**
 * ReviewTestTutorial — 教程 10: 审查、测试与验收
 * 切换 review/test/acceptance 决定 + caveats 阻塞演示
 */
import { ref, computed } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import GateBadge from '@/components/common/GateBadge.vue'

const reviewDecision = ref<'approve' | 'request_changes' | 'comment' | null>(null)
const testDecision = ref<'pass' | 'fail' | 'blocked' | null>(null)
const acceptanceDecision = ref<'accept' | 'request_changes' | 'comment' | null>(null)
const hasCaveats = ref(false)

const allGreen = computed(() =>
  reviewDecision.value === 'approve' &&
  testDecision.value === 'pass' &&
  acceptanceDecision.value === 'accept' &&
  !hasCaveats.value
)

function resetAll() {
  reviewDecision.value = null
  testDecision.value = null
  acceptanceDecision.value = null
  hasCaveats.value = false
}
</script>

<template>
  <div class="tut-review">
    <h2>10. 审查、测试与验收</h2>
    <p>三个独立的质量关卡。切换决策观察门控状态变化。</p>

    <div class="decision-grid">
      <!-- Reviewer -->
      <div class="decision-card">
        <div class="decision-header">
          <span class="text-cyan">✦ Reviewer</span>
        </div>
        <div class="decision-options">
          <button :class="{ active: reviewDecision === 'approve' }" @click="reviewDecision = 'approve'">✓ Approve</button>
          <button :class="{ active: reviewDecision === 'request_changes' }" @click="reviewDecision = 'request_changes'">✗ Request Changes</button>
          <button :class="{ active: reviewDecision === 'comment' }" @click="reviewDecision = 'comment'">💬 Comment</button>
        </div>
      </div>

      <!-- Tester -->
      <div class="decision-card">
        <div class="decision-header">
          <span class="text-amber">◆ Tester</span>
        </div>
        <div class="decision-options">
          <button :class="{ active: testDecision === 'pass' }" @click="testDecision = 'pass'">✓ Pass</button>
          <button :class="{ active: testDecision === 'fail' }" @click="testDecision = 'fail'">✗ Fail</button>
          <button :class="{ active: testDecision === 'blocked' }" @click="testDecision = 'blocked'">⊘ Blocked</button>
        </div>
      </div>

      <!-- Acceptance -->
      <div class="decision-card">
        <div class="decision-header">
          <span class="text-green">◇ PM/Lead</span>
        </div>
        <div class="decision-options">
          <button :class="{ active: acceptanceDecision === 'accept' }" @click="acceptanceDecision = 'accept'">✓ Accept</button>
          <button :class="{ active: acceptanceDecision === 'request_changes' }" @click="acceptanceDecision = 'request_changes'">✗ Request Changes</button>
          <button :class="{ active: acceptanceDecision === 'comment' }" @click="acceptanceDecision = 'comment'">💬 Comment</button>
        </div>
      </div>
    </div>

    <div class="caveats-toggle">
      <label>
        <input type="checkbox" v-model="hasCaveats" />
        <span class="text-amber"> 摘要包含 caveats / 已知问题</span>
      </label>
    </div>

    <div class="gate-status">
      <TerminalPane :title="allGreen ? 'ALL GATES PASS' : 'GATES STATUS'" :show-dots="true">
        <div class="gate-badges">
          <GateBadge label="Reviewer" :passed="reviewDecision === 'approve'" />
          <GateBadge label="Tester" :passed="testDecision === 'pass'" />
          <GateBadge label="Acceptance" :passed="acceptanceDecision === 'accept'" />
          <GateBadge label="No Caveats" :passed="!hasCaveats" />
        </div>
        <div class="gate-result">
          <span v-if="allGreen" class="text-green">✓ 可以合并</span>
          <span v-else class="text-red">✗ 阻塞中</span>
        </div>
      </TerminalPane>
    </div>

    <button class="reset-btn" @click="resetAll">重置所有决策</button>
  </div>
</template>

<style scoped>
.decision-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
  margin: var(--space-4) 0;
}
.decision-card {
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
.decision-header {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  margin-bottom: var(--space-2);
}
.decision-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.decision-options button {
  padding: var(--space-1) var(--space-2);
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--duration-fast);
  text-align: left;
}
.decision-options button:hover {
  border-color: var(--border-2);
  color: var(--text-1);
}
.decision-options button.active {
  border-color: var(--cyan);
  color: var(--cyan);
  background: rgba(0, 212, 255, 0.05);
}
.caveats-toggle {
  margin: var(--space-4) 0;
}
.caveats-toggle label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
}
.gate-status {
  margin-top: var(--space-4);
}
.gate-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.gate-result {
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-1);
}
.reset-btn {
  margin-top: var(--space-4);
  padding: var(--space-1) var(--space-4);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
}
.reset-btn:hover {
  border-color: var(--border-2);
  color: var(--text-2);
}
</style>
