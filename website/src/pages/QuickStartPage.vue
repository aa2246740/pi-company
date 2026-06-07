<script setup lang="ts">
/**
 * QuickStartPage — 快速开始指南
 * 从零到运行第一个 agent 公司，不超过 5 分钟
 */
import { ref } from 'vue'
import DocsLayout from '@/layouts/DocsLayout.vue'
import CodeBlock from '@/components/terminal/CodeBlock.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import StepperTimeline from '@/components/common/StepperTimeline.vue'

const launchMode = ref<'manual' | 'cmux'>('manual')

const steps = [
  { label: '安装', status: 'done' as const },
  { label: '初始化', status: 'done' as const },
  { label: '启动 Lead', status: 'active' as const },
  { label: '启动 Worker', status: 'pending' as const },
  { label: '开始工作', status: 'pending' as const },
]
</script>

<template>
  <DocsLayout>
    <div class="quickstart">
      <h1>▶ 快速开始</h1>
      <p>从零到运行第一个 agent 公司，不超过 5 分钟。</p>

      <!-- 进度时间线 -->
      <StepperTimeline :steps="steps" />

      <!-- Step 1: 安装与初始化 -->
      <section id="install" class="qs-section">
        <h2>1. 前置条件</h2>
        <p>确保你已安装：</p>
        <ul>
          <li><strong>Node.js</strong> — 安装和运行 pi-company CLI/extension</li>
          <li><strong>Pi</strong> — AI 编码助手（必需）</li>
        </ul>

        <p><code>pi-company</code> 不是 Node 服务。Node 只是运行 CLI 和 Pi extension 的环境；日常入口是在项目目录里启动带扩展的 Pi。</p>

        <CodeBlock
          code="npm install -g pi-company"
          prompt="$ "
        />

        <h2>2. 初始化公司</h2>
        <p>进入你的项目目录，然后初始化 pi-company：</p>

        <CodeBlock
          code="cd ~/Documents/cmux/tarot-draw
pi-company init --id tarot-draw"
          prompt="$ "
        />

        <p>查看初始化结果：</p>
        <CodeBlock
          code="pi-company status"
          prompt="$ "
        />

        <div class="alert alert--info">
          <span class="alert__icon">ℹ</span>
          <span>人在项目目录里时不需要 <code>--root</code>。只有从别的目录管理这个项目时才写 <code>--root ~/Documents/cmux/tarot-draw</code>。</span>
        </div>

        <!-- 磁盘变化抽屉 -->
        <details class="disk-drawer">
          <summary class="disk-drawer__trigger">📂 磁盘上发生了什么变化？</summary>
          <div class="disk-drawer__content">
            <TerminalPane title=".pi-company/" :show-dots="true">
              <pre class="text-green">.pi-company/
