<script setup lang="ts">
/**
 * HomePage — pi-company 首页
 * 清晰的视觉层次，充足的呼吸空间
 */
import { ref } from 'vue'
import { productSummary, roles, benchmarkSummary, benchmarkRows } from '@/data/facts'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import StatusBar from '@/components/terminal/StatusBar.vue'

interface ConceptNode {
  id: string
  label: string
  type: 'role' | 'system'
  color: string
  description: string
  commands?: string[]
}

const nodes: ConceptNode[] = [
  { id: 'human', label: 'Human', type: 'role', color: 'var(--text-1)', description: '提出需求，做出不可逆决策' },
  { id: 'lead', label: 'Lead', type: 'role', color: 'var(--green)', description: '人类代理，协调所有 agent，使用 brief 验证真相', commands: ['company_lead_brief', 'company_merge_pr'] },
  { id: 'pm', label: 'PM', type: 'role', color: 'var(--amber)', description: '保护用户价值、范围和验收标准', commands: ['company_submit_acceptance'] },
  { id: 'researcher', label: 'Researcher', type: 'role', color: 'var(--magenta)', description: '处理跨职能未知和外部研究' },
  { id: 'coder', label: 'Coder', type: 'role', color: 'var(--cyan)', description: '实现代码，在隔离工作树中并行编辑', commands: ['company_create_pr', 'company_mark_pr_ready'] },
  { id: 'reviewer', label: 'Reviewer', type: 'role', color: 'var(--cyan-soft)', description: '保护代码质量、安全性和可维护性', commands: ['company_submit_review'] },
  { id: 'tester', label: 'Tester', type: 'role', color: 'var(--amber)', description: '验证用户行为、边界情况和回归', commands: ['company_submit_test'] },
]

const systemNodes: ConceptNode[] = [
  { id: 'issues', label: 'Issues', type: 'system', color: 'var(--info)', description: '本地问题跟踪，lead 创建和分配' },
  { id: 'pr-gates', label: 'PR Gates', type: 'system', color: 'var(--warning)', description: '合并门控：自测、测试、审查、验收' },
  { id: 'mailbox', label: 'Mailbox', type: 'system', color: 'var(--magenta)', description: 'Agent 邮箱消息系统' },
]

const selectedNode = ref<ConceptNode | null>(null)

function selectNode(node: ConceptNode) {
  selectedNode.value = selectedNode.value?.id === node.id ? null : node
}

const statusAgents = [
  { name: 'lead', status: 'online' as const },
  { name: 'pm', status: 'running' as const },
  { name: 'coder-ui', status: 'online' as const },
  { name: 'tester', status: 'planned' as const },
]
</script>

