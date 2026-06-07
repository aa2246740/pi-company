<script setup lang="ts">
/**
 * ConfigPage — 配置
 * 角色模型策略、速率限制、cmux 集成
 */
import DocsLayout from '@/layouts/DocsLayout.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import CodeBlock from '@/components/terminal/CodeBlock.vue'
import { rateLimitPolicy } from '@/data/facts'
</script>

<template>
  <DocsLayout>
    <div class="config-page">
      <h1>⚙ 配置</h1>

      <!-- 角色模型策略 -->
      <section id="model-policy" class="config-section">
        <h2>角色模型策略</h2>
        <p>Lead 可以为不同角色或 agent 配置不同的 AI 模型。</p>

        <CodeBlock
          code="/company-configure-models"
          prompt=""
          language="pi command"
        />

        <div class="info-block">
          <h4>配置目标</h4>
          <ul>
            <li><strong>default model</strong> — 未来和未配置角色的默认模型</li>
            <li><strong>built-in roles</strong> — lead、pm、researcher、coder、reviewer、tester</li>
            <li><strong>named agents</strong> — 已存在的具名 agent</li>
          </ul>
        </div>

        <TerminalPane title=".pi-company/company.yaml" :show-dots="true">
          <pre class="yaml-demo"><span class="text-cyan">model_policy</span>:
  <span class="text-cyan">roles</span>:
    <span class="text-cyan">coder</span>:
      <span class="text-amber">provider</span>: <span class="text-green">openai-codex</span>
      <span class="text-amber">model</span>: <span class="text-green">gpt-5.4-mini</span>
      <span class="text-amber">thinking</span>: <span class="text-green">low</span>
    <span class="text-cyan">tester</span>:
      <span class="text-amber">provider</span>: <span class="text-green">xiaomi-token-plan-cn</span>
      <span class="text-amber">model</span>: <span class="text-green">mimo-v2.5-pro</span></pre>
        </TerminalPane>

        <div class="alert alert--info">
          <span class="alert__icon">ℹ</span>
          <span>运行中的 Pi 窗格会保持当前模型，直到重启或在 Pi 内手动更改。</span>
        </div>
      </section>

      <!-- 速率限制 -->
      <section id="rate-limits" class="config-section">
        <h2>速率限制与恢复</h2>
        <p>pi-company 有内置的 provider 请求门控来减少 429 错误。</p>

        <div class="policy-grid">
          <div class="policy-card">
            <span class="policy-card__label">最大并发</span>
            <span class="policy-card__value text-green">{{ rateLimitPolicy.maxConcurrent }}</span>
            <span class="policy-card__unit">请求/provider</span>
          </div>
          <div class="policy-card">
            <span class="policy-card__label">启动间隔</span>
            <span class="policy-card__value text-cyan">{{ rateLimitPolicy.startSpacing }}</span>
            <span class="policy-card__unit">同 provider</span>
          </div>
          <div class="policy-card">
            <span class="policy-card__label">首次退避</span>
            <span class="policy-card__value text-amber">{{ rateLimitPolicy.firstBackoff }}</span>
            <span class="policy-card__unit">429 后</span>
          </div>
          <div class="policy-card">
            <span class="policy-card__label">最大退避</span>
            <span class="policy-card__value text-amber">{{ rateLimitPolicy.maxBackoff }}</span>
            <span class="policy-card__unit">上限</span>
          </div>
        </div>

        <CodeBlock
          code='pi-company --root ./my-project rate-limit --actor tester --reason "429 Too many requests"'
          prompt="$ "
        />

        <div class="info-block">
          <h4>恢复顺序</h4>
          <p>{{ rateLimitPolicy.recoveryOrder }}</p>
        </div>
      </section>

      <!-- cmux -->
      <section id="cmux" class="config-section">
        <h2>cmux 集成</h2>
        <p>cmux 是<strong>可选的</strong>窗格管理器。没有 cmux 也可以正常使用。</p>

        <div class="cmux-compare">
          <div class="cmux-mode">
            <h4>有 cmux</h4>
            <ul>
              <li>自动创建窗格</li>
              <li>可视化管理</li>
              <li>一键启动多个 agent</li>
            </ul>
          </div>
          <div class="cmux-mode">
            <h4>无 cmux</h4>
            <ul>
              <li>手动创建终端窗口</li>
              <li>粘贴启动命令</li>
              <li>完全一样可用</li>
            </ul>
          </div>
        </div>

        <div class="alert alert--warning">
          <span class="alert__icon">⚠</span>
          <span><strong>重要：</strong>重启运行中的 Pi TUI 时，不要直接发送启动命令。先停止 <code>pi</code> 进程，返回 shell，再运行启动命令。否则命令可能被粘贴为聊天文本。</span>
        </div>
      </section>
    </div>
  </DocsLayout>
</template>

<style scoped>
.config-page {
  padding-bottom: var(--space-16);
}
.config-section {
  margin-top: var(--space-12);
}

/* ── Info Block ── */
.info-block {
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin-top: var(--space-6);
}
.info-block h4 {
  font-family: var(--font-pixel);
  color: var(--cyan);
  margin-bottom: var(--space-2);
  font-size: var(--text-base);
}
.info-block ul {
  padding-left: var(--space-6);
}

/* ── YAML Demo ── */
.yaml-demo {
  font-size: var(--text-sm);
  line-height: 1.7;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
}

/* ── Policy Grid ── */
.policy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-4);
  margin: var(--space-6) 0;
}
.policy-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-4);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
}
.policy-card__label {
  font-size: var(--text-xs);
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.policy-card__value {
  font-family: var(--font-pixel);
  font-size: var(--text-2xl);
}
.policy-card__unit {
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* ── cmux Compare ── */
.cmux-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-top: var(--space-6);
}
.cmux-mode {
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
.cmux-mode h4 {
  font-family: var(--font-pixel);
  color: var(--cyan);
  margin-bottom: var(--space-2);
}
.cmux-mode ul {
  padding-left: var(--space-6);
}

/* ── Alert ── */
.alert {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin-top: var(--space-6);
  border: 1px solid;
}
.alert--info {
  color: var(--cyan);
  background: rgba(0, 212, 255, 0.05);
  border-color: rgba(0, 212, 255, 0.2);
}
.alert--warning {
  color: var(--amber);
  background: rgba(255, 149, 0, 0.05);
  border-color: rgba(255, 149, 0, 0.2);
}
.alert__icon {
  flex-shrink: 0;
}
</style>
