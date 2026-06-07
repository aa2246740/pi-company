<script setup lang="ts">
/**
 * LeadTruthTutorial — 教程 11: Lead 真相与完成真相
 * Worker 假完成 vs Brief 真相
 */
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import GateBadge from '@/components/common/GateBadge.vue'
</script>

<template>
  <div class="tut-truth">
    <h2>11. Lead 真相与完成真相</h2>
    <p>Worker 说 "done" ≠ 真的完成。只有 <code>company_lead_brief</code> 是全局真相。</p>

    <div class="truth-scenario">
      <div class="scenario-pane">
        <TerminalPane title="coder-ui → lead (report)" :show-dots="true">
          <div class="msg-meta">
            <span>From: <span class="text-cyan">coder-ui</span></span>
            <span>Type: <span class="text-amber">report</span></span>
          </div>
          <p class="msg-body">所有代码已实现，PR 已创建并标记 ready。测试全部通过。可以合并了 ✅</p>
        </TerminalPane>
      </div>

      <div class="scenario-arrow">
        <span class="text-muted">↓ 但 lead 需要验证 ↓</span>
      </div>

      <div class="scenario-pane">
        <TerminalPane title="company_lead_brief" :show-dots="true">
          <div class="brief-line"><span class="text-amber">⚠</span> can_claim_complete: <span class="text-red">false</span></div>
          <div class="brief-line"><span class="text-amber">⚠</span> incomplete_issues: <span class="text-amber">ISSUE-001</span></div>
          <div class="brief-line"><span class="text-amber">⚠</span> blockers:</div>
          <div class="brief-line indent"><span class="text-red">✗</span> Missing tester validation</div>
          <div class="brief-line indent"><span class="text-red">✗</span> Missing product acceptance</div>
          <div class="brief-line indent"><span class="text-green">✓</span> Self-test exists</div>
          <div class="brief-line indent"><span class="text-green">✓</span> Reviewer approved</div>
          <div class="brief-line"><span class="text-cyan">→</span> next_action: Send to tester</div>
        </TerminalPane>
      </div>
    </div>

    <div class="truth-gates">
      <GateBadge label="Self-Test" :passed="true" />
      <GateBadge label="Reviewer" :passed="true" />
      <GateBadge label="Tester" :passed="false" />
      <GateBadge label="Acceptance" :passed="false" />
    </div>

    <div class="truth-lesson">
      <span class="text-amber">⚠</span> Lead 不能仅凭 worker 报告就声称完成。必须检查 <code>company_lead_brief</code>。
    </div>
  </div>
</template>

<style scoped>
.truth-scenario {
  margin-top: var(--space-4);
}
.scenario-pane {
  margin-bottom: var(--space-2);
}
.scenario-arrow {
  text-align: center;
  padding: var(--space-2);
  font-size: var(--text-sm);
}
.msg-meta {
  display: flex;
  gap: var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-3);
  margin-bottom: var(--space-2);
}
.msg-body {
  color: var(--text-2);
  margin: 0;
}
.brief-line {
  padding: 2px 0;
  font-size: var(--text-sm);
  line-height: 1.8;
}
.indent { padding-left: var(--space-6); }
.truth-gates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
.truth-lesson {
  margin-top: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: rgba(255, 149, 0, 0.05);
  border: 1px solid rgba(255, 149, 0, 0.2);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--amber);
}
.text-red { color: var(--error); }
</style>
