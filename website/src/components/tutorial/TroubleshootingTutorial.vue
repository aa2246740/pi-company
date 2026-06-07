<script setup lang="ts">
/**
 * TroubleshootingTutorial — 教程 14: 故障排查
 * 选择症状 → 展示诊断路径和命令
 */
import { ref } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import CodeBlock from '@/components/terminal/CodeBlock.vue'
import { troubleshooting } from '@/data/facts'

const selectedIndex = ref<number | null>(null)

function selectItem(index: number) {
  selectedIndex.value = selectedIndex.value === index ? null : index
}
</script>

<template>
  <div class="tut-trouble">
    <h2>14. 故障排查</h2>
    <p>选择你遇到的症状，查看诊断路径和解决方案。</p>

    <div class="symptom-list">
      <button
        v-for="(item, i) in troubleshooting"
        :key="i"
        class="symptom-btn"
        :class="{ 'symptom-btn--active': selectedIndex === i }"
        @click="selectItem(i)"
      >
        <span class="text-amber">⚠</span>
        <span>{{ item.symptom }}</span>
      </button>
    </div>

    <div v-if="selectedIndex !== null" class="diagnosis fade-in">
      <TerminalPane title="diagnosis" :show-dots="true">
        <div class="diag-section">
          <span class="text-cyan">症状：</span>
          <span>{{ troubleshooting[selectedIndex].symptom }}</span>
        </div>
        <div class="diag-section">
          <span class="text-amber">诊断：</span>
          <span>{{ troubleshooting[selectedIndex].diagnosis }}</span>
        </div>
        <div class="diag-section">
          <span class="text-green">解决：</span>
          <span>{{ troubleshooting[selectedIndex].solution }}</span>
        </div>
      </TerminalPane>

      <div class="diag-commands">
        <CodeBlock
          v-if="selectedIndex === 0"
          code="company_pr_gates"
          prompt=""
          language="pi tool"
        />
        <CodeBlock
          v-if="selectedIndex === 0"
          code="company_lead_brief"
          prompt=""
          language="pi tool"
        />
        <CodeBlock
          v-if="selectedIndex === 4"
          code='pi-company cmux-rate-limit-scan --workspace workspace:16'
          prompt="$ "
        />
        <CodeBlock
          v-if="selectedIndex === 5"
          code='pi-company rate-limit --actor tester --reason "429 Too many requests"'
          prompt="$ "
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.symptom-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-4) 0;
}
.symptom-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
  text-align: left;
}
.symptom-btn:hover {
  border-color: var(--border-2);
  color: var(--text-1);
}
.symptom-btn--active {
  border-color: var(--amber);
  background: rgba(255, 149, 0, 0.05);
  color: var(--text-1);
}
.diagnosis {
  margin-top: var(--space-6);
}
.diag-section {
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.diag-commands {
  margin-top: var(--space-4);
}
</style>