├── company.yaml          # 公司配置
├── events/               # 事件日志
│   └── event-001.json
├── mailbox/              # Agent 邮箱
│   ├── lead/
│   ├── coder/
│   └── ...
├── issues/               # 本地 Issues
├── prs/                  # 本地 PRs
└── provider-queue/       # Provider 请求队列</pre>
            </TerminalPane>
            <p class="text-muted">
              同时会自动创建/更新 <code>.gitignore</code> 文件，将 <code>.pi-company/</code> 排除在版本控制之外。
            </p>
          </div>
        </details>
      </section>

      <!-- Step 2: 启动 Lead -->
      <section id="launch-lead" class="qs-section">
        <h2>3. 启动 Lead</h2>
        <p>Lead 是公司的核心协调者，<strong>必须首先启动</strong>。</p>

        <div class="alert alert--info">
          <span class="alert__icon">ℹ</span>
          <span>Lead 是人类的本地代理，负责协调所有其他 agent 的工作。</span>
        </div>

        <CodeBlock
          code='eval "$(pi-company launch-command lead)"'
          prompt="$ "
        />

        <TerminalPane title="lead output" :show-dots="true">
          <div class="terminal-output">
            <span class="text-green">✓</span> Lead agent launched<br>
            <span class="text-green">✓</span> Monitoring issues, PRs, and mailbox<br>
            <span class="text-cyan">◈</span> Ready for human steering
          </div>
        </TerminalPane>
      </section>

      <!-- Step 3: 启动工作者 -->
      <section id="launch-workers" class="qs-section">
        <h2>4. 启动工作者</h2>
        <p>进入 lead Pi 后，先用自然语言告诉 lead 你要做什么。Lead 会决定需要哪些角色，并通过工具分发任务。需要新窗口时，再启动其他 agent。</p>

        <TerminalPane title="lead Pi" :show-dots="true">
          <div class="terminal-output">
            <span class="text-green">&gt;</span> 继续做塔罗抽卡网站。请检查当前状态，决定需要哪些角色，然后分发任务。
          </div>
        </TerminalPane>

        <p>也可以手动启动其他 agent。支持两种模式：</p>

        <!-- 模式切换 -->
        <div class="mode-toggle">
          <button
            class="mode-toggle__btn"
            :class="{ 'mode-toggle__btn--active': launchMode === 'manual' }"
            @click="launchMode = 'manual'"
          >
            手动终端
          </button>
          <button
            class="mode-toggle__btn"
            :class="{ 'mode-toggle__btn--active': launchMode === 'cmux' }"
            @click="launchMode = 'cmux'"
          >
            cmux 窗格
          </button>
        </div>

        <!-- 手动模式 -->
        <div v-if="launchMode === 'manual'" class="launch-mode fade-in">
          <h3>手动终端模式</h3>
          <p>在单独的终端窗口中启动每个 agent：</p>

          <CodeBlock
            code="pi-company spawn tester --manual"
            prompt="$ "
          />

          <CodeBlock
            code="pi-company spawn coder --name coder-ui --yes --manual"
            prompt="$ "
          />

          <div class="pane-diagram">
            <div class="pane-diagram__item">
              <TerminalPane title="Terminal 1 — Lead" :show-dots="true">
                <span class="text-green">$</span> pi-company launch-command lead<br>
                <span class="text-green">✓</span> Lead online
              </TerminalPane>
            </div>
            <div class="pane-diagram__item">
              <TerminalPane title="Terminal 2 — Tester" :show-dots="true">
                <span class="text-green">$</span> pi-company spawn tester --manual<br>
                <span class="text-green">✓</span> Tester online
              </TerminalPane>
            </div>
            <div class="pane-diagram__item">
              <TerminalPane title="Terminal 3 — Coder" :show-dots="true">
                <span class="text-green">$</span> pi-company spawn coder --name coder-ui --yes --manual<br>
                <span class="text-green">✓</span> Coder online (worktree: coder-ui)
              </TerminalPane>
            </div>
          </div>
        </div>

        <!-- cmux 模式 -->
        <div v-if="launchMode === 'cmux'" class="launch-mode fade-in">
          <h3>cmux 窗格模式</h3>
          <p>cmux 自动创建和管理窗格：</p>

          <CodeBlock
            code="pi-company spawn tester --cmux"
            prompt="$ "
          />

          <CodeBlock
            code="pi-company spawn coder --name coder-ui --yes --cmux"
            prompt="$ "
          />

          <div class="pane-diagram">
            <div class="pane-diagram__cmux">
              <TerminalPane title="cmux workspace" :show-dots="true">
                <div class="cmux-grid">
                  <div class="cmux-pane">
                    <span class="text-green">◈</span> Lead
                  </div>
                  <div class="cmux-pane">
                    <span class="text-cyan">▶</span> Coder-UI
                  </div>
                  <div class="cmux-pane">
                    <span class="text-amber">◆</span> Tester
                  </div>
                </div>
              </TerminalPane>
            </div>
          </div>

          <div class="alert alert--warning">
            <span class="alert__icon">⚠</span>
            <span>cmux 是可选的。没有 cmux 也可以手动创建终端窗口并粘贴启动命令。</span>
          </div>
        </div>
      </section>

      <!-- 下一步 -->
      <section class="qs-section">
        <h2>下一步</h2>
        <div class="next-steps">
          <router-link to="/concepts" class="next-step-card">
            <span class="next-step-card__icon">◇</span>
            <span class="next-step-card__title">核心概念</span>
            <span class="next-step-card__desc">了解角色、邮箱和 Lead 真相</span>
          </router-link>
          <router-link to="/workflows" class="next-step-card">
            <span class="next-step-card__icon">→</span>
            <span class="next-step-card__title">工作流</span>
            <span class="next-step-card__desc">Issues、PR 流程和合并门控</span>
          </router-link>
          <router-link to="/tutorials" class="next-step-card">
            <span class="next-step-card__icon">◈</span>
            <span class="next-step-card__title">交互教程</span>
            <span class="next-step-card__desc">通过模拟器学习每个功能</span>
          </router-link>
        </div>
      </section>
    </div>
  </DocsLayout>
</template>

<style scoped>
.quickstart {
  padding-bottom: var(--space-16);
}

.qs-section {
  margin-top: var(--space-12);
}

/* ── Disk Drawer ── */
.disk-drawer {
  margin-top: var(--space-6);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.disk-drawer__trigger {
  display: block;
  padding: var(--space-2) var(--space-4);
  background: var(--bg-3);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--cyan);
  transition: background var(--duration-fast);
}
.disk-drawer__trigger:hover {
  background: var(--bg-4);
}
.disk-drawer__content {
  padding: var(--space-4);
  background: var(--bg-2);
  border-top: 1px solid var(--border-1);
}

/* ── Mode Toggle ── */
.mode-toggle {
  display: flex;
  gap: 0;
  margin: var(--space-6) 0;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  overflow: hidden;
  width: fit-content;
}
.mode-toggle__btn {
  padding: var(--space-2) var(--space-6);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--bg-2);
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast);
}
.mode-toggle__btn:first-child {
  border-right: 1px solid var(--border-2);
}
.mode-toggle__btn--active {
  color: var(--green);
  background: var(--bg-4);
}
.mode-toggle__btn:hover:not(.mode-toggle__btn--active) {
  color: var(--text-1);
}

/* ── Pane Diagram ── */
.pane-diagram {
  margin-top: var(--space-6);
}
.pane-diagram__item {
  margin-bottom: var(--space-4);
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
.cmux-pane:last-child {
  grid-column: span 2;
}

/* ── Alerts ── */
.alert {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin: var(--space-6) 0;
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

/* ── Terminal Output ── */
.terminal-output {
  line-height: 1.8;
}

/* ── Next Steps ── */
.next-steps {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-4);
}
.next-step-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: all var(--duration-fast);
}
.next-step-card:hover {
  border-color: var(--cyan);
  text-decoration: none;
}
.next-step-card__icon {
  font-size: var(--text-xl);
  color: var(--cyan);
}
.next-step-card__title {
  font-family: var(--font-pixel);
  font-size: var(--text-lg);
  color: var(--off-white);
}
.next-step-card__desc {
  font-size: var(--text-xs);
  color: var(--text-3);
}
</style>
