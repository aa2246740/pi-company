<script setup lang="ts">
/**
 * ModelConfigTutorial — 教程 4: 配置角色模型
 * 选择模型 → 显示 YAML 预览
 */
import { ref, computed } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

const defaultModel = ref('mimo-v2.5-pro')
const coderModel = ref('gpt-5.4-mini')
const testerModel = ref('mimo-v2.5-pro')
const selectedRole = ref('coder')

const models = [
  { id: 'mimo-v2.5-pro', label: 'MiMo v2.5 Pro', provider: 'xiaomi-token-plan-cn' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai-codex' },
]

const yamlOutput = computed(() => {
  return `model_policy:
  default:
    model: ${defaultModel.value}
  roles:
    coder:
      provider: ${models.find(m => m.id === coderModel.value)?.provider || 'openai-codex'}
      model: ${coderModel.value}
    tester:
      provider: ${models.find(m => m.id === testerModel.value)?.provider || 'xiaomi-token-plan-cn'}
      model: ${testerModel.value}`
})
</script>

<template>
  <div class="tut-model">
    <h2>4. 配置角色模型</h2>
    <p>为不同角色配置不同的 AI 模型。选择后查看生成的 YAML 配置。</p>

    <div class="model-config">
      <div class="config-field">
        <label>默认模型</label>
        <select v-model="defaultModel">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </div>

      <div class="config-field">
        <label>Coder 模型</label>
        <select v-model="coderModel">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </div>

      <div class="config-field">
        <label>Tester 模型</label>
        <select v-model="testerModel">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </div>
    </div>

    <TerminalPane title=".pi-company/company.yaml" :show-dots="true">
      <pre class="yaml-output">{{ yamlOutput }}</pre>
    </TerminalPane>

    <div class="model-note">
      <span class="text-amber">⚠</span> 运行中的 Pi 窗格会保持当前模型，直到重启。
    </div>
  </div>
</template>

<style scoped>
.model-config {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-4);
  margin: var(--space-4) 0;
}
.config-field label {
  display: block;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-3);
  margin-bottom: var(--space-1);
  text-transform: uppercase;
}
.config-field select {
  width: 100%;
  padding: var(--space-2);
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
}
.config-field select:focus {
  border-color: var(--cyan);
  outline: none;
}
.yaml-output {
  font-size: var(--text-sm);
  line-height: 1.7;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  color: var(--text-1);
}
.model-note {
  margin-top: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: rgba(255, 149, 0, 0.05);
  border: 1px solid rgba(255, 149, 0, 0.2);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--amber);
}
</style>
