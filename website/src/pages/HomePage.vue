<script setup lang="ts">
import { computed, ref } from 'vue'
import { productSummary, roles } from '@/data/facts'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import StatusBar from '@/components/terminal/StatusBar.vue'

const selectedRoleId = ref('lead')
const selectedRole = computed(() => roles.find(role => role.id === selectedRoleId.value) ?? roles[0])

const statusAgents = [
  { name: 'lead', status: 'online' as const },
  { name: 'pm', status: 'running' as const },
  { name: 'coder-ui', status: 'online' as const },
  { name: 'tester', status: 'planned' as const },
]

const beforeAfter = [
  {
    before: '多个 Pi 窗口各自理解上下文。',
    after: 'Lead 用本地 brief 保持一个交付真相。',
  },
  {
    before: 'Agent 说 done，但你不知道证据在哪里。',
    after: 'PR gate 记录自测、review、tester 和产品验收。',
  },
  {
    before: '并行改代码容易互相覆盖。',
    after: 'Coder 在隔离 git worktree 里工作，再走本地 PR。',
  },
]

const operatingLoop = [
  '人类把目标交给 lead',
  'Lead 创建本地 issue 并分配角色',
  'Coder 在独立 worktree 里实现',
  'Reviewer 和 tester 分别提交证据',
  'PM 或 lead 做产品验收',
  'Gates 全绿后 lead 合并',
]

const trustRails = [
  {
    title: '本地优先',
    body: '状态写在项目的 .pi-company 目录里：事件日志、mailbox、issues、PRs 和 runtime 快照。',
  },
  {
    title: '人类在环',
    body: '你对任意 Pi session 的 steering 会镜像给 lead。你仍然能接管任何可见窗口。',
  },
  {
    title: '默认防乱',
    body: '请求按 provider 限流错峰；worker 消失时写恢复快照；合并前检查 root worktree。',
  },
]
</script>

<template>
  <div class="home">
    <section class="hero">
      <div class="hero__grid">
        <div class="hero__copy">
          <p class="hero__kicker">Pi 原生协作层</p>
          <h1>{{ productSummary.tagline }}</h1>
          <p class="hero__lead">{{ productSummary.description }}</p>

          <div class="hero__actions">
            <router-link to="/quickstart" class="btn btn--primary">快速开始</router-link>
            <a class="btn btn--ghost" href="https://github.com/aa2246740/pi-company" target="_blank" rel="noreferrer">查看 GitHub</a>
          </div>
        </div>

        <TerminalPane title="lead-brief" :show-dots="true" class="hero__terminal">
          <pre class="brief-snapshot"><code>pi-company tarot-draw | lead