<template>
  <div class="home">
    <!-- Hero — 充足的呼吸空间 -->
    <section class="hero">
      <div class="hero__container">
        <div class="hero__badge font-mono">
          <span class="hero__badge-dot"></span>
          {{ benchmarkSummary.neverBelow }}
        </div>

        <h1 class="hero__title">
          <span class="glow-green font-pixel">{{ productSummary.name }}</span>
        </h1>

        <p class="hero__subtitle">{{ productSummary.tagline }}</p>

        <p class="hero__desc">{{ productSummary.description }}</p>

        <div class="hero__workflow">
          <TerminalPane title="core-workflow" :show-dots="true">
            <code class="workflow-code">{{ productSummary.coreWorkflow }}</code>
          </TerminalPane>
        </div>

        <div class="hero__actions">
          <router-link to="/quickstart" class="btn btn--primary">
            <span class="btn__icon">▶</span>
            快速开始
          </router-link>
          <a href="#benchmark" class="btn btn--ghost">
            <span class="btn__icon">≡</span>
            看 Benchmark
          </a>
        </div>
      </div>
    </section>

    <!-- Benchmark — 最突出的证据区块 -->
    <section id="benchmark" class="section section--benchmark">
      <div class="section__container">
        <div class="section__header">
          <div class="benchmark__badge">🏆 官方 SWE-bench Verified</div>
          <h2>{{ benchmarkSummary.headline }}</h2>
          <p class="section__lead">
            同一模型（<code class="inline-code">{{ benchmarkSummary.model }}</code>）、同一 instance、同一 base commit，由官方 harness 评分。唯一差别：编排方式。
          </p>
        </div>

        <div class="benchmark__stats">
          <div class="stat">
            <span class="stat__value glow-green">{{ benchmarkSummary.record }}</span>
            <span class="stat__label">v3 vs plain</span>
          </div>
          <div class="stat">
            <span class="stat__value" style="color: var(--cyan)">{{ benchmarkSummary.resolveRate }}</span>
            <span class="stat__label">Resolve 率</span>
          </div>
        </div>

        <div class="benchmark__table-wrap">
          <TerminalPane title="swebench-results" :show-dots="true">
            <table class="benchmark-table">
              <thead>
                <tr>
                  <th>Instance</th>
                  <th class="ta-center">难度</th>
                  <th class="ta-center">plain</th>
                  <th class="ta-center">pi-company v3</th>
                  <th class="ta-center">结果</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in benchmarkRows"
                  :key="row.instance"
                  :class="{ 'row--win': row.result === 'win' }"
                >
                  <td class="font-mono">{{ row.instance }}</td>
                  <td class="ta-center muted">{{ row.difficulty }}</td>
                  <td class="ta-center">{{ row.plain }} <span class="muted">{{ row.plainTests }}</span></td>
                  <td class="ta-center">{{ row.v3 }} <span class="muted">{{ row.v3Tests }}</span></td>
                  <td class="ta-center">
                    <span :class="['result-pill', `result-pill--${row.result}`]">
                      {{ row.result === 'win' ? 'v3 胜' : row.result === 'tie-win' ? '平' : '平' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </TerminalPane>
        </div>

        <div class="benchmark__why">
          <h3>为什么能赢——不是运气，是机制</h3>
          <p>
            plain 和旧版都打 3/5，都漏了 <code class="inline-code">forms/fields.py</code>（<code class="inline-code">DecimalField</code> 在到达 validator 前就拒了 <code class="inline-code">NaN</code>）。
            <strong>v3 的合同谈判</strong>（coder 与 tester 在写代码<em>之前</em>各自提出可测的 Done 断言）明确逼出了这条隐藏路径，于是 coder 改了 plain 从没碰过的文件，对抗 evaluator 再逐条验证。
          </p>
          <p class="benchmark__why-detail">
            这正是「能跑数小时的 agent」模式的核心论点：谈判出的合同把「用户故事」桥接到「可测行为」，对抗 evaluator 强制执行它。
          </p>
        </div>
      </div>
    </section>

    <!-- 状态面板 — 独立的视觉区块 -->
    <section class="section">
      <div class="section__container">
        <div class="section__header">
          <h2>实时状态面板</h2>
          <p class="section__lead">每个 agent 都有可见的状态面板，一目了然</p>
        </div>
        <div class="section__content">
          <StatusBar
            :agents="statusAgents"
            :issue-count="5"
            :pr-count="2"
            rate-limit="none"
            root-status="clean"
          />
        </div>
      </div>
    </section>

    <!-- 系统架构 — 清晰的卡片布局 -->
    <section class="section">
      <div class="section__container">
        <div class="section__header">
          <h2>系统架构</h2>
          <p class="section__lead">点击角色了解职责和相关工具</p>
        </div>

        <div class="concept-grid">
          <!-- 角色节点 -->
          <div class="concept-group">
            <h3 class="concept-group__title">
              <span class="concept-group__icon">◇</span>
              角色
            </h3>
            <div class="concept-nodes">
              <button
                v-for="node in nodes"
                :key="node.id"
                class="concept-node"
                :class="{ 'concept-node--active': selectedNode?.id === node.id }"
                @click="selectNode(node)"
              >
                <span class="concept-node__dot" :style="{ background: node.color }"></span>
                <span class="concept-node__label">{{ node.label }}</span>
              </button>
            </div>
          </div>

          <!-- 系统节点 -->
          <div class="concept-group">
            <h3 class="concept-group__title">
              <span class="concept-group__icon">⚙</span>
              系统组件
            </h3>
            <div class="concept-nodes">
              <button
                v-for="node in systemNodes"
                :key="node.id"
                class="concept-node concept-node--system"
                :class="{ 'concept-node--active': selectedNode?.id === node.id }"
                @click="selectNode(node)"
              >
                <span class="concept-node__dot" :style="{ background: node.color }"></span>
                <span class="concept-node__label">{{ node.label }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 选中详情 -->
        <Transition name="detail">
          <div v-if="selectedNode" class="concept-detail">
            <TerminalPane :title="selectedNode.id" :show-dots="true">
              <div class="detail__header">
                <span class="detail__name" :style="{ color: selectedNode.color }">
                  {{ selectedNode.label }}
                </span>
                <span class="detail__type">{{ selectedNode.type }}</span>
              </div>
              <p class="detail__desc">{{ selectedNode.description }}</p>
              <div v-if="selectedNode.commands" class="detail__commands">
                <span class="detail__commands-label">工具：</span>
                <code v-for="cmd in selectedNode.commands" :key="cmd" class="detail__cmd">{{ cmd }}</code>
              </div>
            </TerminalPane>
          </div>
        </Transition>
      </div>
    </section>

    <!-- 核心特性 — 卡片网格 -->
    <section class="section">
      <div class="section__container">
        <div class="section__header">
          <h2>核心特性</h2>
          <p class="section__lead">pi-company 的设计原则和能力</p>
        </div>

        <div class="features">
          <div v-for="(item, i) in productSummary.scope" :key="i" class="feature">
            <div class="feature__icon">
              <span class="feature__bullet">▸</span>
            </div>
            <div class="feature__content">
              <span class="feature__text">{{ item }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 角色概览 — 详细卡片 -->
    <section class="section section--last">
      <div class="section__container">
        <div class="section__header">
          <h2>六大角色</h2>
          <p class="section__lead">每个角色有明确的职责边界</p>
        </div>

        <div class="roles">
          <div v-for="role in roles" :key="role.id" class="role">
            <div class="role__header">
              <span class="role__icon" :style="{ color: role.color }">{{ role.icon }}</span>
              <div class="role__info">
                <h3 class="role__name" :style="{ color: role.color }">{{ role.name }}</h3>
                <span class="role__type">角色</span>
              </div>
            </div>
            <p class="role__desc">{{ role.responsibility }}</p>
            <div class="role__meta">
              <span class="role__meta-item">
                <span class="role__meta-label">边界：</span>
                {{ role.boundaries.length }} 条
              </span>
              <span class="role__meta-item">
                <span class="role__meta-label">常见错误：</span>
                {{ role.commonMistakes.length }} 条
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  padding-top: var(--header-h);
}

/* ── Hero — 充足的呼吸空间 ── */
.hero {
  padding: var(--space-32) 0 var(--space-24);
  text-align: center;
  background: linear-gradient(
    180deg,
    var(--bg-1) 0%,
    var(--bg-2) 100%
  );
}

.hero__container {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 0 var(--space-6);
}

.hero__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--green);
  background: var(--green-bg);
  border: 1px solid rgba(0, 255, 65, 0.2);
  border-radius: var(--radius-full);
  padding: var(--space-2) var(--space-4);
  margin-bottom: var(--space-10);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero__badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 8px rgba(0, 255, 65, 0.6);
  animation: pulse 2s var(--ease-out) infinite;
}

.hero__title {
  font-size: clamp(3rem, 10vw, var(--text-5xl));
  margin-bottom: var(--space-8);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.hero__subtitle {
  font-size: var(--text-xl);
  color: var(--cyan);
  margin-bottom: var(--space-6);
  font-weight: 500;
  max-width: 50ch;
  margin-left: auto;
  margin-right: auto;
}

.hero__desc {
  font-size: var(--text-lg);
  color: var(--text-3);
  max-width: 50ch;
  margin: 0 auto var(--space-12);
  line-height: var(--leading-relaxed);
}

.hero__workflow {
  max-width: 600px;
  margin: 0 auto var(--space-12);
  text-align: left;
}

.workflow-code {
  background: none;
  border: none;
  padding: 0;
  color: var(--green);
  font-size: var(--text-sm);
  word-break: break-all;
  line-height: var(--leading-relaxed);
}

.hero__actions {
  display: flex;
  gap: var(--space-4);
  justify-content: center;
  flex-wrap: wrap;
}

/* ── Buttons — 清晰的交互 ── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-8);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: 600;
  border-radius: var(--radius-lg);
  text-decoration: none;
  transition: all var(--duration-fast) var(--ease-out);
  cursor: pointer;
  border: 2px solid transparent;
  min-height: 48px;
  letter-spacing: 0.01em;
}

.btn__icon {
  font-size: var(--text-lg);
}

.btn--primary {
  color: var(--bg-0);
  background: var(--green);
  border-color: var(--green);
}

.btn--primary:hover {
  background: var(--green-soft);
  border-color: var(--green-soft);
  text-decoration: none;
  color: var(--bg-0);
  box-shadow: var(--glow-green);
  transform: translateY(-1px);
}

.btn--ghost {
  color: var(--text-1);
  background: transparent;
  border-color: var(--border-3);
}

.btn--ghost:hover {
  background: var(--bg-3);
  border-color: var(--text-3);
  text-decoration: none;
  color: var(--text-1);
  transform: translateY(-1px);
}

/* ── Sections — 清晰的视觉分隔 ── */
.section {
  padding: var(--space-20) 0;
  border-top: 1px solid var(--border-1);
}

/* ── Benchmark 区块 ── */
.section--benchmark {
  background:
    radial-gradient(circle at 50% 0%, var(--green-bg) 0%, transparent 60%),
    var(--bg-1);
}

.benchmark__badge {
  display: inline-block;
  font-size: var(--text-sm);
  color: var(--amber);
  background: var(--amber-glow);
  border: 1px solid rgba(255, 170, 0, 0.25);
  border-radius: var(--radius-full);
  padding: var(--space-2) var(--space-4);
  margin-bottom: var(--space-4);
  letter-spacing: 0.04em;
}

.benchmark__stats {
  display: flex;
  gap: var(--space-12);
  justify-content: center;
  flex-wrap: wrap;
  margin: var(--space-10) 0;
}

.stat {
  text-align: center;
}

.stat__value {
  display: block;
  font-size: clamp(1.75rem, 5vw, var(--text-4xl));
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.stat__label {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-4);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-top: var(--space-2);
}

.benchmark__table-wrap {
  max-width: 820px;
  margin: 0 auto;
}

.benchmark-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.benchmark-table th {
  text-align: left;
  font-size: var(--text-xs);
  color: var(--text-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-2);
}

.benchmark-table td {
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-1);
  color: var(--text-2);
}

.benchmark-table .row--win td {
  background: var(--green-bg);
}

.ta-center { text-align: center; }
.muted { color: var(--text-4); font-size: var(--text-xs); }

.inline-code {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: var(--bg-3);
  padding: 0.1em 0.4em;
  border-radius: var(--radius-sm);
  color: var(--green);
}

.result-pill {
  display: inline-block;
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 2px var(--space-3);
  border-radius: var(--radius-full);
}

.result-pill--win {
  color: var(--bg-0);
  background: var(--green);
}

.result-pill--tie-win {
  color: var(--cyan);
  background: var(--cyan-bg);
  border: 1px solid rgba(0, 204, 255, 0.25);
}

.result-pill--tie-fail {
  color: var(--text-4);
  background: var(--bg-3);
  border: 1px solid var(--border-2);
}

.benchmark__why {
  max-width: 680px;
  margin: var(--space-12) auto 0;
  padding: var(--space-8);
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-left: 3px solid var(--green);
  border-radius: var(--radius-xl);
}

.benchmark__why h3 {
  font-size: var(--text-lg);
  margin-top: 0;
  margin-bottom: var(--space-4);
  color: var(--text-1);
}

.benchmark__why p {
  font-size: var(--text-sm);
  color: var(--text-3);
  line-height: var(--leading-relaxed);
  margin-bottom: var(--space-3);
}

.benchmark__why-detail {
  font-size: var(--text-xs) !important;
  color: var(--text-4) !important;
  font-style: italic;
}

.section--last {
  padding-bottom: var(--space-32);
}

.section__container {
  max-width: var(--page-max);
  margin: 0 auto;
  padding: 0 var(--space-8);
}

.section__header {
  margin-bottom: var(--space-12);
}

.section__header h2 {
  font-size: var(--text-3xl);
  margin-top: 0;
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: 2px solid var(--border-2);
}

.section__lead {
  font-size: var(--text-lg);
  color: var(--text-3);
  max-width: 50ch;
  line-height: var(--leading-relaxed);
}

.section__content {
  margin-top: var(--space-8);
}

/* ── Concept Grid — 清晰的分组 ── */
.concept-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--space-8);
  margin-bottom: var(--space-10);
}

