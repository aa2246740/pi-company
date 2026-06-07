<script setup lang="ts">
/**
 * WorkflowsPage — 工作流
 * 人类引导、Issues、工作树、PR 流程、审查测试验收、合并门控
 */
import { ref, computed } from 'vue'
import DocsLayout from '@/layouts/DocsLayout.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import CodeBlock from '@/components/terminal/CodeBlock.vue'
import GateBadge from '@/components/common/GateBadge.vue'
import StepperTimeline from '@/components/common/StepperTimeline.vue'
import { prGates } from '@/data/facts'

/** PR 门控模拟器状态 */
const gateStates = ref<Record<string, boolean>>({
  'author': true,
  'owner': true,
  'self-test': true,
  'test-brief': true,
  'auto-tests': true,
  'reviewer': false,
  'tester': false,
  'acceptance': false,
  'branch': true,
  'merge-clean': true,
  'no-caveats': true,
  'root-clean': true,
})

function toggleGate(id: string) {
  gateStates.value[id] = !gateStates.value[id]
}

const allGatesPassed = computed(() => Object.values(gateStates.value).every(Boolean))
const blockerCount = computed(() => Object.values(gateStates.value).filter(v => !v).length)

/** PR 流程时间线 */
const prSteps = [
  { label: '创建 PR', status: 'done' as const },
  { label: '自测', status: 'done' as const },
  { label: '标记 Ready', status: 'done' as const },
  { label: '审查', status: 'active' as const },
  { label: '测试', status: 'pending' as const },
  { label: '验收', status: 'pending' as const },
  { label: '合并', status: 'pending' as const },
]

/** 人类引导演示 */
const steeringInput = ref('')
const mirrorMessages = ref<Array<{ time: string; text: string }>>([])

function sendSteering() {
  if (!steeringInput.value.trim()) return
  const now = new Date()
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
  mirrorMessages.value.push({ time, text: steeringInput.value })
  steeringInput.value = ''
}
</script>

