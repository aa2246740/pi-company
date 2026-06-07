/**
 * pi-company 结构化数据
 * 严格基于 docs/pi-company-facts.md，不得编造功能
 */

/** 产品摘要 */
export const productSummary = {
  name: 'pi-company',
  tagline: 'Pi 原生的本地多智能体协作运行时',
  description: '让可见、可控的 Pi 智能体在一个项目中协同工作',
  coreWorkflow: 'human → lead → local issues → coder worktrees → local PR → reviewer + tester → PM/lead acceptance → gates → lead merge',
  scope: [
    'Pi 必需',
    '本地单机运行时',
    '每个公司一个项目',
    '项目级 `.pi-company/` 状态',
    '事件日志 + reducer + 邮箱文件',
    '本地 issues 和 PR 门控',
    '独立 coder 工作树并行编辑',
    '人类引导自动镜像到 lead',
    '组织级速率限制退避和交错恢复',
    'Provider 请求门控减少 429',
    '可选 cmux 启动适配器',
  ],
}

/** 角色定义 */
export interface Role {
  id: string
  name: string
  icon: string
  color: string
  responsibility: string
  boundaries: string[]
  commonMistakes: string[]
}

export const roles: Role[] = [
  {
    id: 'lead',
    name: 'Lead',
    icon: '◆',
    color: 'var(--phosphor-green)',
    responsibility: '保护项目方向、吞吐量和集成质量。Lead 是人类的本地代理，应做出常规默认决策。',
    boundaries: [
      '不应吸收角色拥有的执行工作',
      '只在不可逆、昂贵、法律/安全敏感、外部合同、品牌风险或使命变更时询问人类',
      '必须使用全局真相（company_lead_brief）而非信任 worker 散文',
    ],
    commonMistakes: [
      '信任 worker 说的 "done" 而不验证',
      '自己做 coder/reviewer 的工作',
      '不在 merge 前检查 brief',
    ],
  },
  {
    id: 'pm',
    name: 'PM',
    icon: '◇',
    color: 'var(--warm-amber)',
    responsibility: '保护用户价值、范围和验收标准。PM 可以拥有产品验收。',
    boundaries: [
      '不应接受未观察到的关键用户流',
      '不应接受缺少重要证据的情况',
    ],
    commonMistakes: [
      '在关键功能未验证时就接受',
      '验收标准不够具体',
    ],
  },
  {
    id: 'researcher',
    name: 'Researcher',
    icon: '◈',
    color: 'var(--magenta)',
    responsibility: '拥有跨职能未知和外部事实。其他角色可以在自己任务中研究，但 researcher 处理跨角色研究。',
    boundaries: [
      '不应替代角色自己的领域研究',
    ],
    commonMistakes: [
      '研究范围过大导致延迟',
    ],
  },
  {
    id: 'coder',
    name: 'Coder',
    icon: '▶',
    color: 'var(--cyan)',
    responsibility: '拥有分配任务的实现质量。代码变更工作在本地 PR 流程完成前不算完成。',
    boundaries: [
      '代码变更必须走 PR 流程',
      '不能用任务报告替代 PR 流程',
    ],
    commonMistakes: [
      '用散文 "done" 替代 PR 流程',
      '不运行测试就标记 ready',
      '脏工作树阻塞证据',
    ],
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    icon: '✦',
    color: 'var(--cyan-dim)',
    responsibility: '保护代码质量、正确性、可维护性、安全性、集成风险和测试质量。',
    boundaries: [
      '不能把失败命令当作绿色来批准',
    ],
    commonMistakes: [
      '不仔细审查就批准',
      '忽略测试质量问题',
    ],
  },
  {
    id: 'tester',
    name: 'Tester',
    icon: '◆',
    color: 'var(--warm-amber)',
    responsibility: '保护用户行为。验证验收标准、真实工作流、边界情况和回归。',
    boundaries: [
      '不能在有隐藏问题时提交 pass',
    ],
    commonMistakes: [
      '提交 pass 时隐藏问题',
      '只做静态阅读不验证真实行为',
    ],
  },
]

/** CLI 命令 */
export interface CliCommand {
  command: string
  description: string
  example: string
  category: string
}

