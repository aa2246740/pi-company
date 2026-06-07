<script setup lang="ts">
/**
 * StatusBar — TUI 风格底部状态栏
 * 显示 agent 状态、issue/PR 计数、速率限制状态
 */
defineProps<{
  agents?: Array<{ name: string; status: 'online' | 'running' | 'blocked' | 'planned' }>
  issueCount?: number
  prCount?: number
  rateLimit?: string
  rootStatus?: string
}>()
</script>

<template>
  <div class="status-bar">
    <div class="status-bar__agents" v-if="agents?.length">
      <span v-for="agent in agents" :key="agent.name" class="status-bar__agent">
        <span class="status-dot" :class="`status-dot--${agent.status}`"></span>
        <span class="status-bar__agent-name">{{ agent.name }}</span>
        <span class="status-bar__agent-status">{{ agent.status }}</span>
      </span>
    </div>
    <div class="status-bar__metrics">
      <span class="status-bar__item" v-if="issueCount !== undefined">
        Issues: <strong>{{ issueCount }}</strong>
      </span>
      <span class="status-bar__item" v-if="prCount !== undefined">
        PRs: <strong>{{ prCount }}</strong>
      </span>
      <span class="status-bar__item" v-if="rateLimit">
        Rate Limit: <span :class="rateLimit === 'none' ? 'text-green' : 'text-amber'">{{ rateLimit }}</span>
      </span>
      <span class="status-bar__item" v-if="rootStatus">
        Root: <span :class="rootStatus === 'clean' ? 'text-green' : 'text-amber'">{{ rootStatus }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-1) var(--space-4);
  background: var(--bg-4);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-2);
  overflow-x: auto;
  gap: var(--space-4);
}
.status-bar__agents {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.status-bar__agent {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.status-bar__agent-name {
  color: var(--text-1);
  font-weight: 500;
}
.status-bar__agent-status {
  color: var(--text-3);
}
.status-bar__metrics {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.status-bar__item {
  white-space: nowrap;
}
.status-bar__item strong {
  color: var(--text-1);
}
</style>
