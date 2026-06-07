<script setup lang="ts">
/**
 * ConceptsPage — 核心概念
 * 角色与职责、本地状态、邮箱与唤醒、Lead 真相
 */
import { ref } from 'vue'
import DocsLayout from '@/layouts/DocsLayout.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import GateBadge from '@/components/common/GateBadge.vue'
import { roles, wakePolicy } from '@/data/facts'

const expandedRole = ref<string | null>(null)

function toggleRole(id: string) {
  expandedRole.value = expandedRole.value === id ? null : id
}

/** Lead 真相演示状态 */
const workerSaysDone = ref(true)
const briefSaysBlocked = ref(true)
</script>

<template>
  <DocsLayout>
    <div class="concepts-page">
      <h1>◇ 核心概念</h1>
      <p>理解 pi-company 的基础架构和运行原理。</p>

      <!-- 角色与职责 -->
      <section id="roles" class="concept-section">
        <h2>角色与职责</h2>
        <p>pi-company 有 6 个核心角色，每个角色有明确的职责边界。</p>

        <div class="roles-list">
          <div
            v-for="role in roles"
            :key="role.id"
            class="role-item"
            :class="{ 'role-item--expanded': expandedRole === role.id }"
          >
            <button class="role-item__header" @click="toggleRole(role.id)">
              <span class="role-item__icon" :style="{ color: role.color }">{{ role.icon }}</span>
              <span class="role-item__name" :style="{ color: role.color }">{{ role.name }}</span>
              <span class="role-item__summary">{{ role.responsibility.slice(0, 60) }}...</span>
              <span class="role-item__toggle">{{ expandedRole === role.id ? '▾' : '▸' }}</span>
            </button>

            <div v-if="expandedRole === role.id" class="role-item__body fade-in">
              <div class="role-item__section">
                <h4>职责</h4>
                <p>{{ role.responsibility }}</p>
              </div>

              <div class="role-item__section">
                <h4>边界</h4>
                <ul>
                  <li v-for="(b, i) in role.boundaries" :key="i">{{ b }}</li>
                </ul>
              </div>

              <div class="role-item__section">
                <h4>常见错误</h4>
                <ul>
                  <li v-for="(m, i) in role.commonMistakes" :key="i" class="text-amber">⚠ {{ m }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 本地状态与事件 -->
      <section id="state" class="concept-section">
        <h2>本地状态与事件</h2>
        <p>pi-company 的所有状态存储在项目本地的 <code>.pi-company/</code> 目录中。</p>

        <TerminalPane title=".pi-company/" :show-dots="true">
          <pre class="dir-tree">.pi-company/
├── company.yaml          # 公司配置和模型策略
├── events/               # 事件日志（append-only）
│   ├── event-001-init.json
│   ├── event-002-agent-created.json
│   └── ...
├── mailbox/              # 每个 agent 的邮箱
│   ├── lead/
│   │   └── msg-001.json
│   └── coder-ui/
│       └── msg-002.json
├── issues/               # 本地 issue 记录
├── prs/                  # 本地 PR 记录
└── provider-queue/       # Provider 请求队列</pre>
        </TerminalPane>

        <div class="info-block">
          <h4>事件日志 + Reducer 模式</h4>
          <p>所有变更以 append-only 事件记录。状态可通过 <code>pi-company reduce</code> 命令从事件重建。这意味着你可以：</p>
          <ul>
            <li>审计完整的历史变更</li>
            <li>在状态损坏时重建</li>
            <li>理解每个决策的因果链</li>
          </ul>
        </div>
      </section>

      <!-- 邮箱与唤醒 -->
      <section id="mailbox" class="concept-section">
        <h2>邮箱与唤醒</h2>
        <p>Agent 之间通过邮箱消息通信。消息的唤醒策略决定了是否立即唤醒目标 agent。</p>

        <div class="policy-table">
          <table>
            <thead>
              <tr>
                <th>消息类型</th>
                <th>唤醒策略</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>human steering</code></td>
                <td class="text-green">始终唤醒 lead</td>
              </tr>
              <tr>
                <td><code>assignment</code></td>
                <td class="text-green">可立即唤醒</td>
              </tr>
              <tr>
                <td><code>review request</code></td>
                <td class="text-green">可立即唤醒</td>
              </tr>
              <tr>
                <td><code>test request</code></td>
                <td class="text-green">可立即唤醒</td>
              </tr>
              <tr>
                <td><code>system</code></td>
                <td class="text-green">可立即唤醒</td>
              </tr>
              <tr>
                <td><code>report / reply / question</code></td>
                <td class="text-muted">默认 digest（批量处理）</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="info-block">
          <h4>冷却机制</h4>
          <ul>
            <li>同一 agent 唤醒间隔：<code>{{ wakePolicy.cooldown }}</code></li>
            <li>每 agent 每分钟：<code>{{ wakePolicy.perAgentLimit }}</code></li>
            <li>全公司每分钟：<code>{{ wakePolicy.perCompanyLimit }}</code></li>
          </ul>
        </div>
      </section>

      <!-- Lead 真相 -->
      <section id="truth" class="concept-section">
        <h2>Lead 真相</h2>
        <p>这是 pi-company 最重要的概念之一：</p>

        <blockquote class="truth-quote">
          <span class="text-amber">Worker 说 "done" ≠ 真的完成。</span><br>
          <span class="text-green">company_lead_brief = 唯一的全局真相来源。</span>
        </blockquote>

        <p>Lead 必须使用 <code>company_lead_brief</code> 来验证项目状态，而不是信任 worker 的散文报告。</p>

        <!-- 交互演示 -->
        <div class="truth-demo">
          <h3>⚡ 模拟演示：Worker 说完成了</h3>

          <div class="truth-demo__scenario">
            <!-- Worker 声明 -->
            <TerminalPane title="coder-ui → lead (report)" :show-dots="true">
              <div class="message-card">
                <div class="message-card__meta">
                  <span>From: <span class="text-cyan">coder-ui</span></span>
                  <span>Type: report</span>
                </div>
                <div class="message-card__body">
                  <p>代码已实现，PR 已创建并标记 ready。所有测试通过。可以合并了。✅</p>
                </div>
              </div>
            </TerminalPane>

            <!-- Brief 真相 -->
            <TerminalPane title="company_lead_brief" :show-dots="true">
              <div class="brief-output">
                <div class="brief-line">
                  <span class="text-amber">⚠</span> can_claim_complete: <span class="text-red">false</span>
                </div>
                <div class="brief-line">
                  <span class="text-amber">⚠</span> incomplete_issues: <span class="text-amber">ISSUE-001</span>
                </div>
                <div class="brief-line">
                  <span class="text-amber">⚠</span> non_merged_prs: <span class="text-amber">PR #1</span>
                </div>
                <div class="brief-line">
                  <span class="text-amber">⚠</span> blockers:
                </div>
                <div class="brief-line brief-line--indent">
                  <span class="text-red">✗</span> Missing tester validation
                </div>
                <div class="brief-line brief-line--indent">
                  <span class="text-red">✗</span> Missing product acceptance
                </div>
                <div class="brief-line brief-line--indent">
                  <span class="text-green">✓</span> Self-test evidence exists
                </div>
                <div class="brief-line brief-line--indent">
                  <span class="text-green">✓</span> Reviewer approved
                </div>
                <div class="brief-line">
                  <span class="text-cyan">→</span> next_action: Send to tester for validation
                </div>
              </div>
            </TerminalPane>
          </div>

          <div class="truth-demo__lesson">
            <GateBadge label="Self-Test" :passed="true" />
            <GateBadge label="Reviewer" :passed="true" />
            <GateBadge label="Tester" :passed="false" />
            <GateBadge label="Acceptance" :passed="false" />
            <GateBadge label="Clean Root" :passed="true" />
          </div>

          <div class="alert alert--warning">
            <span class="alert__icon">⚠</span>
            <span>Lead <strong>不能</strong>仅凭 worker 的报告就声称工作完成。必须检查 <code>company_lead_brief</code> 中的门控状态。</span>
          </div>
        </div>
      </section>
    </div>
  </DocsLayout>
</template>

<style scoped>
.concepts-page {
  padding-bottom: var(--space-16);
}
.concept-section {
  margin-top: var(--space-12);
}

/* ── Roles List ── */
.roles-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.role-item {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color var(--duration-fast);
}
.role-item--expanded {
  border-color: var(--border-2);
}
.role-item__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-4);
  background: var(--bg-3);
  border: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-1);
  text-align: left;
  transition: background var(--duration-fast);
}
.role-item__header:hover {
  background: var(--bg-4);
}
.role-item__icon {
  font-size: var(--text-lg);
  flex-shrink: 0;
}
.role-item__name {
  font-weight: 600;
  flex-shrink: 0;
  min-width: 90px;
}
.role-item__summary {
  color: var(--text-3);
  font-size: var(--text-xs);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-item__toggle {
  color: var(--text-3);
  flex-shrink: 0;
}
.role-item__body {
  padding: var(--space-4);
  background: var(--bg-2);
  border-top: 1px solid var(--border-1);
}
.role-item__section {
  margin-bottom: var(--space-4);
}
.role-item__section h4 {
  font-family: var(--font-pixel);
  color: var(--cyan);
  margin-bottom: var(--space-1);
  font-size: var(--text-base);
}
.role-item__section ul {
  padding-left: var(--space-6);
}
.role-item__section li {
  margin-bottom: var(--space-1);
  color: var(--text-2);
}

/* ── Dir Tree ── */
.dir-tree {
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--text-1);
  background: none;
  border: none;
  padding: 0;
  margin: 0;
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

/* ── Policy Table ── */
.policy-table {
  overflow-x: auto;
}

/* ── Truth Quote ── */
.truth-quote {
  background: var(--bg-3);
  border-left: 3px solid var(--green);
  padding: var(--space-4);
  margin: var(--space-6) 0;
  font-family: var(--font-pixel);
  font-size: var(--text-lg);
  line-height: 1.8;
}

/* ── Truth Demo ── */
.truth-demo {
  margin-top: var(--space-6);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.truth-demo h3 {
  padding: var(--space-2) var(--space-4);
  background: var(--bg-5);
  border-bottom: 1px solid var(--border-1);
  font-size: var(--text-base);
  color: var(--amber);
}
.truth-demo__scenario {
  padding: var(--space-4);
}

/* ── Message Card ── */
.message-card__meta {
  display: flex;
  gap: var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-3);
  margin-bottom: var(--space-2);
}
.message-card__body {
  color: var(--text-2);
}

/* ── Brief Output ── */
.brief-output {
  font-size: var(--text-sm);
  line-height: 1.8;
}
.brief-line {
  padding: 2px 0;
}
.brief-line--indent {
  padding-left: var(--space-6);
}

/* ── Truth Demo Lesson ── */
.truth-demo__lesson {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-4);
  border-top: 1px solid var(--border-1);
  background: var(--bg-2);
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
.alert--warning {
  color: var(--amber);
  background: rgba(255, 149, 0, 0.05);
  border-color: rgba(255, 149, 0, 0.2);
}
.alert__icon {
  flex-shrink: 0;
}

.text-red { color: var(--error); }

@media (max-width: 768px) {
  .role-item__summary {
    display: none;
  }
}
</style>