<template>
  <DocsLayout>
    <div class="workflows-page">
      <h1>→ 工作流</h1>
      <p>pi-company 的核心协作流程，从人类需求到代码合并。</p>

      <!-- 人类引导 -->
      <section id="steering" class="wf-section">
        <h2>人类引导</h2>
        <p>人类可以向任何 worker 输入消息，这些引导会<strong>自动镜像到 lead</strong>。</p>

        <div class="steering-demo">
          <h3>⚡ 模拟演示：人类引导</h3>

          <div class="steering-demo__input">
            <div class="steering-demo__pane">
              <TerminalPane title="coder-ui session" :show-dots="true">
                <div class="steering-prompt">
                  <span class="text-cyan">human@pi</span>:<span class="text-green">~</span>$
                  <input
                    v-model="steeringInput"
                    class="steering-input"
                    placeholder="输入引导消息..."
                    @keydown.enter="sendSteering"
                  />
                </div>
              </TerminalPane>
            </div>

            <button class="btn btn--primary btn--sm" @click="sendSteering" :disabled="!steeringInput.trim()">
              发送
            </button>
          </div>

          <div v-if="mirrorMessages.length" class="steering-demo__mirror fade-in">
            <TerminalPane title="lead inbox (auto-mirrored)" :show-dots="true">
              <div v-for="(msg, i) in mirrorMessages" :key="i" class="mirror-msg">
                <span class="text-muted">[{{ msg.time }}]</span>
                <span class="text-amber">human_steering</span>
                <span class="text-muted">from coder-ui:</span>
                <span>{{ msg.text }}</span>
              </div>
            </TerminalPane>
          </div>

          <div class="alert alert--info">
            <span class="alert__icon">ℹ</span>
            <span>Worker <strong>不应重复</strong>将人类引导消息发送给 lead。引导已自动镜像。</span>
          </div>
        </div>
      </section>

      <!-- Issues 与任务 -->
      <section id="issues" class="wf-section">
        <h2>问题与任务</h2>
        <p>Lead 创建 issue 并分配给 owner。只有分配的 owner 能更新任务状态。</p>

        <CodeBlock
          code='pi-company --root ./my-project issue create --title "Build UI components"'
          prompt="$ "
        />

        <CodeBlock
          code='pi-company --root ./my-project task start --issue ISSUE-001'
          prompt="$ "
        />

        <div class="info-block">
          <h4>任务状态流转</h4>
          <StepperTimeline :steps="[
            { label: 'start', status: 'done' },
            { label: 'report', status: 'done' },
            { label: 'block', status: 'pending' },
            { label: 'complete', status: 'pending' },
          ]" />
        </div>
      </section>

      <!-- Coder 工作树 -->
      <section id="worktrees" class="wf-section">
        <h2>Coder 工作树</h2>
        <p>每个 coder agent 获得<strong>隔离的 git 工作树</strong>，支持并行编辑而不会冲突。</p>

        <TerminalPane title="worktree diagram" :show-dots="true">
          <div class="worktree-diagram">
            <div class="wt-branch">
              <span class="wt-branch__label text-green">main</span>
              <span class="wt-branch__line"></span>
              <span class="wt-branch__commit">●</span>
              <span class="wt-branch__commit">●</span>
              <span class="wt-branch__commit">●</span>
            </div>
            <div class="wt-branch">
              <span class="wt-branch__label text-cyan">coder-ui</span>
              <span class="wt-branch__line wt-branch__line--cyan"></span>
              <span class="wt-branch__commit text-cyan">●</span>
              <span class="wt-branch__commit text-cyan">●</span>
            </div>
            <div class="wt-branch">
              <span class="wt-branch__label text-amber">coder-api</span>
              <span class="wt-branch__line wt-branch__line--amber"></span>
              <span class="wt-branch__commit text-amber">●</span>
              <span class="wt-branch__commit text-amber">●</span>
              <span class="wt-branch__commit text-amber">●</span>
            </div>
          </div>
        </TerminalPane>

        <div class="alert alert--warning">
          <span class="alert__icon">⚠</span>
          <span>脏工作树（未提交更改）会阻塞 PR 证据。确保在工作树中 commit 所有更改。</span>
        </div>
      </section>

      <!-- 本地 PR 流程 -->
      <section id="pr-flow" class="wf-section">
        <h2>本地 PR 流程</h2>
        <p>代码变更必须通过 PR 流程完成。不能用散文 "done" 替代。</p>

        <StepperTimeline :steps="prSteps" />

        <div class="pr-flow-steps">
          <div class="pr-step">
            <h4>1. Coder 创建 PR</h4>
            <CodeBlock
              code='pi-company --root ./my-project pr create --title "feat: add components"'
              prompt="$ "
            />
          </div>

          <div class="pr-step">
            <h4>2. Coder 运行测试并标记 Ready</h4>
            <CodeBlock
              code='pi-company --root ./my-project pr mark-ready --pr PR-001 --self-test "Unit tests pass" --test-brief "Validate component rendering"'
              prompt="$ "
            />
          </div>

          <div class="pr-step">
            <h4>3. 记录自动化测试</h4>
            <CodeBlock
              code='pi-company --root ./my-project pr auto-tests --pr PR-001 --status passed --summary "All 42 tests pass"'
              prompt="$ "
            />
          </div>
        </div>
      </section>

      <!-- 审查、测试与验收 -->
      <section id="review" class="wf-section">
        <h2>审查、测试与验收</h2>
        <p>三个独立的质量关卡：</p>

        <div class="review-grid">
          <div class="review-card">
            <div class="review-card__header">
              <span class="review-card__icon text-cyan">✦</span>
              <span class="review-card__title">Reviewer 审查</span>
            </div>
            <ul>
              <li>独立于测试</li>
              <li>验证代码质量、安全性</li>
              <li>approve / request_changes / comment</li>
            </ul>
          </div>

          <div class="review-card">
            <div class="review-card__header">
              <span class="review-card__icon text-amber">◆</span>
              <span class="review-card__title">Tester 验证</span>
            </div>
            <ul>
              <li>独立于审查</li>
              <li>验证用户行为和边界情况</li>
              <li>pass / fail / blocked</li>
            </ul>
          </div>

          <div class="review-card">
            <div class="review-card__header">
              <span class="review-card__icon text-green">◇</span>
              <span class="review-card__title">PM/Lead 验收</span>
            </div>
            <ul>
              <li>产品级别验收</li>
              <li>验证交付行为匹配需求</li>
              <li>accept / request_changes / comment</li>
            </ul>
          </div>
        </div>

        <div class="alert alert--warning">
          <span class="alert__icon">⚠</span>
          <span>如果 pass/approve 摘要中包含 caveats、已知问题或未解决风险，门控会阻塞。</span>
        </div>
      </section>

      <!-- 合并门控 -->
      <section id="merge-gates" class="wf-section">
        <h2>合并门控</h2>
        <p>PR 必须通过<strong>所有门控条件</strong>才能合并。</p>

        <!-- 门控模拟器 -->
        <div class="gate-simulator">
          <h3>⚡ 模拟演示：PR 门控检查</h3>

          <div class="gate-simulator__status">
            <div v-if="allGatesPassed" class="gate-status gate-status--pass">
              <span class="text-green">✓ ALL GATES PASS — Ready to merge</span>
            </div>
            <div v-else class="gate-status gate-status--blocked">
              <span class="text-red">✗ BLOCKED — {{ blockerCount }} gate(s) failing</span>
            </div>
          </div>

          <div class="gate-simulator__gates">
            <button
              v-for="gate in prGates"
              :key="gate.id"
              class="gate-toggle"
              :class="{ 'gate-toggle--passed': gateStates[gate.id] }"
              @click="toggleGate(gate.id)"
            >
              <GateBadge :label="gate.label" :passed="gateStates[gate.id]" />
            </button>
          </div>

          <div class="gate-simulator__merge">
            <button
              class="btn"
              :class="allGatesPassed ? 'btn--primary' : 'btn--disabled'"
              :disabled="!allGatesPassed"
            >
              {{ allGatesPassed ? '▶ 执行合并' : '⊘ 无法合并' }}
            </button>
          </div>
        </div>

        <div class="info-block">
          <h4>Root 脏变更阻塞</h4>
          <p>即使所有 agent 门控都通过，root 目录的 tracked/staged 变更也会阻塞合并。Lead <strong>不能</strong>用 <code>git stash</code> 或 <code>git reset</code> 来隐藏这些变更。</p>
        </div>
      </section>
    </div>
  </DocsLayout>
