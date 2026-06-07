<script setup lang="ts">
/**
 * GateBadge — PR 门控状态徽章
 * 显示单个门控条件的通过/阻塞状态
 */
defineProps<{
  label: string
  passed: boolean
}>()
</script>

<template>
  <div class="gate-badge" :class="{ 'gate-badge--passed': passed, 'gate-badge--blocked': !passed }">
    <span class="gate-badge__icon">{{ passed ? '✓' : '✗' }}</span>
    <span class="gate-badge__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.gate-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  border: 1px solid;
}
.gate-badge--passed {
  color: var(--success);
  border-color: rgba(0, 255, 65, 0.3);
  background: rgba(0, 255, 65, 0.05);
}
.gate-badge--blocked {
  color: var(--error);
  border-color: rgba(255, 51, 51, 0.3);
  background: rgba(255, 51, 51, 0.05);
}
.gate-badge__icon {
  font-weight: bold;
}
</style>