.concept-group {
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
}

.concept-group__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: var(--space-5);
  font-weight: 600;
  margin-top: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.concept-group__icon {
  font-size: var(--text-base);
}

.concept-nodes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.concept-node {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.concept-node:hover {
  border-color: var(--border-4);
  background: var(--bg-4);
  color: var(--text-1);
}

.concept-node--active {
  border-color: var(--cyan);
  background: var(--cyan-bg);
  color: var(--cyan);
}

.concept-node__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.concept-node--system {
  border-style: dashed;
}

/* ── Concept Detail ── */
.concept-detail {
  margin-top: var(--space-6);
}

.detail__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.detail__name {
  font-size: var(--text-2xl);
  font-weight: 700;
}

.detail__type {
  font-size: var(--text-xs);
  color: var(--text-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: var(--bg-4);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
}

.detail__desc {
  color: var(--text-2);
  margin-bottom: var(--space-6);
  line-height: var(--leading-relaxed);
  font-size: var(--text-lg);
}

.detail__commands {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-2);
}

.detail__commands-label {
  font-size: var(--text-sm);
  color: var(--text-4);
  font-weight: 500;
}

.detail__cmd {
  font-size: var(--text-xs);
}

/* ── Features — 清晰的卡片 ── */
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--space-4);
}

