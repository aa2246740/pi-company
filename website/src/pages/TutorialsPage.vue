<script setup lang="ts">
/**
 * TutorialsPage — 交互教程
 * 14 个教程模块 + 端到端演练
 */
import DocsLayout from '@/layouts/DocsLayout.vue'
import ConceptMapTutorial from '@/components/tutorial/ConceptMapTutorial.vue'
import InitCompanyTutorial from '@/components/tutorial/InitCompanyTutorial.vue'
import LaunchAgentsTutorial from '@/components/tutorial/LaunchAgentsTutorial.vue'
import ModelConfigTutorial from '@/components/tutorial/ModelConfigTutorial.vue'
import HumanSteeringTutorial from '@/components/tutorial/HumanSteeringTutorial.vue'
import MailboxWakeTutorial from '@/components/tutorial/MailboxWakeTutorial.vue'
import IssuesTasksTutorial from '@/components/tutorial/IssuesTasksTutorial.vue'
import CoderWorktreesTutorial from '@/components/tutorial/CoderWorktreesTutorial.vue'
import PRTutorial from '@/components/tutorial/PRTutorial.vue'
import ReviewTestTutorial from '@/components/tutorial/ReviewTestTutorial.vue'
import LeadTruthTutorial from '@/components/tutorial/LeadTruthTutorial.vue'
import MergeGateTutorial from '@/components/tutorial/MergeGateTutorial.vue'
import Provider429Tutorial from '@/components/tutorial/Provider429Tutorial.vue'
import TroubleshootingTutorial from '@/components/tutorial/TroubleshootingTutorial.vue'
</script>

<template>
  <DocsLayout>
    <div class="tutorials-page">
      <h1>◈ 交互教程</h1>
      <p>通过模拟器和交互组件学习 pi-company 的每个功能。所有模拟器已标注为 <span class="text-amber">⚡ 模拟演示</span>。</p>

      <!-- 教程 1: 概念之旅 -->
      <section id="concept-map" class="tut-section">
        <ConceptMapTutorial />
      </section>

      <!-- 教程 2: 初始化公司 -->
      <section id="init-company" class="tut-section">
        <InitCompanyTutorial />
      </section>

      <!-- 教程 3: 启动 Agent -->
      <section id="launch-agents" class="tut-section">
        <LaunchAgentsTutorial />
      </section>

      <!-- 教程 4: 配置角色模型 -->
      <section id="model-config" class="tut-section">
        <ModelConfigTutorial />
      </section>

      <!-- 教程 5: 人类引导 -->
      <section id="human-steering" class="tut-section">
        <HumanSteeringTutorial />
      </section>

      <!-- 教程 6: 邮箱与唤醒策略 -->
      <section id="mailbox-wake" class="tut-section">
        <MailboxWakeTutorial />
      </section>

      <!-- 教程 7: 问题与任务 -->
      <section id="issues-tasks" class="tut-section">
        <IssuesTasksTutorial />
      </section>

      <!-- 教程 8: Coder 工作树 -->
      <section id="coder-worktrees" class="tut-section">
        <CoderWorktreesTutorial />
      </section>

      <!-- 教程 9: 本地 PR 流程 -->
      <section id="local-pr" class="tut-section">
        <PRTutorial />
      </section>

      <!-- 教程 10: 审查、测试与验收 -->
      <section id="review-test" class="tut-section">
        <ReviewTestTutorial />
      </section>

      <!-- 教程 11: Lead 真相 -->
      <section id="lead-truth" class="tut-section">
        <LeadTruthTutorial />
      </section>

      <!-- 教程 12: 合并门控 -->
      <section id="merge-gates" class="tut-section">
        <MergeGateTutorial />
      </section>

      <!-- 教程 13: Provider 过载与恢复 -->
      <section id="provider-429" class="tut-section">
        <Provider429Tutorial />
      </section>

      <!-- 教程 14: 故障排查 -->
      <section id="troubleshooting" class="tut-section">
        <TroubleshootingTutorial />
      </section>

      <!-- 端到端演练 -->
      <section id="e2e-walkthrough" class="tut-section">
        <h2>端到端演练</h2>
        <p>从人类提出需求到最终合并的完整流程。</p>

        <div class="e2e-timeline">
          <div class="e2e-step" v-for="(step, i) in [
            { role: 'Human', text: '描述需求：构建 pi-company 官网', icon: '○', color: 'var(--off-white)' },
            { role: 'Lead', text: '创建 issue 并分配给 coder', icon: '◆', color: 'var(--green)' },
            { role: 'PM', text: '定义验收标准和信息架构', icon: '◇', color: 'var(--amber)' },
            { role: 'Researcher', text: '补充技术栈和设计方向', icon: '◈', color: 'var(--magenta)' },
            { role: 'Coder', text: '在工作树中实现代码', icon: '▶', color: 'var(--cyan)' },
            { role: 'Coder', text: '创建 PR、运行测试、标记 ready', icon: '▶', color: 'var(--cyan)' },
            { role: 'Reviewer', text: '审查代码质量和安全性', icon: '✦', color: 'var(--cyan-dim)' },
            { role: 'Tester', text: '验证用户行为和边界情况', icon: '◆', color: 'var(--amber)' },
            { role: 'PM', text: '产品验收：交付行为匹配需求', icon: '◇', color: 'var(--amber)' },
            { role: 'Lead', text: '检查 brief、确认门控、执行合并', icon: '◆', color: 'var(--green)' },
          ]" :key="i">
            <div class="e2e-step__marker" :style="{ color: step.color }">{{ step.icon }}</div>
            <div class="e2e-step__content">
              <span class="e2e-step__role" :style="{ color: step.color }">{{ step.role }}</span>
              <span class="e2e-step__text">{{ step.text }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </DocsLayout>
</template>

<style scoped>
.tutorials-page {
  padding-bottom: var(--space-16);
}
.tut-section {
  margin-top: var(--space-12);
  padding-top: var(--space-6);
  border-top: 1px solid var(--border-1);
}
.tut-section:first-of-type {
  border-top: none;
  padding-top: 0;
}

/* ── E2E Timeline ── */
.e2e-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: var(--space-6);
}
.e2e-step {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-2) 0;
  position: relative;
}
.e2e-step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 10px;
  top: 28px;
  bottom: -4px;
  width: 1px;
  background: var(--border-2);
}
.e2e-step__marker {
  font-size: var(--text-lg);
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}
.e2e-step__content {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.e2e-step__role {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  min-width: 90px;
}
.e2e-step__text {
  font-size: var(--text-sm);
  color: var(--text-2);
}
</style>
