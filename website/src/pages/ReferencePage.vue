<script setup lang="ts">
/**
 * ReferencePage — 参考速查
 * CLI 命令、Pi 工具、扩展命令、故障排查
 */
import DocsLayout from '@/layouts/DocsLayout.vue'
import CodeBlock from '@/components/terminal/CodeBlock.vue'
import { cliCommands, extensionCommands, piTools, troubleshooting } from '@/data/facts'

const cliCategories = [...new Set(cliCommands.map(c => c.category))]
</script>

<template>
  <DocsLayout>
    <div class="reference-page">
      <h1>☰ 参考速查</h1>

      <!-- CLI 命令 -->
      <section id="cli" class="ref-section">
        <h2>CLI 命令速查</h2>
        <p><code>pi-company</code> CLI 主要用于初始化、启动和运维。日常协作发生在加载了 pi-company extension 的 Pi 会话里。</p>
        <div class="root-note">
          <strong>默认姿势：</strong>
          <code>cd your-project</code> 后直接运行这些命令。只有从别的目录管理项目时，才在命令前加
          <code>--root /path/to/project</code>。
        </div>

        <div v-for="cat in cliCategories" :key="cat" class="cli-category">
          <h3>{{ cat }}</h3>
          <div class="cli-table-wrap">
            <table class="cli-table">
              <thead>
                <tr>
                  <th>命令</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cmd in cliCommands.filter(c => c.category === cat)" :key="cmd.command">
                  <td><code>{{ cmd.command }}</code></td>
                  <td>{{ cmd.description }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Pi 工具 -->
      <section id="pi-tools" class="ref-section">
        <h2>Pi 工具速查</h2>
        <p>Pi 会话中注册的工具函数。</p>

        <div class="tools-grid">
          <div v-for="tool in piTools" :key="tool.name" class="tool-card">
            <code class="tool-card__name">{{ tool.name }}</code>
            <span class="tool-card__desc">{{ tool.description }}</span>
          </div>
        </div>
      </section>

      <!-- 扩展命令 -->
      <section id="extensions" class="ref-section">
        <h2>Pi 扩展命令</h2>
        <p>在加载了 pi-company 扩展的 Pi 会话中可用的命令。</p>

        <div class="ext-list">
          <div v-for="cmd in extensionCommands" :key="cmd.command" class="ext-item">
            <code class="ext-item__cmd">{{ cmd.command }}</code>
            <span class="ext-item__desc">{{ cmd.description }}</span>
          </div>
        </div>
      </section>

      <!-- 故障排查 -->
      <section id="troubleshooting" class="ref-section">
        <h2>常见问题</h2>

        <div v-for="(item, i) in troubleshooting" :key="i" class="trouble-item">
          <div class="trouble-item__symptom">
            <span class="text-amber">⚠</span>
            <strong>{{ item.symptom }}</strong>
          </div>
          <div class="trouble-item__body">
            <p><span class="text-muted">诊断：</span>{{ item.diagnosis }}</p>
            <p><span class="text-green">解决：</span>{{ item.solution }}</p>
          </div>
        </div>
      </section>
    </div>
  </DocsLayout>
</template>

<style scoped>
.reference-page {
  padding-bottom: var(--space-16);
}
.ref-section {
  margin-top: var(--space-12);
}
.root-note {
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-size: var(--text-sm);
}
.root-note strong {
  color: var(--amber);
}
.root-note code {
  color: var(--cyan);
}

/* ── CLI Category ── */
.cli-category {
  margin-top: var(--space-6);
}
.cli-category h3 {
  font-family: var(--font-pixel);
  color: var(--cyan);
  margin-bottom: var(--space-2);
  font-size: var(--text-lg);
}
.cli-table-wrap {
  overflow-x: auto;
}
.cli-table {
  font-size: var(--text-sm);
}
.cli-table code {
  font-size: var(--text-xs);
  white-space: nowrap;
}

/* ── Tools Grid ── */
.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-2);
}
.tool-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-4);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
}
.tool-card__name {
  font-size: var(--text-xs);
  color: var(--green);
  background: none;
  border: none;
  padding: 0;
}
.tool-card__desc {
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* ── Extension Commands ── */
.ext-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ext-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
}
.ext-item__cmd {
  min-width: 220px;
  font-size: var(--text-xs);
  color: var(--green);
  background: none;
  border: none;
  padding: 0;
}
.ext-item__desc {
  font-size: var(--text-sm);
  color: var(--text-2);
}

/* ── Troubleshooting ── */
.trouble-item {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: var(--space-2);
}
.trouble-item__symptom {
  padding: var(--space-2) var(--space-4);
  background: var(--bg-3);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
.trouble-item__body {
  padding: var(--space-2) var(--space-4);
  background: var(--bg-2);
  border-top: 1px solid var(--border-1);
  font-size: var(--text-sm);
}
.trouble-item__body p {
  margin-bottom: var(--space-1);
}
</style>