export const cliCommands: CliCommand[] = [
  {
    command: 'pi-company init --id <id>',
    description: '初始化 .pi-company 目录',
    example: 'pi-company init --id tarot-draw',
    category: '初始化',
  },
  {
    command: 'pi-company status',
    description: '显示 agents、issues、PRs、待合并项和速率限制状态',
    example: 'pi-company status',
    category: '状态',
  },
  {
    command: 'pi-company brief',
    description: '显示 lead 的权威全局交付摘要',
    example: 'pi-company brief',
    category: '状态',
  },
  {
    command: 'pi-company reduce',
    description: '从事件重建状态和渲染的 issue/PR 快照',
    example: 'pi-company reduce',
    category: '状态',
  },
  {
    command: 'pi-company launch-command <agent>',
    description: '打印启动已有 agent 的命令',
    example: 'pi-company launch-command lead',
    category: '启动',
  },
  {
    command: 'pi-company spawn <role>',
    description: '规划或启动 agent',
    example: 'pi-company spawn tester --manual',
    category: '启动',
  },
  {
    command: 'pi-company spawn coder --name <name> --yes --cmux',
    description: '启动带隔离工作树的 coder',
    example: 'pi-company spawn coder --name coder-ui --yes --cmux',
    category: '启动',
  },
  {
    command: 'pi-company steer',
    description: '为 agent 记录人类引导并镜像到 lead',
    example: 'pi-company steer --to coder --text "Keep the UI minimal"',
    category: '消息',
  },
  {
    command: 'pi-company inbox',
    description: '显示或确认邮箱消息',
    example: 'pi-company inbox',
    category: '消息',
  },
  {
    command: 'pi-company issue',
    description: '管理本地 issues',
    example: 'pi-company issue create --title "Build UI"',
    category: 'Issues',
  },
  {
    command: 'pi-company task',
    description: '记录任务进度',
    example: 'pi-company task start --issue ISSUE-001',
    category: 'Issues',
  },
  {
    command: 'pi-company pr',
    description: '管理本地 PRs',
    example: 'pi-company pr create --title "feat: add UI"',
    category: 'PR',
  },
  {
    command: 'pi-company message',
    description: '发送邮箱消息',
    example: 'pi-company message --from lead --to coder --type assignment --text "Start now"',
    category: '消息',
  },
  {
    command: 'pi-company rate-limit --actor <agent> --reason <reason>',
    description: '报告 provider 429/配额压力',
    example: 'pi-company rate-limit --actor tester --reason "provider overload"',
    category: '速率限制',
  },
  {
    command: 'pi-company rate-limit-clear',
    description: '清除已验证的误报退避',
    example: 'pi-company rate-limit-clear',
    category: '速率限制',
  },
  {
    command: 'pi-company cmux-rate-limit-scan',
    description: '扫描可见 cmux pi-company 表面的 429',
    example: 'pi-company cmux-rate-limit-scan --workspace workspace:16',
    category: '速率限制',
  },
  {
    command: 'pi-company cmux-status',
    description: '设置 cmux 侧边栏状态',
    example: 'pi-company cmux-status',
    category: 'cmux',
  },
]

/** Pi 扩展命令 */
export const extensionCommands = [
  { command: '/company-init', description: '在当前 Pi session 里初始化 .pi-company 并接入 lead' },
  { command: '/company-start', description: '手动刷新角色职责和 lead brief 到当前 Pi 对话' },
  { command: '/company-resume', description: '/company-start 的兼容别名' },
  { command: '/company-status', description: '刷新并显示 pi-company 面板' },
  { command: '/company-brief', description: '注入权威的 lead/全局交付摘要' },
  { command: '/company-inbox', description: '注入未读邮箱消息' },
  { command: '/company-ack', description: '确认未读邮箱消息（不注入）' },
  { command: '/company-send <agent> <text>', description: '发送 pi-company 消息' },
  { command: '/company-configure-models', description: '配置角色或 agent 的 Pi 模型策略' },
]

