<script setup lang="ts">
/**
 * LaunchAgentsTutorial — 教程 3: 启动 Agent
 * 手动/cmux 模式切换
 */
import { ref } from 'vue'
import CodeBlock from '@/components/terminal/CodeBlock.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const mode = ref<'manual' | 'cmux'>('manual')
</script>

<template>
  <div class="tut-launch">
    <h2>3. 启动 Agent</h2>
    <p>两种模式：手动终端或 cmux 窗格管理。</p>

    <div class="mode-toggle">
      <button :class="{ active: mode === 'manual' }" @click="mode = 'manual'">手动终端</button>
      <button :class="{ active: mode === 'cmux' }" @click="mode = 'cmux'">cmux 窗格</button>
    </div>

    <div v-if="mode === 'manual'" class="fade-in">
      <CodeBlock code='eval "$(pi-company --root ./my-project launch-command lead)"' prompt="$ " />
      <CodeBlock code="pi-company --root ./my-project spawn tester --manual" prompt="$ " />
      <CodeBlock code="pi-company --root ./my-project spawn coder --name coder-ui --yes --manual" prompt="$ " />
    </div>

    <div v-if="mode === 'cmux'" class="fade-in">
      <CodeBlock code="pi-company --root ./my-project spawn tester --cmux" prompt="$ " />
      <CodeBlock code="pi-company --root ./my-project spawn coder --name coder-ui --yes --cmux" prompt="$ " />

      <TerminalPane title="cmux workspace" :show-dots="true">
        <div class="cmux-grid">
          <div class="cmux-pane"><span class="text-green">◈</span> Lead</div>
          <div class="cmux-pane"><span class="text-cyan">▶</span> Coder-UI</div>
          <div class="cmux-pane" style="grid-column: span 2"><span class="text-amber">◆</span> Tester</div>
        </div>
      </TerminalPane>
    </div>
  </div>
</template>

<style scoped>
.mode-toggle {
  display: flex;
  gap: 0;
  margin: var(--space-4) 0;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  overflow: hidden;
  width: fit-content;
}
.mode-toggle button {
  padding: var(--space-1) var(--space-6);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--bg-2);
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast);
}
.mode-toggle button:first-child { border-right: 1px solid var(--border-2); }
.mode-toggle button.active {
  color: var(--green);
  background: var(--bg-4);
}
.cmux-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.cmux-pane {
  padding: var(--space-2);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}
</style>
