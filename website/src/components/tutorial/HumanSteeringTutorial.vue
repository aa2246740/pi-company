<script setup lang="ts">
/**
 * HumanSteeringTutorial — 教程 5: 人类引导
 * 输入消息 → 镜像到 lead 的动画
 */
import { ref } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const input = ref('')
const messages = ref<Array<{ time: string; text: string }>>([])

function send() {
  if (!input.value.trim()) return
  const t = new Date()
  const time = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`
  messages.value.push({ time, text: input.value })
  input.value = ''
}
</script>

<template>
  <div class="tut-steering">
    <h2>5. 人类引导</h2>
    <p>在任何 worker 会话中输入消息，它会自动镜像到 lead。</p>

    <div class="steering-demo">
      <TerminalPane title="coder-ui session" :show-dots="true">
        <div class="prompt-line">
          <span class="text-cyan">human@pi</span>:<span class="text-green">~</span>$
          <input v-model="input" class="steering-input" placeholder="输入引导消息..." @keydown.enter="send" />
        </div>
      </TerminalPane>

      <button class="send-btn" @click="send" :disabled="!input.trim()">发送到 lead</button>

      <div v-if="messages.length" class="mirror-pane fade-in">
        <TerminalPane title="lead inbox (auto-mirrored)" :show-dots="true">
          <div v-for="(m, i) in messages" :key="i" class="mirror-msg">
            <span class="text-muted">[{{ m.time }}]</span>
            <span class="text-amber">human_steering</span>
            <span class="text-muted">→ lead:</span>
            <span>{{ m.text }}</span>
          </div>
        </TerminalPane>
      </div>

      <div class="note">
        <span class="text-amber">⚠</span> Worker 不应重复发送引导消息给 lead — 引导已自动镜像。
      </div>
    </div>
  </div>
</template>

<style scoped>
.steering-demo {
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-top: var(--space-4);
}
.prompt-line {
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
.steering-input:focus { border-bottom-color: var(--cyan); }
.send-btn {
  display: block;
  width: 100%;
  padding: var(--space-2);
  background: var(--bg-4);
  border: none;
  border-top: 1px solid var(--border-1);
  color: var(--green);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background var(--duration-fast);
}
.send-btn:hover:not(:disabled) { background: var(--bg-5); }
.send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.mirror-pane { border-top: 1px solid var(--border-1); }
.mirror-msg {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-sm);
  padding: var(--space-1) 0;
}
.note {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-3);
  border-top: 1px solid var(--border-1);
}
</style>