/** Pi 工具 */
export const piTools = [
  { name: 'company_status', description: '读取本地 pi-company 状态' },
  { name: 'company_lead_brief', description: '读取权威全局交付摘要' },
  { name: 'company_inbox', description: '读取或确认邮箱消息' },
  { name: 'company_report_rate_limit', description: '报告 provider 429/配额压力' },
  { name: 'company_clear_rate_limit', description: '清除误报退避（仅 lead）' },
  { name: 'company_configure_model_policy', description: '配置角色/agent 模型策略' },
  { name: 'company_send_message', description: '发送邮箱消息给另一个 agent' },
  { name: 'company_create_issue', description: '创建本地 issue' },
  { name: 'company_assign_issue', description: '分配 issue 给 agent' },
  { name: 'company_task_update', description: '记录任务进度' },
  { name: 'company_spawn_agent', description: '创建或启动角色 agent' },
  { name: 'company_create_pr', description: '为 coder 分支创建工作树创建本地 PR' },
  { name: 'company_mark_pr_ready', description: '标记 PR ready 并附带自测证据和测试摘要' },
  { name: 'company_submit_review', description: '提交 reviewer 审批/评论/请求变更' },
  { name: 'company_submit_test', description: '提交独立 tester 验证' },
  { name: 'company_submit_acceptance', description: '提交 PM/lead 产品验收' },
  { name: 'company_record_auto_tests', description: '记录自动化测试命令结果' },
  { name: 'company_pr_gates', description: '检查本地 PR 是否可合并' },
  { name: 'company_merge_pr', description: '请求或执行门控的本地 PR 合并' },
]

/** PR 门控条件 */
export const prGates = [
  { id: 'author',         label: 'PR 作者是已有 coder agent',           required: true },
  { id: 'owner',          label: 'Issue 绑定 PR 由分配的 owner 创建',   required: true },
  { id: 'self-test',      label: 'Coder 自测证据存在',                  required: true },
  { id: 'test-brief',     label: '测试摘要存在',                        required: true },
  { id: 'auto-tests',     label: '自动化测试已通过',                    required: true },
  { id: 'reviewer',       label: '独立 reviewer 审批存在',              required: true },
  { id: 'tester',         label: '独立 tester 验证通过',                required: true },
  { id: 'acceptance',     label: 'PM/lead 产品验收接受',                required: true },
  { id: 'branch',         label: 'PR 分支解析到 git commit',            required: true },
  { id: 'merge-clean',    label: 'PR 分支可干净合并到 base',            required: true },
  { id: 'no-caveats',     label: 'Pass/approve 摘要无 caveats',         required: true },
  { id: 'root-clean',     label: 'Root 无 tracked/staged 变更',         required: true },
]

/** 速率限制策略 */
export const rateLimitPolicy = {
  maxConcurrent: 3,
  startSpacing: '5 秒',
  firstBackoff: '60 秒',
  secondBackoff: '120 秒',
  maxBackoff: '10 分钟',
  quotaExhaustion: '至少 10 分钟',
  recoveryOrder: 'Lead 先恢复，worker 交错恢复',
}

/** 消息唤醒策略 */
export const wakePolicy = {
  humanSteering: '始终唤醒 lead',
  assignments: '可立即唤醒',
  reviewRequests: '可立即唤醒',
  testRequests: '可立即唤醒',
  systemMessages: '可立即唤醒',
  ordinaryReports: '默认 digest',
  cooldown: '10 秒',
  perAgentLimit: '每 agent 每分钟 6 次立即唤醒',
  perCompanyLimit: '全公司每分钟 12 次立即唤醒',
}

/** 常见故障 */
export const troubleshooting = [
  {
    symptom: 'Agent 说 done 但 PR 被阻塞',
    diagnosis: 'Worker 散文不可信，检查 company_lead_brief',
    solution: '运行 company_pr_gates 查看哪些门控未通过',
  },
  {
    symptom: '过期的 self-test 或 review',
    diagnosis: 'PR 分支 HEAD 已变更，之前证据失效',
    solution: '重新运行测试、重新标记 ready、重新请求 review',
  },
  {
    symptom: '脏 coder 工作树',
    diagnosis: 'Coder 工作树有未提交更改',
    solution: '在工作树中 commit 或 stash 更改',
  },
  {
    symptom: '脏 root 阻塞合并',
    diagnosis: 'Root 有 tracked/staged 变更',
    solution: 'Lead 不能用 git stash/reset 清理，必须有意解决',
  },
  {
    symptom: 'cmux 启动命令被粘贴为聊天',
    diagnosis: '重启 Pi TUI 时直接发送命令',
    solution: '先停止 pi 进程，返回 shell，再运行启动命令',
  },
  {
    symptom: '反复 429 或 quota exhausted',
    diagnosis: 'Provider 压力过大',
    solution: '使用 rate-limit 报告，等待退避恢复，或切换模型/提供商',
  },
]
