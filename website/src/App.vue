<script setup lang="ts">
/**
 * App.vue — 根组件
 */
import AppHeader from '@/components/layout/AppHeader.vue'
</script>

<template>
  <div class="app grid-bg">
    <AppHeader />
    <router-view />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
}
</style>
