<script setup lang="ts">
/**
 * TerminalPane — 终端窗格组件
 * 精致的终端风格容器
 */
defineProps<{
  title?: string
  showDots?: boolean
}>()
</script>

<template>
  <div class="terminal scanlines">
    <div class="terminal__header" v-if="title || showDots">
      <div class="terminal__dots" v-if="showDots !== false">
        <span class="terminal__dot terminal__dot--red"></span>
        <span class="terminal__dot terminal__dot--yellow"></span>
        <span class="terminal__dot terminal__dot--green"></span>
      </div>
      <span class="terminal__title" v-if="title">{{ title }}</span>
    </div>
    <div class="terminal__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.terminal {
  background: var(--bg-2);
  border: 1px solid var(--border-3);
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

.terminal__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  background: var(--bg-3);
  border-bottom: 1px solid var(--border-2);
}

.terminal__dots {
  display: flex;
  gap: 8px;
}

.terminal__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.terminal__dot--red    { background: #ff5f56; }
.terminal__dot--yellow { background: #ffbd2e; }
.terminal__dot--green  { background: #27c93f; }

.terminal__title {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-4);
  margin-left: var(--space-2);
}

.terminal__body {
  padding: var(--space-5);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  color: var(--text-2);
  overflow-x: auto;
}
</style>
