<script setup lang="ts">
/**
 * MergeGateTutorial — 教程 12: 合并门控
 * 门控清单模拟器
 */
import { ref, computed } from 'vue'
import GateBadge from '@/components/common/GateBadge.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const gates = ref([
  { id: 'self-test',   label: 'Self-Test',          passed: true },
  { id: 'auto-tests',  label: 'Auto Tests',         passed: true },
  { id: 'reviewer',    label: 'Reviewer',           passed: true },
  { id: 'tester',      label: 'Tester',             passed: false },
  { id: 'acceptance',  label: 'Acceptance',         passed: false },
  { id: 'root-clean',  label: 'Root Clean',         passed: true },
  { id: 'no-caveats',  label: 'No Caveats',         passed: true },
  { id: 'merge-clean', label: 'Merge Clean',        passed: true },
])

function toggle(id: string) {
  const gate = gates.value.find(g => g.id === id)
  if (gate) gate.passed = !gate.passed
}

const allPassed = computed(() => gates.value.every(g => g.passed))
const blockerCount = computed(() => gates.value.filter(g => !g.passed).length)
</script>

<template>
  <div class="tut-gates">
    <h2>12. 合并门控</h2>
    <p>点击门控条件切换状态，观察合并是否可行。</p>

    <div class="gate-panel">
      <div class="gate-status" :class="allPassed ? 'gate-status--pass' : 'gate-status--blocked'">
        <TerminalPane :title="allPassed ? 'MERGE READY' : 'MERGE BLOCKED'" :show-dots="true">
          <div v-if="allPassed" class="text-green">
            ✓ ALL GATES PASS<br>
            → Lead 可以执行合并
          </div>
          <div v-else>
            <span class="text-red">✗ BLOCKED</span> — {{ blockerCount }} gate(s) failing<br>
            <span class="text-muted">修复所有阻塞项后才能合并</span>
          </div>
        </TerminalPane>
      </div>

      <div class="gate-list">
        <button
          v-for="gate in gates"
          :key="gate.id"
          class="gate-btn"
          @click="toggle(gate.id)"
        >
          <GateBadge :label="gate.label" :passed="gate.passed" />
        </button>
      </div>

      <button
        class="merge-btn"
        :class="allPassed ? 'merge-btn--ready' : 'merge-btn--blocked'"
        :disabled="!allPassed"
      >
        {{ allPassed ? '▶ 执行合并 (company_merge_pr)' : '⊘ 无法合并' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.gate-panel {
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-top: var(--space-4);
}
.gate-status--pass {
  background: rgba(0, 255, 65, 0.03);
}
.gate-status--blocked {
  background: rgba(255, 51, 51, 0.03);
}
.gate-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-4);
}
.gate-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: transform var(--duration-fast);
}
.gate-btn:hover { transform: scale(1.05); }
.merge-btn {
  display: block;
  width: 100%;
  padding: var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-base);
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast);
}
.merge-btn--ready {
  background: rgba(0, 255, 65, 0.1);
  color: var(--green);
  border-top: 1px solid rgba(0, 255, 65, 0.3);
}
.merge-btn--ready:hover { background: rgba(0, 255, 65, 0.15); }
.merge-btn--blocked {
  background: var(--bg-4);
  color: var(--text-3);
  border-top: 1px solid var(--border-1);
  cursor: not-allowed;
}
</style>
