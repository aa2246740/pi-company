<script setup lang="ts">
/**
 * SideNav — 左侧边栏导航
 * 清晰的层级结构，精致的设计
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { sidebarNav } from '@/data/navigation'

const route = useRoute()

const currentSection = computed(() => {
  const path = route.path
  if (path === '/') return null
  return path.replace(/^\//, '').split('/')[0] || null
})

const navItems = computed(() => {
  if (!currentSection.value) return []
  return sidebarNav[currentSection.value] || []
})
</script>

<template>
  <aside class="sidenav" v-if="navItems.length">
    <nav class="sidenav__nav">
      <a
        v-for="item in navItems"
        :key="item.id"
        :href="item.path"
        class="sidenav__link"
      >
        <span class="sidenav__marker">›</span>
        <span class="sidenav__label">{{ item.label }}</span>
      </a>
    </nav>
  </aside>
</template>

<style scoped>
.sidenav {
  width: var(--sidebar-w);
  flex-shrink: 0;
  padding: var(--space-12) var(--space-6);
  position: sticky;
  top: var(--header-h);
  height: calc(100vh - var(--header-h));
  overflow-y: auto;
  border-right: 1px solid var(--border-2);
  background: var(--bg-1);
}

.sidenav__nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sidenav__link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-3);
  text-decoration: none;
  border-radius: var(--radius-md);
  transition: all var(--duration-fast) var(--ease-out);
}

.sidenav__link:hover {
  color: var(--text-1);
  background: var(--bg-3);
  text-decoration: none;
}

.sidenav__marker {
  color: var(--text-4);
  font-size: var(--text-lg);
  line-height: 1;
  transition: transform var(--duration-fast) var(--ease-out);
}

.sidenav__link:hover .sidenav__marker {
  transform: translateX(2px);
  color: var(--cyan);
}

@media (max-width: 768px) {
  .sidenav {
    display: none;
  }
}
</style>
