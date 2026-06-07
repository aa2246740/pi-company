<script setup lang="ts">
/**
 * MailboxWakeTutorial — 教程 6: 邮箱与唤醒策略
 * 消息类型可视化 + 唤醒/消化演示
 */
import { ref, computed } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const messageTypes = [
  { type: 'human_steering', label: 'Human Steering', wake: true, always: true },
  { type: 'assignment', label: 'Assignment', wake: true, always: false },
  { type: 'review_request', label: 'Review Request', wake: true, always: false },
  { type: 'test_request', label: 'Test Request', wake: true, always: false },
  { type: 'system', label: 'System', wake: true, always: false },
  { type: 'report', label: 'Report', wake: false, always: false },
  { type: 'reply', label: 'Reply', wake: false, always: false },
  { type: 'question', label: 'Question', wake: false, always: false },
]

const burstCount = ref(3)
const cooldownActive = ref(false)

const recentMessages = computed(() => {
  const msgs = []
  for (let i = 0; i < burstCount.value; i++) {
    const type = messageTypes[i % messageTypes.length]
    msgs.push({
      id: i + 1,
      type: type.type,
      label: type.label,
      wake: type.wake,
      delay: type.wake ? 0 : 500 + i * 200,
    })
  }
  return msgs
})

function simulateBurst() {
  cooldownActive.value = true
  setTimeout(() => { cooldownActive.value = false }, 3000)
}
</script>

<template>
  <div class="tut-mailbox">
    <h2>6. 邮箱与唤醒策略</h2>
    <p>调整消息数量，观察哪些消息会立即唤醒 agent，哪些进入 digest。</p>

    <div class="burst-control">
      <label>消息突发数量：{{ burstCount }}</label>
      <input type="range" v-model.number="burstCount" min="1" max="8" />
    </div>

    <div class="message-flow">
      <div
        v-for="msg in recentMessages"
        :key="msg.id"
        class="msg-item"
        :class="{ 'msg-item--wake': msg.wake, 'msg-item--digest': !msg.wake }"
      >
        <span class="msg-type">{{ msg.label }}</span>
        <span class="msg-status">
          <span v-if="msg.wake" class="text-green">⚡ 立即唤醒</span>
          <span v-else class="text-muted">📦 Digest</span>
        </span>
      </div>
    </div>

    <div class="cooldown-demo">
      <button class="simulate-btn" @click="simulateBurst" :disabled="cooldownActive">
        {{ cooldownActive ? '⏳ 冷却中...' : '模拟消息突发' }}
      </button>
    </div>

    <TerminalPane title="wake-policy" :show-dots="true">
      <div class="policy-output">
        <div><span class="text-cyan">每 agent 限制：</span> 每分钟 6 次立即唤醒</div>
        <div><span class="text-cyan">全公司限制：</span> 每分钟 12 次立即唤醒</div>
        <div><span class="text-cyan">冷却间隔：</span> 同一 agent 10 秒</div>
        <div><span class="text-amber">⚠</span> 超出限制的消息自动转为 digest</div>
      </div>
    </TerminalPane>
  </div>
</template>

<style scoped>
.burst-control {
  margin: var(--space-4) 0;
}
.burst-control label {
  display: block;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-2);
  margin-bottom: var(--space-2);
}
.burst-control input[type="range"] {
  width: 100%;
  max-width: 300px;
  accent-color: var(--cyan);
}
.message-flow {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-4) 0;
}
.msg-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  border: 1px solid;
}
.msg-item--wake {
  background: rgba(0, 255, 65, 0.05);
  border-color: rgba(0, 255, 65, 0.2);
}
.msg-item--digest {
  background: rgba(136, 136, 136, 0.05);
  border-color: rgba(136, 136, 136, 0.2);
}
.msg-type {
  color: var(--text-1);
}
.cooldown-demo {
  margin: var(--space-4) 0;
}
.simulate-btn {
  padding: var(--space-2) var(--space-6);
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.simulate-btn:hover:not(:disabled) {
  border-color: var(--cyan);
  background: rgba(0, 212, 255, 0.1);
}
.simulate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.policy-output {
  font-size: var(--text-sm);
  line-height: 1.8;
}
</style>