focus: ship the current feature
inbox: human steering mirrored
issue: ISSUE-024 done
pr: PR-026 merged
gates: review pass | test pass | acceptance pass
next: no incomplete work</code></pre>
        </TerminalPane>
      </div>
    </section>

    <section class="section section--tight">
      <div class="section__container">
        <div class="value-strip">
          <article v-for="item in productSummary.valueProps" :key="item.title" class="value-card">
            <h2>{{ item.title }}</h2>
            <p>{{ item.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section__container two-column">
        <div class="section__intro">
          <p class="section__kicker">为什么存在</p>
          <h2>多开 Pi 很快，但项目会失去共享真相。</h2>
          <p>pi-company 不是再造一个聊天机器人。它给可见 Pi agents 加上本地协作纪律：谁负责、做到哪一步、证据在哪里、什么时候能合并。</p>
        </div>

        <div class="comparison">
          <div v-for="item in beforeAfter" :key="item.before" class="comparison__row">
            <p class="comparison__before">{{ item.before }}</p>
            <p class="comparison__after">{{ item.after }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section section--panel">
      <div class="section__container">
        <div class="section__intro section__intro--center">
          <p class="section__kicker">工作方式</p>
          <h2>从一句需求，到一条可审计的本地 PR。</h2>
          <p>{{ productSummary.coreWorkflow }}</p>
        </div>

        <ol class="loop">
          <li v-for="(step, index) in operatingLoop" :key="step">
            <span class="loop__index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span>{{ step }}</span>
          </li>
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="section__container two-column two-column--reverse">
        <div class="terminal-stack">
          <StatusBar
            :agents="statusAgents"
            :issue-count="5"
            :pr-count="2"
            rate-limit="none"
            root-status="clean"
          />
          <TerminalPane title="human-steering" :show-dots="true">
            <pre class="brief-snapshot"><code>human -> coder-ui:
Keep the UI minimal and use $impeccable.

pi-company mirrors this to lead:
lead updates issue scope
lead routes design requirement to the owner</code></pre>
          </TerminalPane>
        </div>

        <div class="section__intro">
          <p class="section__kicker">可见接管</p>
          <h2>不是把 agent 藏进后台，而是让每个窗口都能被你 steering。</h2>
          <p>你可以直接对 worker 说话，也可以让 lead 分发。pi-company 会把人类 steering 镜像给 lead，让局部修正进入全局协调。</p>
        </div>
      </div>
    </section>

    <section class="section section--panel">
      <div class="section__container two-column">
        <div class="section__intro">
          <p class="section__kicker">可信边界</p>
          <h2>角色不是人设，是上下文隔离。</h2>
          <p>分角色的目的不是模拟公司层级，而是控制上下文污染：实现、测试、产品验收和最终合并各自留下证据。</p>
        </div>

        <div class="role-lab">
          <div class="role-tabs" role="tablist" aria-label="角色">
            <button
              v-for="role in roles"
              :key="role.id"
              class="role-tab"
              :class="{ 'role-tab--active': selectedRoleId === role.id }"
              type="button"
              @click="selectedRoleId = role.id"
            >
              <span :style="{ color: role.color }">{{ role.icon }}</span>
              {{ role.name }}
            </button>
          </div>

          <TerminalPane :title="selectedRole.id" :show-dots="true">
            <div class="role-detail">
              <h3 :style="{ color: selectedRole.color }">{{ selectedRole.name }}</h3>
              <p>{{ selectedRole.responsibility }}</p>
              <div class="role-detail__grid">
                <div>
                  <strong>边界</strong>
                  <ul>
                    <li v-for="item in selectedRole.boundaries" :key="item">{{ item }}</li>
                  </ul>
                </div>
                <div>
                  <strong>常见错误</strong>
                  <ul>
                    <li v-for="item in selectedRole.commonMistakes" :key="item">{{ item }}</li>
                  </ul>
                </div>
              </div>
            </div>
          </TerminalPane>
        </div>
      </div>
    </section>

    <section class="section final-cta">
      <div class="section__container">
        <div class="final-cta__grid">
          <div>
            <p class="section__kicker">本地安全感</p>
            <h2>装上之后，普通 Pi 还是普通 Pi。</h2>
            <p>只有项目里存在 .pi-company 状态时，pi-company 才会接入。没有 company 的目录不会被接管，不会创建状态，也不会注册 company tools。</p>
          </div>

          <div class="trust-list">
            <article v-for="item in trustRails" :key="item.title" class="trust-item">
              <h3>{{ item.title }}</h3>
              <p>{{ item.body }}</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero {
  padding: clamp(72px, 12vw, 136px) 0 clamp(48px, 8vw, 96px);
  border-bottom: 1px solid var(--border-2);
  background:
    radial-gradient(circle at 20% 20%, rgba(0, 204, 255, 0.08), transparent 28%),
    radial-gradient(circle at 82% 18%, rgba(255, 170, 0, 0.08), transparent 24%),
    var(--bg-1);
}

.hero__grid,
.section__container {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
}

.hero__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(360px, 0.92fr);
  gap: clamp(32px, 6vw, 72px);
  align-items: center;
}

.hero__copy {
  min-width: 0;
}

.hero__kicker,
.section__kicker {
  max-width: none;
  margin: 0 0 var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--cyan);
}

.hero h1 {
  max-width: 12ch;
  margin: 0 0 var(--space-6);
  font-size: clamp(3rem, 7vw, 5.75rem);
  line-height: 0.95;
  letter-spacing: -0.035em;
}

.hero__lead {
  max-width: 62ch;
  margin-bottom: var(--space-8);
  font-size: clamp(1rem, 1.7vw, 1.25rem);
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.btn {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-6);
  border: 1px solid var(--border-3);
  border-radius: var(--radius-md);
  font-weight: 700;
  text-decoration: none;
  transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.btn:hover {
  transform: translateY(-1px);
  text-decoration: none;
}

.btn--primary {
  border-color: var(--green);
  background: var(--green);
  color: var(--bg-0);
}

.btn--primary:hover {
  border-color: var(--green-soft);
  background: var(--green-soft);
  color: var(--bg-0);
}

.btn--ghost {
  color: var(--text-1);
  background: var(--bg-2);
}

.btn--ghost:hover {
  border-color: var(--cyan);
  color: var(--cyan);
}

.hero__terminal {
  min-width: 0;
}

.brief-snapshot {
  max-width: 100%;
  margin: 0;
  padding: 0;
  overflow-x: auto;
  border: 0;
  background: transparent;
}

.brief-snapshot code {
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-2);
  white-space: pre;
}

.section {
  padding: clamp(64px, 9vw, 112px) 0;
  border-bottom: 1px solid var(--border-1);
}

.section--tight {
  padding: var(--space-10) 0;
}

.section--panel {
  background: var(--bg-2);
}

.section__intro h2,
.final-cta h2 {
  max-width: 12ch;
  margin-top: 0;
  margin-bottom: var(--space-5);
  padding: 0;
  border: 0;
  font-size: clamp(2rem, 4vw, 3.75rem);
  line-height: 1;
  letter-spacing: -0.03em;
}

.section__intro p:not(.section__kicker),
.final-cta p {
  color: var(--text-3);
  font-size: var(--text-lg);
}

.section__intro--center {
  max-width: 780px;
  margin: 0 auto var(--space-10);
  text-align: center;
}

.section__intro--center h2,
.section__intro--center p {
  margin-left: auto;
  margin-right: auto;
}

.two-column,
.final-cta__grid {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(360px, 1.08fr);
  gap: clamp(32px, 6vw, 72px);
  align-items: start;
}

.two-column--reverse {
  grid-template-columns: minmax(360px, 1.08fr) minmax(0, 0.92fr);
}

.value-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-2);
}

