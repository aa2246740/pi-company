<script setup lang="ts">
/**
 * AboutPage — 关于页面
 */
import DocsLayout from '@/layouts/DocsLayout.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
</script>

<template>
  <DocsLayout>
    <div class="about-page">
      <h1>◆ 关于</h1>

      <section class="about-section">
        <h2>pi-company</h2>
        <p><code>pi-company</code> 是一个 Pi 原生的本地多智能体协作运行时，让可见、可控的 Pi 智能体在一个项目中协同工作。</p>

        <div class="about-info">
          <TerminalPane title="about" :show-dots="true">
            <p class="text-muted">源代码：</p>
            <code>{GITHUB_URL}</code>
          </TerminalPane>
        </div>
      </section>

      <section class="about-section">
        <h2>技术栈</h2>
        <ul>
          <li><strong>前端框架</strong> — Vue 3 + TypeScript</li>
          <li><strong>构建工具</strong> — Vite</li>
          <li><strong>路由</strong> — Vue Router</li>
          <li><strong>样式</strong> — 自定义 CSS Variables + TUI 主题</li>
          <li><strong>测试</strong> — Vitest</li>
        </ul>
      </section>

      <section class="about-section">
        <h2>设计理念</h2>
        <ul>
          <li><strong>复古未来 TUI</strong> — 终端风格界面，CRT 荧光色系</li>
          <li><strong>文档即产品</strong> — 第一屏就是可用的文档体验</li>
          <li><strong>交互教学</strong> — 模拟器和交互组件，不是纯文字</li>
          <li><strong>事实准确</strong> — 所有内容基于 pi-company-facts.md</li>
        </ul>
      </section>
    </div>
  </DocsLayout>
</template>

<style scoped>
.about-page {
  padding-bottom: var(--space-16);
}
.about-section {
  margin-top: var(--space-12);
}
.about-info {
  margin-top: var(--space-6);
}
</style>
