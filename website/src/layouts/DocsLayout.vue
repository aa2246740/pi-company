<script setup lang="ts">
/**
 * DocsLayout — 文档页面布局
 * 清晰的左侧导航 + 主内容区
 */
import SideNav from '@/components/layout/SideNav.vue'
</script>

<template>
  <div class="docs-layout">
    <SideNav />
    <main class="docs-layout__main">
      <div class="docs-layout__content">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.docs-layout {
  display: flex;
  min-height: calc(100vh - var(--header-h));
  padding-top: var(--header-h);
}

.docs-layout__main {
  flex: 1;
  min-width: 0;
  padding: var(--space-12) var(--space-10) var(--space-32);
}

.docs-layout__content {
  max-width: var(--content-max);
  margin: 0 auto;
}

@media (max-width: 768px) {
  .docs-layout__main {
    padding: var(--space-6) var(--space-4) var(--space-16);
  }
}
</style>