.value-card {
  padding: var(--space-6);
  border-right: 1px solid var(--border-2);
}

.value-card:last-child {
  border-right: 0;
}

.value-card h2 {
  margin: 0 0 var(--space-3);
  padding: 0;
  border: 0;
  color: var(--green);
  font-size: var(--text-2xl);
}

.value-card p {
  margin: 0;
  color: var(--text-3);
}

.comparison {
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-2);
}

.comparison__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--border-2);
}

.comparison__row:last-child {
  border-bottom: 0;
}

.comparison__before,
.comparison__after {
  max-width: none;
  margin: 0;
  padding: var(--space-5);
  font-size: var(--text-sm);
}

.comparison__before {
  color: var(--text-4);
  background: var(--bg-1);
}

.comparison__after {
  color: var(--text-1);
}

.loop {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 1px;
  padding: 1px;
  margin: 0;
  list-style: none;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  background: var(--border-2);
  overflow: hidden;
}

.loop li {
  display: flex;
  min-height: 132px;
  flex-direction: column;
  gap: var(--space-4);
  margin: 0;
  padding: var(--space-5);
  background: var(--bg-1);
  color: var(--text-2);
}

.loop__index {
  font-family: var(--font-mono);
  color: var(--amber);
}

.terminal-stack {
  display: grid;
  gap: var(--space-5);
}

.role-lab {
  display: grid;
  gap: var(--space-5);
}

.role-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.role-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 38px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-1);
  color: var(--text-3);
  font-family: var(--font-mono);
  cursor: pointer;
}

.role-tab:hover,
.role-tab--active {
  border-color: var(--cyan);
  color: var(--text-1);
  background: var(--cyan-bg);
}

.role-detail h3 {
  margin: 0 0 var(--space-3);
  padding: 0;
  border: 0;
}

.role-detail p {
  color: var(--text-2);
}

.role-detail__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-2);
}

.role-detail strong {
  display: block;
  margin-bottom: var(--space-3);
  color: var(--cyan);
}

.role-detail ul {
  margin: 0;
  padding-left: var(--space-5);
}

.role-detail li {
  color: var(--text-3);
  font-size: var(--text-sm);
}

.final-cta {
  padding-bottom: clamp(80px, 12vw, 144px);
}

.trust-list {
  display: grid;
  gap: var(--space-4);
}

.trust-item {
  padding: var(--space-5);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  background: var(--bg-2);
}

.trust-item h3 {
  margin: 0 0 var(--space-2);
  color: var(--green);
  font-size: var(--text-lg);
}

.trust-item p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-3);
}

@media (max-width: 980px) {
  .hero__grid,
  .two-column,
  .two-column--reverse,
  .final-cta__grid {
    grid-template-columns: 1fr;
  }

  .hero h1,
  .section__intro h2,
  .final-cta h2 {
    max-width: 14ch;
  }

  .value-strip,
  .loop {
    grid-template-columns: 1fr;
  }

  .value-card {
    border-right: 0;
    border-bottom: 1px solid var(--border-2);
  }

  .value-card:last-child {
    border-bottom: 0;
  }
}

@media (max-width: 640px) {
  .hero__grid,
  .section__container {
    width: calc(100% - 28px);
  }

  .hero h1 {
    font-size: clamp(2.7rem, 12vw, 3.4rem);
    line-height: 1.02;
  }

  .brief-snapshot code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .comparison__row,
  .role-detail__grid {
    grid-template-columns: 1fr;
  }

  .comparison__before {
    border-bottom: 1px solid var(--border-2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn {
    transition: none;
  }

  .btn:hover {
    transform: none;
  }
}
</style>
