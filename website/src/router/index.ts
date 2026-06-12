/**
 * 路由配置
 */
import { createRouter, createWebHashHistory } from 'vue-router'

const anchorOffset = 88 // var(--header-h) + var(--space-8)

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/HomePage.vue'),
    },
    {
      path: '/quickstart',
      name: 'quickstart',
      component: () => import('@/pages/QuickStartPage.vue'),
    },
    {
      path: '/concepts',
      name: 'concepts',
      component: () => import('@/pages/ConceptsPage.vue'),
    },
    {
      path: '/workflows',
      name: 'workflows',
      component: () => import('@/pages/WorkflowsPage.vue'),
    },
    {
      path: '/config',
      name: 'config',
      component: () => import('@/pages/ConfigPage.vue'),
    },
    {
      path: '/tutorials',
      name: 'tutorials',
      component: () => import('@/pages/TutorialsPage.vue'),
    },
    {
      path: '/reference',
      name: 'reference',
      component: () => import('@/pages/ReferencePage.vue'),
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('@/pages/AboutPage.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
  scrollBehavior(to) {
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth', top: anchorOffset }
    }
    return { top: 0 }
  },
})

export default router
