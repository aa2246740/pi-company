<script setup lang="ts">
/**
 * AppHeader — 顶部导航栏
 * 清晰、简洁、精致
 */
import { ref } from 'vue'
import { mainNav } from '@/data/navigation'
import { productSummary } from '@/data/facts'
import { useLocale } from '@/i18n/runtime'

const mobileMenuOpen = ref(false)
const { locale, toggleLocale } = useLocale()

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}
</script>

<template>
  <header class="header">
    <div class="header__inner">
      <router-link to="/" class="header__logo" @click="closeMobileMenu">
        <span class="header__logo-icon font-pixel">◈</span>
        <span class="header__logo-text">{{ productSummary.name }}</span>
      </router-link>

      <nav class="header__nav">
        <router-link
          v-for="item in mainNav"
          :key="item.id"
          :to="item.path"
          class="header__link"
          active-class="header__link--active"
        >
          {{ item.label }}
        </router-link>
      </nav>

      <div class="header__actions">
        <span class="header__status">
          <span class="status-dot status-dot--online"></span>
          <span class="header__status-text">docs v1.0</span>
        </span>

        <button
          class="header__lang"
          type="button"
          :aria-label="locale === 'en' ? '切换到中文' : 'Switch to English'"
          @click="toggleLocale"
        >
          {{ locale === 'en' ? '中文' : 'EN' }}
        </button>

        <button
          class="header__menu-btn"
          @click="toggleMobileMenu"
          :aria-label="mobileMenuOpen ? '关闭菜单' : '打开菜单'"
          :aria-expanded="mobileMenuOpen"
        >
          <span class="header__menu-icon" :class="{ 'header__menu-icon--open': mobileMenuOpen }">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
      </div>
    </div>

    <!-- 移动端菜单 -->
    <Transition name="menu">
      <div v-if="mobileMenuOpen" class="mobile-menu">
        <nav class="mobile-menu__nav">
          <button class="mobile-menu__lang" type="button" @click="toggleLocale">
            {{ locale === 'en' ? '切换到中文' : 'Switch to English' }}
          </button>

          <router-link
            v-for="item in mainNav"
            :key="item.id"
            :to="item.path"
            class="mobile-menu__link"
            active-class="mobile-menu__link--active"
            @click="closeMobileMenu"
          >
            <span class="mobile-menu__icon">{{ item.icon }}</span>
            <span class="mobile-menu__label">{{ item.label }}</span>
          </router-link>
        </nav>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-h);
  background: rgba(14, 14, 14, 0.95);
  border-bottom: 1px solid var(--border-2);
  z-index: 100;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  max-width: var(--page-max);
  margin: 0 auto;
  padding: 0 var(--space-8);
}

.header__logo {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  text-decoration: none;
  font-weight: 700;
  font-size: var(--text-xl);
  color: var(--green);
  flex-shrink: 0;
}

.header__logo:hover {
  text-decoration: none;
  color: var(--green);
}

.header__logo-icon {
  font-size: var(--text-2xl);
  line-height: 1;
}

.header__logo-text {
  font-family: var(--font-sans);
  letter-spacing: -0.01em;
}

.header__nav {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.header__link {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-3);
  text-decoration: none;
  border-radius: var(--radius-md);
  transition: all var(--duration-fast) var(--ease-out);
}

.header__link:hover {
  color: var(--text-1);
  background: var(--bg-4);
  text-decoration: none;
}

.header__link--active {
  color: var(--text-1);
  background: var(--bg-4);
}

.header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.header__status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-4);
}

.header__status-text {
  display: none;
}

.header__lang {
  min-width: 52px;
  height: 34px;
  padding: 0 var(--space-3);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--green);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
}

.header__lang:hover {
  border-color: var(--green);
}

@media (min-width: 768px) {
  .header__status-text {
    display: inline;
  }
}

/* ── Hamburger Button ── */
.header__menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.header__menu-icon {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 20px;
}

.header__menu-icon span {
  display: block;
  height: 2px;
  background: var(--text-2);
  border-radius: 1px;
  transition: all var(--duration-fast) var(--ease-out);
  transform-origin: center;
}

.header__menu-icon--open span:first-child {
  transform: rotate(45deg) translate(5px, 5px);
}

.header__menu-icon--open span:nth-child(2) {
  opacity: 0;
}

.header__menu-icon--open span:last-child {
  transform: rotate(-45deg) translate(5px, -5px);
}

/* ── Mobile Menu ── */
.mobile-menu {
  position: fixed;
  top: var(--header-h);
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-1);
  border-top: 1px solid var(--border-2);
  z-index: 99;
  overflow-y: auto;
}

.mobile-menu__nav {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  gap: var(--space-2);
}

.mobile-menu__lang {
  align-self: flex-start;
  padding: var(--space-2) var(--space-4);
  margin-bottom: var(--space-2);
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--green);
  font-family: var(--font-mono);
}

.mobile-menu__link {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-2);
  text-decoration: none;
  border-radius: var(--radius-lg);
  transition: all var(--duration-fast) var(--ease-out);
}

.mobile-menu__link:hover {
  color: var(--text-1);
  background: var(--bg-3);
  text-decoration: none;
}

.mobile-menu__link--active {
  color: var(--green);
  background: var(--green-bg);
  border: 1px solid rgba(0, 255, 65, 0.2);
}

.mobile-menu__icon {
  font-size: var(--text-lg);
  width: 24px;
  text-align: center;
}

.mobile-menu__label {
  flex: 1;
}

/* ── Transitions ── */
.menu-enter-active {
  transition: all var(--duration-normal) var(--ease-out);
}

.menu-leave-active {
  transition: all var(--duration-fast) var(--ease-out);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .header__nav {
    display: none;
  }

  .header__menu-btn {
    display: flex;
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu-enter-active,
  .menu-leave-active {
    transition: none;
  }

  .header__menu-icon span {
    transition: none;
  }
}
</style>
