/**
 * 导航结构 — 基于 PM 信息架构规划
 */

export interface NavItem {
  id: string
  label: string
  path: string
  icon?: string
  children?: NavItem[]
}

export const mainNav: NavItem[] = [
  { id: 'home',       label: '首页',     path: '/',              icon: '⌂' },
  { id: 'quickstart', label: '快速开始', path: '/quickstart',    icon: '▶' },
  { id: 'concepts',   label: '核心概念', path: '/concepts',      icon: '◇' },
  { id: 'workflows',  label: '工作流',   path: '/workflows',     icon: '→' },
  { id: 'config',     label: '配置',     path: '/config',        icon: '⚙' },
  { id: 'tutorials',  label: '交互教程', path: '/tutorials',     icon: '◈' },
  { id: 'reference',  label: '参考',     path: '/reference',     icon: '☰' },
  { id: 'about',      label: '关于',     path: '/about',         icon: '◆' },
]

/** 侧边栏子导航 */
export const sidebarNav: Record<string, NavItem[]> = {
  quickstart: [
    { id: 'install',  label: '安装与初始化', path: '/quickstart#install' },
    { id: 'launch-lead', label: '启动 Lead', path: '/quickstart#launch-lead' },
    { id: 'launch-workers', label: '启动工作者', path: '/quickstart#launch-workers' },
  ],
  concepts: [
    { id: 'roles',    label: '角色与职责',   path: '/concepts#roles' },
    { id: 'state',    label: '本地状态与事件', path: '/concepts#state' },
    { id: 'mailbox',  label: '邮箱与唤醒',   path: '/concepts#mailbox' },
    { id: 'truth',    label: 'Lead 真相',    path: '/concepts#truth' },
  ],
  workflows: [
    { id: 'steering',    label: '人类引导',       path: '/workflows#steering' },
    { id: 'issues',      label: '问题与任务',     path: '/workflows#issues' },
    { id: 'worktrees',   label: 'Coder 工作树',   path: '/workflows#worktrees' },
    { id: 'pr-flow',     label: '本地 PR 流程',   path: '/workflows#pr-flow' },
    { id: 'review',      label: '审查、测试与验收', path: '/workflows#review' },
    { id: 'merge-gates', label: '合并门控',       path: '/workflows#merge-gates' },
  ],
  config: [
    { id: 'model-policy',  label: '角色模型策略',   path: '/config#model-policy' },
    { id: 'rate-limits',   label: '速率限制与恢复', path: '/config#rate-limits' },
    { id: 'cmux',          label: 'cmux 集成',     path: '/config#cmux' },
  ],
  tutorials: [
    { id: 'tut-concept',    label: '1. 概念之旅',           path: '/tutorials#concept-map' },
    { id: 'tut-init',       label: '2. 初始化公司',         path: '/tutorials#init-company' },
    { id: 'tut-launch',     label: '3. 启动 Agent',         path: '/tutorials#launch-agents' },
    { id: 'tut-models',     label: '4. 配置角色模型',       path: '/tutorials#model-config' },
    { id: 'tut-steering',   label: '5. 人类引导',           path: '/tutorials#human-steering' },
    { id: 'tut-mailbox',    label: '6. 邮箱与唤醒',         path: '/tutorials#mailbox-wake' },
    { id: 'tut-issues',     label: '7. 问题与任务',         path: '/tutorials#issues-tasks' },
    { id: 'tut-worktrees',  label: '8. Coder 工作树',       path: '/tutorials#coder-worktrees' },
    { id: 'tut-pr',         label: '9. 本地 PR 流程',       path: '/tutorials#local-pr' },
    { id: 'tut-review',     label: '10. 审查测试验收',      path: '/tutorials#review-test' },
    { id: 'tut-truth',      label: '11. Lead 真相',         path: '/tutorials#lead-truth' },
    { id: 'tut-gates',      label: '12. 合并门控',          path: '/tutorials#merge-gates' },
    { id: 'tut-429',        label: '13. Provider 429',      path: '/tutorials#provider-429' },
    { id: 'tut-trouble',    label: '14. 故障排查',          path: '/tutorials#troubleshooting' },
    { id: 'tut-e2e',        label: '端到端演练',            path: '/tutorials#e2e-walkthrough' },
  ],
  reference: [
    { id: 'cli-cheat',   label: 'CLI 命令速查',   path: '/reference#cli' },
    { id: 'pi-tools',    label: 'Pi 工具速查',    path: '/reference#pi-tools' },
    { id: 'extensions',  label: 'Pi 扩展命令',    path: '/reference#extensions' },
    { id: 'troubleshoot', label: '常见问题',      path: '/reference#troubleshooting' },
  ],
}
