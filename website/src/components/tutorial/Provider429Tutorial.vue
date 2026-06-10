<script setup lang="ts">
/**
 * Provider429Tutorial — 教程 13: Provider 过载与恢复
 * 队列模拟器 + provider overload 事件触发冷却
 */
import { ref, computed } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const concurrentRequests = ref(0)
const maxConcurrent = 3
const cooldownActive = ref(false)
const cooldownSeconds = ref(0)
const backoffLevel = ref(0)

const requests = ref<Array<{ id: number; status: 'pending' | 'success' | 'overload' }>>([])

function addRequest() {
  if (concurrentRequests.value >= maxConcurrent) return
  const id = requests.value.length + 1
  requests.value.push({ id, status: 'pending' })
  concurrentRequests.value++

  setTimeout(() => {
    const req = requests.value.find(r => r.id === id)
    if (req) {
      if (Math.random() > 0.7 && backoffLevel.value > 0) {
        req.status = 'overload'
        triggerCooldown()
      } else {
        req.status = 'success'
      }
      concurrentRequests.value = Math.max(0, concurrentRequests.value - 1)
    }
  }, 1000 + Math.random() * 2000)
}

function triggerCooldown() {
  backoffLevel.value = Math.min(backoffLevel.value + 1, 4)
  const durations = [60, 120, 300, 600]
  cooldownSeconds.value = durations[backoffLevel.value - 1] || 60
  cooldownActive.value = true

  const interval = setInterval(() => {
    cooldownSeconds.value--
    if (cooldownSeconds.value <= 0) {
      cooldownActive.value = false
      clearInterval(interval)
    }
  }, 1000)
}

function resetSimulation() {
  requests.value = []
  concurrentRequests.value = 0
  cooldownActive.value = false
  cooldownSeconds.value = 0
  backoffLevel.value = 0
}

const canSend = computed(() => concurrentRequests.value < maxConcurrent && !cooldownActive.value)
</script>

<template>
  <div class="tut-429">
    <h2>13. Provider 过载与恢复</h2>
    <p>模拟 provider 请求队列。最多 3 个并发请求；过载会触发退避冷却。</p>

    <div class="queue-status">
      <TerminalPane title="provider-queue" :show-dots="true">
        <div class="queue-info">
          <div><span class="text-cyan">并发请求：</span> {{ concurrentRequests }} / {{ maxConcurrent }}</div>
          <div><span class="text-cyan">退避级别：</span> {{ backoffLevel }}</div>
          <div v-if="cooldownActive">
            <span class="text-amber">⏳ 冷却中：{{ cooldownSeconds }}s</span>
          </div>
          <div v-else>
            <span class="text-green">✓ 队列可用</span>
          </div>
        </div>
      </TerminalPane>
    </div>

    <div class="queue-controls">
      <button class="send-btn" @click="addRequest" :disabled="!canSend">
        发送请求
      </button>
      <button class="reset-btn" @click="resetSimulation">重置</button>
    </div>

    <div class="requests-log">
      <div
        v-for="req in requests.slice(-8)"
        :key="req.id"
        class="req-item"
        :class="{
          'req-item--pending': req.status === 'pending',
          'req-item--success': req.status === 'success',
          'req-item--overload': req.status === 'overload',
        }"
      >
        <span class="req-id">#{{ req.id }}</span>
        <span class="req-status">
          <span v-if="req.status === 'pending'" class="text-cyan blink">⏳</span>
          <span v-else-if="req.status === 'success'" class="text-green">✓</span>
          <span v-else class="text-red">overload</span>
        </span>
      </div>
    </div>

    <div class="backoff-info">
      <TerminalPane title="backoff-policy" :show-dots="true">
        <div class="policy-line"><span class="text-cyan">首次过载：</span> 60 秒退避</div>
        <div class="policy-line"><span class="text-cyan">第二次：</span> 120 秒退避</div>
        <div class="policy-line"><span class="text-cyan">最大退避：</span> 10 分钟</div>
        <div class="policy-line"><span class="text-cyan">恢复顺序：</span> Lead 先恢复，worker 交错</div>
      </TerminalPane>
    </div>
  </div>
</template>

<style scoped>
.queue-status {
  margin: var(--space-4) 0;
}
.queue-info {
  font-size: var(--text-sm);
  line-height: 1.8;
}
.queue-controls {
  display: flex;
  gap: var(--space-2);
  margin: var(--space-4) 0;
}
.send-btn {
  padding: var(--space-2) var(--space-6);
  background: var(--bg-3);
  border: 1px solid var(--green);
  border-radius: var(--radius-sm);
  color: var(--green);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.send-btn:hover:not(:disabled) {
  background: rgba(0, 255, 65, 0.1);
}
.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.reset-btn {
  padding: var(--space-2) var(--space-4);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
}
.requests-log {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-4) 0;
}
.req-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  border: 1px solid;
}
.req-item--pending {
  border-color: rgba(0, 212, 255, 0.3);
  background: rgba(0, 212, 255, 0.05);
}
.req-item--success {
  border-color: rgba(0, 255, 65, 0.3);
  background: rgba(0, 255, 65, 0.05);
}
.req-item--overload {
  border-color: rgba(255, 51, 51, 0.3);
  background: rgba(255, 51, 51, 0.05);
}
.backoff-info {
  margin-top: var(--space-6);
}
.policy-line {
  font-size: var(--text-sm);
  line-height: 1.8;
}
</style>
