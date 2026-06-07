<script setup lang="ts">
/**
 * ConceptMapTutorial — 教程 1: 概念之旅
 * 可点击概念地图，展示角色和组件关系
 */
import { ref } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'

interface Node {
  id: string
  label: string
  type: 'role' | 'system'
  color: string
  x: number
  y: number
  desc: string
}

const nodes: Node[] = [
  { id: 'human', label: 'Human', type: 'role', color: 'var(--off-white)', x: 50, y: 8, desc: '提出需求，做出不可逆决策' },
  { id: 'lead', label: 'Lead', type: 'role', color: 'var(--green)', x: 50, y: 25, desc: '人类代理，协调所有 agent，使用 brief 验证真相' },
  { id: 'pm', label: 'PM', type: 'role', color: 'var(--amber)', x: 22, y: 42, desc: '保护用户价值、范围和验收标准' },
  { id: 'researcher', label: 'Researcher', type: 'role', color: 'var(--magenta)', x: 78, y: 42, desc: '处理跨职能未知和外部研究' },
  { id: 'coder', label: 'Coder', type: 'role', color: 'var(--cyan)', x: 25, y: 60, desc: '实现代码，在隔离工作树中并行编辑' },
  { id: 'reviewer', label: 'Reviewer', type: 'role', color: '#88aacc', x: 50, y: 60, desc: '保护代码质量、安全性和可维护性' },
  { id: 'tester', label: 'Tester', type: 'role', color: 'var(--amber)', x: 75, y: 60, desc: '验证用户行为、边界情况和回归' },
  { id: 'issues', label: 'Issues', type: 'system', color: 'var(--info)', x: 12, y: 80, desc: '本地问题跟踪，lead 创建和分配' },
  { id: 'pr', label: 'PR Gates', type: 'system', color: 'var(--warning)', x: 50, y: 80, desc: '合并门控：自测、测试、审查、验收' },
  { id: 'mailbox', label: 'Mailbox', type: 'system', color: 'var(--magenta)', x: 88, y: 80, desc: 'Agent 邮箱消息系统，支持唤醒策略' },
]

const selected = ref<Node | null>(null)

function select(node: Node) {
  selected.value = selected.value?.id === node.id ? null : node
}
</script>

<template>
  <div class="tut-concept-map">
    <h2>1. 概念之旅</h2>
    <p>点击节点了解每个角色和组件的职责。</p>

    <div class="map-container">
      <svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="50" y1="12" x2="50" y2="21" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="42" y1="29" x2="27" y2="38" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="58" y1="29" x2="73" y2="38" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="25" y1="46" x2="27" y2="56" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="50" y1="29" x2="50" y2="56" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="55" y1="29" x2="73" y2="56" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="28" y1="64" x2="15" y2="76" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="32" y1="64" x2="48" y2="76" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="50" y1="64" x2="50" y2="76" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="70" y1="64" x2="55" y2="76" stroke="var(--border-2)" stroke-width="0.3" />
        <line x1="58" y1="29" x2="85" y2="76" stroke="var(--border-2)" stroke-width="0.3" />
      </svg>

      <button
        v-for="node in nodes"
        :key="node.id"
        class="map-node"
        :class="{ 'map-node--selected': selected?.id === node.id }"
        :style="{ left: node.x + '%', top: node.y + '%', '--nc': node.color }"
        @click="select(node)"
      >
        {{ node.label }}
      </button>
    </div>

    <div v-if="selected" class="map-detail fade-in">
      <TerminalPane :title="`node: ${selected.id}`" :show-dots="true">
        <div class="detail-header">
          <span class="detail-name" :style="{ color: selected.color }">{{ selected.label }}</span>
          <span class="detail-type">[{{ selected.type }}]</span>
        </div>
        <p class="detail-desc">{{ selected.desc }}</p>
      </TerminalPane>
    </div>
  </div>
</template>

<style scoped>
.tut-concept-map {}

.map-container {
  position: relative;
  width: 100%;
  height: 400px;
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  margin-top: var(--space-4);
}
.map-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.map-node {
  position: absolute;
  transform: translate(-50%, -50%);
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-1);
  z-index: 2;
  transition: all var(--duration-fast);
}
.map-node:hover {
  border-color: var(--nc);
}
.map-node--selected {
  border-color: var(--nc);
  background: var(--bg-4);
  box-shadow: 0 0 10px rgba(0, 212, 255, 0.15);
}
.map-detail {
  margin-top: var(--space-4);
}
.detail-header {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-bottom: var(--space-2);
}
.detail-name {
  font-family: var(--font-pixel);
  font-size: var(--text-xl);
}
.detail-type {
  color: var(--text-3);
  font-size: var(--text-xs);
}
.detail-desc {
  color: var(--text-2);
  font-size: var(--text-sm);
  margin: 0;
}
</style>
