/**
 * 教程组件测试
 * 验证教程组件的基本渲染和交互
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

// 导入教程组件
import ConceptMapTutorial from '../components/tutorial/ConceptMapTutorial.vue'
import InitCompanyTutorial from '../components/tutorial/InitCompanyTutorial.vue'
import LaunchAgentsTutorial from '../components/tutorial/LaunchAgentsTutorial.vue'
import ModelConfigTutorial from '../components/tutorial/ModelConfigTutorial.vue'
import HumanSteeringTutorial from '../components/tutorial/HumanSteeringTutorial.vue'
import MailboxWakeTutorial from '../components/tutorial/MailboxWakeTutorial.vue'
import IssuesTasksTutorial from '../components/tutorial/IssuesTasksTutorial.vue'
import CoderWorktreesTutorial from '../components/tutorial/CoderWorktreesTutorial.vue'
import PRTutorial from '../components/tutorial/PRTutorial.vue'
import ReviewTestTutorial from '../components/tutorial/ReviewTestTutorial.vue'
import LeadTruthTutorial from '../components/tutorial/LeadTruthTutorial.vue'
import MergeGateTutorial from '../components/tutorial/MergeGateTutorial.vue'
import Provider429Tutorial from '../components/tutorial/Provider429Tutorial.vue'
import TroubleshootingTutorial from '../components/tutorial/TroubleshootingTutorial.vue'

// 创建测试路由器
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }],
})

// 通用挂载辅助函数
function mountWithRouter(component: any) {
  return mount(component, {
    global: {
      plugins: [router],
    },
  })
}

describe('Tutorial Components', () => {
  describe('ConceptMapTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(ConceptMapTutorial)
      expect(wrapper.find('h2').text()).toContain('概念之旅')
    })

    it('should have clickable nodes', () => {
      const wrapper = mountWithRouter(ConceptMapTutorial)
      const nodes = wrapper.findAll('.map-node')
      expect(nodes.length).toBeGreaterThan(0)
    })

    it('should show detail when node is clicked', async () => {
      const wrapper = mountWithRouter(ConceptMapTutorial)
      const firstNode = wrapper.find('.map-node')
      await firstNode.trigger('click')
      expect(wrapper.find('.map-detail').exists()).toBe(true)
    })
  })

  describe('InitCompanyTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(InitCompanyTutorial)
      expect(wrapper.find('h2').text()).toContain('初始化公司')
    })

    it('should have step indicator', () => {
      const wrapper = mountWithRouter(InitCompanyTutorial)
      expect(wrapper.findAll('.step-dot').length).toBeGreaterThan(0)
    })
  })

  describe('LaunchAgentsTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(LaunchAgentsTutorial)
      expect(wrapper.find('h2').text()).toContain('启动 Agent')
    })

    it('should have mode toggle', () => {
      const wrapper = mountWithRouter(LaunchAgentsTutorial)
      expect(wrapper.findAll('.mode-toggle button').length).toBe(2)
    })
  })

  describe('ModelConfigTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(ModelConfigTutorial)
      expect(wrapper.find('h2').text()).toContain('配置角色模型')
    })

    it('should have model selectors', () => {
      const wrapper = mountWithRouter(ModelConfigTutorial)
      expect(wrapper.findAll('select').length).toBeGreaterThan(0)
    })
  })

  describe('HumanSteeringTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(HumanSteeringTutorial)
      expect(wrapper.find('h2').text()).toContain('人类引导')
    })

    it('should have input field', () => {
      const wrapper = mountWithRouter(HumanSteeringTutorial)
      expect(wrapper.find('input').exists()).toBe(true)
    })
  })

  describe('MailboxWakeTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(MailboxWakeTutorial)
      expect(wrapper.find('h2').text()).toContain('邮箱与唤醒')
    })

    it('should have range slider', () => {
      const wrapper = mountWithRouter(MailboxWakeTutorial)
      expect(wrapper.find('input[type="range"]').exists()).toBe(true)
    })
  })

  describe('IssuesTasksTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(IssuesTasksTutorial)
      expect(wrapper.find('h2').text()).toContain('问题与任务')
    })

    it('should have create button', () => {
      const wrapper = mountWithRouter(IssuesTasksTutorial)
      expect(wrapper.find('.create-btn').exists()).toBe(true)
    })
  })

  describe('CoderWorktreesTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(CoderWorktreesTutorial)
      expect(wrapper.find('h2').text()).toContain('Coder 工作树')
    })

    it('should have dirty toggle buttons', () => {
      const wrapper = mountWithRouter(CoderWorktreesTutorial)
      expect(wrapper.findAll('.dirty-toggle').length).toBeGreaterThan(0)
    })
  })

  describe('PRTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(PRTutorial)
      expect(wrapper.find('h2').text()).toContain('本地 PR 流程')
    })

    it('should have form fields', () => {
      const wrapper = mountWithRouter(PRTutorial)
      expect(wrapper.findAll('input').length).toBeGreaterThan(0)
    })
  })

  describe('ReviewTestTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(ReviewTestTutorial)
      expect(wrapper.find('h2').text()).toContain('审查、测试与验收')
    })

    it('should have decision buttons', () => {
      const wrapper = mountWithRouter(ReviewTestTutorial)
      expect(wrapper.findAll('.decision-options button').length).toBeGreaterThan(0)
    })
  })

  describe('LeadTruthTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(LeadTruthTutorial)
      expect(wrapper.find('h2').text()).toContain('Lead 真相')
    })

    it('should show scenario', () => {
      const wrapper = mountWithRouter(LeadTruthTutorial)
      expect(wrapper.find('.truth-scenario').exists()).toBe(true)
    })
  })

  describe('MergeGateTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(MergeGateTutorial)
      expect(wrapper.find('h2').text()).toContain('合并门控')
    })

    it('should have gate buttons', () => {
      const wrapper = mountWithRouter(MergeGateTutorial)
      expect(wrapper.findAll('.gate-btn').length).toBeGreaterThan(0)
    })
  })

  describe('Provider429Tutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(Provider429Tutorial)
      expect(wrapper.find('h2').text()).toContain('Provider 过载')
    })

    it('should have send button', () => {
      const wrapper = mountWithRouter(Provider429Tutorial)
      expect(wrapper.find('.send-btn').exists()).toBe(true)
    })
  })

  describe('TroubleshootingTutorial', () => {
    it('should render title', () => {
      const wrapper = mountWithRouter(TroubleshootingTutorial)
      expect(wrapper.find('h2').text()).toContain('故障排查')
    })

    it('should have symptom buttons', () => {
      const wrapper = mountWithRouter(TroubleshootingTutorial)
      expect(wrapper.findAll('.symptom-btn').length).toBeGreaterThan(0)
    })

    it('should show diagnosis when symptom is clicked', async () => {
      const wrapper = mountWithRouter(TroubleshootingTutorial)
      const firstSymptom = wrapper.find('.symptom-btn')
      await firstSymptom.trigger('click')
      expect(wrapper.find('.diagnosis').exists()).toBe(true)
    })
  })
})