</template>

<style scoped>
.workflows-page {
  padding-bottom: var(--space-16);
}
.wf-section {
  margin-top: var(--space-12);
}

/* ── Steering Demo ── */
.steering-demo {
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.steering-demo h3 {
  padding: var(--space-2) var(--space-4);
  background: var(--bg-5);
  border-bottom: 1px solid var(--border-1);
  font-size: var(--text-base);
  color: var(--amber);
}
.steering-demo__input {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-4);
  align-items: center;
}
.steering-demo__pane {
  flex: 1;
}
.steering-prompt {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
.steering-input {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-1);
  color: var(--text-1);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  padding: var(--space-1) 0;
  outline: none;
}
.steering-input:focus {
  border-bottom-color: var(--cyan);
}
.steering-demo__mirror {
  border-top: 1px solid var(--border-1);
}
.mirror-msg {
  font-size: var(--text-sm);
  padding: var(--space-1) 0;
  display: flex;
  gap: var(--space-2);
}

/* ── Buttons ── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-6);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  border: 1px solid;
  transition: all var(--duration-fast);
}
.btn--primary {
  color: var(--bg-0);
  background: var(--green);
  border-color: var(--green);
  font-weight: 600;
}
.btn--primary:hover {
  background: var(--green-soft);
}
.btn--sm {
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-xs);
}
.btn--disabled {
  color: var(--text-3);
  background: var(--bg-4);
  border-color: var(--border-1);
  cursor: not-allowed;
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

/* ── Worktree Diagram ── */
.worktree-diagram {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.wt-branch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.wt-branch__label {
  min-width: 80px;
  font-size: var(--text-xs);
  font-weight: 600;
}
.wt-branch__line {
  width: 20px;
  height: 2px;
  background: var(--green);
}
.wt-branch__line--cyan { background: var(--cyan); }
.wt-branch__line--amber { background: var(--amber); }
.wt-branch__commit {
  font-size: var(--text-lg);
  color: var(--green);
}

/* ── PR Steps ── */
.pr-flow-steps {
  margin-top: var(--space-6);
}
.pr-step {
  margin-bottom: var(--space-6);
}
.pr-step h4 {
  font-family: var(--font-pixel);
  color: var(--cyan);
  margin-bottom: var(--space-2);
  font-size: var(--text-base);
}

/* ── Review Grid ── */
.review-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-6);
}
.review-card {
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
.review-card__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.review-card__icon {
  font-size: var(--text-xl);
}
.review-card__title {
  font-family: var(--font-pixel);
  font-size: var(--text-lg);
  color: var(--off-white);
}
.review-card ul {
  padding-left: var(--space-6);
}
.review-card li {
  font-size: var(--text-sm);
  color: var(--text-2);
  margin-bottom: var(--space-1);
}

/* ── Gate Simulator ── */
.gate-simulator {
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-top: var(--space-6);
}
.gate-simulator h3 {
  padding: var(--space-2) var(--space-4);
  background: var(--bg-5);
  border-bottom: 1px solid var(--border-1);
  font-size: var(--text-base);
  color: var(--amber);
}
.gate-simulator__status {
  padding: var(--space-4);
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--text-lg);
}
.gate-status--pass {
  background: rgba(0, 255, 65, 0.05);
}
.gate-status--blocked {
  background: rgba(255, 51, 51, 0.05);
}
.gate-simulator__gates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-4);
}
.gate-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: transform var(--duration-fast);
}
.gate-toggle:hover {
  transform: scale(1.05);
}
.gate-simulator__merge {
  padding: var(--space-4);
  text-align: center;
  border-top: 1px solid var(--border-1);
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

.text-red { color: var(--error); }
</style>
