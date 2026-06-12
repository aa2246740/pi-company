<script setup lang="ts">
/**
 * App.vue — 根组件
 */
import AppHeader from '@/components/layout/AppHeader.vue'
</script>

<template>
  <div class="app grid-bg">
    <AppHeader />
    <div class="app__main">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
}

.app__main {
  min-height: 100vh;
  padding-top: var(--header-h);
}
</style>