.feature {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-xl);
  transition: all var(--duration-fast) var(--ease-out);
}

.feature:hover {
  border-color: var(--border-3);
  background: var(--bg-3);
}

.feature__icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--green-bg);
  border-radius: var(--radius-md);
}

.feature__bullet {
  color: var(--green);
  font-size: var(--text-lg);
}

.feature__content {
  flex: 1;
}

.feature__text {
  font-size: var(--text-sm);
  color: var(--text-2);
  line-height: var(--leading-relaxed);
}

/* ── Roles — 详细卡片 ── */
.roles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-6);
}

.role {
  padding: var(--space-8);
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-xl);
  transition: all var(--duration-fast) var(--ease-out);
}

.role:hover {
  border-color: var(--border-3);
  box-shadow: var(--shadow-md);
}

.role__header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.role__icon {
  font-size: var(--text-3xl);
  line-height: 1;
}

.role__info {
  flex: 1;
}

.role__name {
  font-size: var(--text-xl);
  font-weight: 700;
  margin: 0 0 var(--space-1);
  padding-bottom: 0;
  border-bottom: none;
}

.role__type {
  font-size: var(--text-xs);
  color: var(--text-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
}

.role__desc {
  font-size: var(--text-sm);
  color: var(--text-3);
  line-height: var(--leading-relaxed);
  margin-bottom: var(--space-5);
}

.role__meta {
  display: flex;
  gap: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-2);
}

.role__meta-item {
  font-size: var(--text-xs);
  color: var(--text-4);
}

.role__meta-label {
  font-weight: 500;
  color: var(--text-3);
}

/* ── Transitions ── */
.detail-enter-active {
  transition: all var(--duration-normal) var(--ease-out);
}

.detail-leave-active {
  transition: all var(--duration-fast) var(--ease-out);
}

.detail-enter-from,
.detail-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .hero {
    padding: var(--space-16) 0 var(--space-12);
  }

  .hero__title {
    font-size: var(--text-4xl);
  }

  .hero__subtitle {
    font-size: var(--text-lg);
  }

  .section {
    padding: var(--space-12) 0;
  }

  .section__header h2 {
    font-size: var(--text-2xl);
  }

  .concept-grid {
    grid-template-columns: 1fr;
  }

  .features,
  .roles {
    grid-template-columns: 1fr;
  }

  .role {
    padding: var(--space-6);
  }
}

@media (prefers-reduced-motion: reduce) {
  .detail-enter-active,
  .detail-leave-active {
    transition: none;
  }

  .hero__badge-dot {
    animation: none;
  }
}
</style>
