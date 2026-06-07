<script setup lang="ts">
/**
 * CodeBlock — 带复制功能的代码块
 * 终端风格，显示命令和可选输出
 */
import { ref } from 'vue'

const props = defineProps<{
  code: string
  language?: string
  prompt?: string
  showLineNumbers?: boolean
}>()

const copied = ref(false)

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Fallback: 选择文本
    const el = document.createElement('textarea')
    el.value = props.code
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
}
</script>

<template>
  <div class="code-block">
    <div class="code-block__toolbar">
      <span class="code-block__lang">{{ language || 'bash' }}</span>
      <button class="code-block__copy" @click="copyToClipboard" :title="copied ? '已复制' : '复制命令'">
        <span v-if="copied" class="text-green">✓ 已复制</span>
        <span v-else>📋 复制</span>
      </button>
    </div>
    <pre class="code-block__pre"><code><span class="code-block__prompt" v-if="prompt !== ''">{{ prompt || '$ ' }}</span>{{ code }}</code></pre>
  </div>
</template>

<style scoped>
.code-block {
  position: relative;
  margin-bottom: var(--space-6);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-2);
}
.code-block__toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-1) var(--space-4);
  background: var(--bg-5);
  border-bottom: 1px solid var(--border-1);
}
.code-block__lang {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.code-block__copy {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-2);
  background: none;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  cursor: pointer;
  transition: all var(--duration-fast);
}
.code-block__copy:hover {
  color: var(--green);
  border-color: var(--green);
}
.code-block__pre {
  margin: 0;
  padding: var(--space-4);
  background: transparent;
  border: none;
  overflow-x: auto;
}
.code-block__pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--text-sm);
  color: var(--text-1);
}
.code-block__prompt {
  color: var(--green);
  user-select: none;
}
</style>
