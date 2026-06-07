<script setup lang="ts">
/**
 * CoderWorktreesTutorial — 教程 8: Coder 工作树
 * 工作树图 + 双 coder 模拟 + 未提交更改后果
 */
import { ref } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const coders = ref([
  { name: 'coder-ui', branch: 'pi-company/coder-ui', commits: 3, dirty: false },
  { name: 'coder-api', branch: 'pi-company/coder-api', commits: 2, dirty: false },
])

function toggleDirty(name: string) {
  const coder = coders.value.find(c => c.name === name)
  if (coder) coder.dirty = !coder.dirty
}
</script>

<template>
  <div class="tut-worktrees">
    <h2>8. Coder 工作树</h2>
    <p>每个 coder 获得隔离的 git 工作树。点击切换"脏"状态观察后果。</p>

    <div class="worktree-diagram">
      <div class="wt-main">
        <span class="wt-label text-green">main</span>
        <div class="wt-commits">
          <span class="wt-commit">●</span>
          <span class="wt-commit">●</span>
          <span class="wt-commit">●</span>
          <span class="wt-commit">●</span>
        </div>
      </div>

      <div v-for="coder in coders" :key="coder.name" class="wt-branch" :class="{ 'wt-branch--dirty': coder.dirty }">
        <div class="wt-branch-header">
          <span class="wt-label" :class="coder.dirty ? 'text-amber' : 'text-cyan'">{{ coder.branch }}</span>
          <button class="dirty-toggle" @click="toggleDirty(coder.name)">
            {{ coder.dirty ? '🔴 脏' : '🟢 干净' }}
          </button>
        </div>
        <div class="wt-commits">
          <span class="wt-commit" :class="coder.dirty ? 'text-amber' : 'text-cyan'" v-for="i in coder.commits" :key="i">●</span>
          <span v-if="coder.dirty" class="wt-uncommitted">◐</span>
        </div>
      </div>
    </div>

    <div v-if="coders.some(c => c.dirty)" class="dirty-warning fade-in">
      <TerminalPane title="warning" :show-dots="true">
        <div class="text-amber">
          ⚠ 脏工作树会阻塞 PR 证据！<br>
          <span class="text-muted">Coder 必须在工作树中 commit 所有更改才能创建有效的 PR。</span>
        </div>
      </TerminalPane>
    </div>

    <div class="worktree-info">
      <TerminalPane title="spawn command" :show-dots="true">
        <div class="text-muted">$</div>
        <div>pi-company spawn coder --name coder-ui --yes --cmux</div>
        <div class="text-muted mt-sm">$</div>
        <div>pi-company spawn coder --name coder-api --yes --cmux</div>
      </TerminalPane>
    </div>
  </div>
</template>

<style scoped>
.worktree-diagram {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: var(--space-4) 0;
  padding: var(--space-4);
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
}
.wt-main,
.wt-branch {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.wt-branch-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.wt-label {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 600;
  min-width: 180px;
}
.wt-commits {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.wt-commit {
  font-size: var(--text-lg);
  color: var(--green);
}
.wt-uncommitted {
  font-size: var(--text-lg);
  color: var(--amber);
  animation: blink 1s step-end infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.dirty-toggle {
  padding: var(--space-1) var(--space-2);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.dirty-toggle:hover {
  border-color: var(--border-2);
}
.dirty-warning {
  margin-top: var(--space-4);
}
.worktree-info {
  margin-top: var(--space-6);
}
.mt-sm { margin-top: var(--space-2); }
</style>
