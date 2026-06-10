import { nextTick, readonly, ref, watch } from 'vue'

export type Locale = 'en' | 'zh-CN'

const STORAGE_KEY = 'pi-company-locale'
const locale = ref<Locale>(readInitialLocale())
const textOriginals = new WeakMap<Text, string>()
let observer: MutationObserver | null = null
let pending = false

const zhToEn: Record<string, string> = {
  '首页': 'Home',
  '核心概念': 'Concepts',
  '工作流': 'Workflows',
  '配置': 'Configuration',
  '交互教程': 'Interactive Tutorials',
  '参考速查': 'Reference',
  '参考': 'Reference',
  '关于': 'About',
  'Pi 原生的本地多智能体协作运行时': 'Pi-native local multi-agent collaboration runtime',
  '让可见、可控的 Pi 智能体在一个项目中协同工作': 'Coordinate visible, steerable Pi agents inside one project.',
  'Pi 原生协作层': 'Pi-native coordination layer',
  '让多个 Pi 像一个可见的本地项目团队一样工作。': 'Run Pi agents like a visible local project team.',
  '把普通 Pi 窗口接成本地协作流程：lead 管全局真相，worker 用 mailbox 协作，coder 在独立 worktree 里并行改代码，合并必须经过 review、test 和产品验收。': 'Connect ordinary Pi panes into a local workflow: lead owns the global truth, workers coordinate through mailboxes, coders edit in isolated worktrees, and merges require review, test, and product acceptance.',
  '快速开始': 'Quick Start',
  '查看 GitHub': 'View GitHub',
  '看得见': 'Visible',
  '每个 agent 都是可见 Pi session。你可以看它做什么，必要时随时打断。': 'Every agent is a visible Pi session. You can watch it work and interrupt when needed.',
  '接得住': 'Steerable',
  '任何窗口里的人类 steering 都会同步到 lead，团队不会只听见局部指令。': 'Human steering from any pane is mirrored to lead, so the team does not only hear local instructions.',
  '合得稳': 'Gated',
  '代码走本地 PR、隔离 worktree、review、tester 验证和 PM/lead 验收。': 'Code flows through local PRs, isolated worktrees, review, tester validation, and PM/lead acceptance.',
  '为什么存在': 'Why it exists',
  '多开 Pi 很快，但项目会失去共享真相。': 'Multiple Pi panes are fast, but projects lose shared truth.',
  'pi-company 不是再造一个聊天机器人。它给可见 Pi agents 加上本地协作纪律：谁负责、做到哪一步、证据在哪里、什么时候能合并。': 'pi-company is not another chatbot. It adds local collaboration discipline to visible Pi agents: who owns the work, what is done, where the evidence is, and when a merge is allowed.',
  '多个 Pi 窗口各自理解上下文。': 'Several Pi panes each understand their own context.',
  'Lead 用本地 brief 保持一个交付真相。': 'Lead keeps one delivery truth with a local brief.',
  'Agent 说 done，但你不知道证据在哪里。': 'An agent says done, but the evidence is unclear.',
  'PR gate 记录自测、review、tester 和产品验收。': 'PR gates record self-test, review, tester validation, and product acceptance.',
  '并行改代码容易互相覆盖。': 'Parallel code edits can overwrite each other.',
  'Coder 在隔离 git worktree 里工作，再走本地 PR。': 'Coders work in isolated git worktrees, then submit local PRs.',
  '工作方式': 'How it works',
  '从一句需求，到一条可审计的本地 PR。': 'From one request to an auditable local PR.',
  '人类把目标交给 lead': 'Human gives the goal to lead',
  'Lead 创建本地 issue 并分配角色': 'Lead creates local issues and assigns roles',
  'Coder 在独立 worktree 里实现': 'Coder implements in an isolated worktree',
  'Reviewer 和 tester 分别提交证据': 'Reviewer and tester submit evidence',
  'PM 或 lead 做产品验收': 'PM or lead performs product acceptance',
  'Gates 全绿后 lead 合并': 'Lead merges after all gates are green',
  '可见接管': 'Visible takeover',
  '不是把 agent 藏进后台，而是让每个窗口都能被你 steering。': 'Agents are not hidden in the background. Every pane can still be steered by you.',
  '你可以直接对 worker 说话，也可以让 lead 分发。pi-company 会把人类 steering 镜像给 lead，让局部修正进入全局协调。': 'You can talk directly to a worker or route through lead. pi-company mirrors human steering to lead so local corrections enter global coordination.',
  '可信边界': 'Trust boundaries',
  '角色不是人设，是上下文隔离。': 'Roles are not personas. They are context boundaries.',
  '分角色的目的不是模拟公司层级，而是控制上下文污染：实现、测试、产品验收和最终合并各自留下证据。': 'Roles do not simulate a corporate hierarchy. They limit context pollution: implementation, testing, product acceptance, and final merge each leave evidence.',
  '本地安全感': 'Local safety',
  '装上之后，普通 Pi 还是普通 Pi。': 'After installation, ordinary Pi stays ordinary Pi.',
  '只有项目里存在 .pi-company 状态时，pi-company 才会接入。没有 company 的目录不会被接管，不会创建状态，也不会注册 company tools。': 'pi-company only attaches when a project already has .pi-company state. Directories without a company are not taken over, do not create state, and do not register company tools.',
  '本地优先': 'Local-first',
  '状态写在项目的 .pi-company 目录里：事件日志、mailbox、issues、PRs 和 runtime 快照。': 'State lives in the project .pi-company directory: event log, mailboxes, issues, PRs, and runtime snapshots.',
  '人类在环': 'Human in the loop',
  '你对任意 Pi session 的 steering 会镜像给 lead。你仍然能接管任何可见窗口。': 'Steering from any Pi session is mirrored to lead. You can still take over any visible pane.',
  '默认防乱': 'Disorder-resistant by default',
  '请求按 provider 限流错峰；worker 消失时写恢复快照；合并前检查 root worktree。': 'Requests are limited and staggered by provider; disappearing workers leave recovery snapshots; root worktree state is checked before merge.',
  '保护项目方向、吞吐量和集成质量。Lead 是人类的本地代理，应做出常规默认决策。': 'Protect project direction, throughput, and integration quality. Lead is the human local proxy and should make routine default decisions.',
  '不应吸收角色拥有的执行工作': 'Do not absorb execution work owned by other roles',
  '只在不可逆、昂贵、法律/安全敏感、外部合同、品牌风险或使命变更时询问人类': 'Ask the human only for irreversible, expensive, legal/security-sensitive, external-contract, brand-risk, or mission-changing decisions',
  '必须使用全局真相（company_lead_brief）而非信任 worker 散文': 'Use global truth (company_lead_brief), not worker prose',
  '信任 worker 说的 "done" 而不验证': 'Trusting a worker saying "done" without verification',
  '自己做 coder/reviewer 的工作': 'Doing coder or reviewer work inside lead context',
  '不在 merge 前检查 brief': 'Skipping the brief before merge',
  '保护用户价值、范围和验收标准。PM 可以拥有产品验收。': 'Protect user value, scope, and acceptance criteria. PM can own product acceptance.',
  '不应接受未观察到的关键用户流': 'Do not accept critical user flows that were not observed',
  '不应接受缺少重要证据的情况': 'Do not accept when important evidence is missing',
  '在关键功能未验证时就接受': 'Accepting before key behavior is verified',
  '验收标准不够具体': 'Acceptance criteria are too vague',
  '拥有跨职能未知和外部事实。其他角色可以在自己任务中研究，但 researcher 处理跨角色研究。': 'Own cross-functional unknowns and external facts. Other roles can research inside their own task, but researcher handles cross-role research.',
  '不应替代角色自己的领域研究': 'Do not replace each role own domain research',
  '研究范围过大导致延迟': 'Research scope expands until it delays delivery',
  '拥有分配任务的实现质量。代码变更工作在本地 PR 流程完成前不算完成。': 'Own implementation quality for assigned tasks. Code work is not done until the local PR flow is complete.',
  '代码变更必须走 PR 流程': 'Code changes must go through the PR flow',
  '不能用任务报告替代 PR 流程': 'Do not replace PR flow with task reports',
  '用散文 "done" 替代 PR 流程': 'Replacing PR flow with prose "done"',
  '不运行测试就标记 ready': 'Marking ready without running tests',
  '脏工作树阻塞证据': 'Dirty worktrees blocking evidence',
  '保护代码质量、正确性、可维护性、安全性、集成风险和测试质量。': 'Protect code quality, correctness, maintainability, security, integration risk, and test quality.',
  '不能把失败命令当作绿色来批准': 'Do not approve failed commands as green evidence',
  '不仔细审查就批准': 'Approving without careful review',
  '忽略测试质量问题': 'Ignoring test quality problems',
  '保护用户行为。验证验收标准、真实工作流、边界情况和回归。': 'Protect user behavior. Validate acceptance criteria, real workflows, edge cases, and regressions.',
  '不能在有隐藏问题时提交 pass': 'Do not submit pass while hiding issues',
  '提交 pass 时隐藏问题': 'Submitting pass while hiding issues',
  '只做静态阅读不验证真实行为': 'Only reading statically instead of validating real behavior',
  '实时状态面板': 'Live Status Panel',
  '每个 agent 都有可见的状态面板，一目了然': 'Each agent has a visible status panel that is easy to scan.',
  '系统架构': 'System Architecture',
  '点击角色了解职责和相关工具': 'Click a role to inspect responsibilities and related tools.',
  '角色': 'Roles',
  '系统组件': 'System Components',
  '工具：': 'Tools:',
  '核心特性': 'Core Features',
  'pi-company 的设计原则和能力': 'Design principles and capabilities in pi-company.',
  '六大角色': 'Six Core Roles',
  '每个角色有明确的职责边界': 'Each role has explicit responsibility boundaries.',
  '边界：': 'Boundaries:',
  '常见错误：': 'Common mistakes:',
  '从零到运行第一个 agent 公司，不超过 5 分钟。': 'Go from zero to your first agent company in under five minutes.',
  '前置条件': 'Prerequisites',
  '确保你已安装：': 'Make sure you have installed:',
  '安装和运行 pi-company CLI/extension': 'installs and runs the pi-company CLI/extension',
  'AI 编码助手（必需）': 'AI coding agent (required)',
  '不是 Node 服务。Node 只是运行 CLI 和 Pi extension 的环境；日常入口是在项目目录里启动带扩展的 Pi。': 'is not a Node service. Node only runs the CLI and Pi extension; daily use starts Pi with the extension inside a project directory.',
  '如果你还想在 shell 里使用辅助 CLI，再安装 npm 全局命令：': 'If you also want the helper CLI in your shell, install the global npm command:',
  '初始化公司': 'Initialize the Company',
  '进入你的项目目录，按普通习惯启动 Pi：': 'Enter your project directory and start Pi the usual way:',
  '在 Pi 里运行恢复命令：': 'Run the resume command inside Pi:',
  '会初始化或恢复当前目录的': 'initializes or resumes the current directory',
  '并把 lead 角色职责和权威 brief 注入 Pi 对话。': 'and injects lead role instructions plus the authoritative brief into the Pi conversation.',
  '查看初始化结果：': 'Check the initialized company:',
  '人在项目目录里时不需要': 'You do not need',
  '只有从别的目录管理这个项目时才写': 'when you are already inside the project. Use',
  '磁盘上发生了什么变化？': 'What changed on disk?',
  '公司配置': 'company configuration',
  '事件日志': 'event log',
  '邮箱': 'mailboxes',
  '本地 Issues': 'local issues',
  '本地 PRs': 'local PRs',
  'Provider 请求队列': 'provider request queue',
  '同时会自动创建/更新': 'It also creates or updates',
  '排除在版本控制之外。': 'from version control.',
  '启动 Lead': 'Launch Lead',
  'Lead 是公司的核心协调者，': 'Lead is the company coordinator and ',
  '必须首先启动': 'must be launched first',
  'Lead 是人类的本地代理，负责协调所有其他 agent 的工作。': 'Lead is the human local proxy and coordinates the other agents.',
  '如果你想从 shell 直接启动 lead，也可以运行': 'If you want to launch lead directly from the shell, you can also run',
  '更适合已经习惯 Pi 的用户。': 'is better for users already used to Pi.',
  '启动工作者': 'Launch Workers',
  '进入 lead Pi 后，先用自然语言告诉 lead 你要做什么。Lead 会决定需要哪些角色，并通过工具分发任务。需要新窗口时，再启动其他 agent。': 'After entering lead Pi, tell lead what you want in natural language. Lead decides which roles are needed and distributes work through tools. Start other agents when new visible panes are needed.',
  '也可以手动启动其他 agent。支持两种模式：': 'You can also launch other agents manually. Two modes are supported:',
  '手动终端': 'Manual Terminals',
  'cmux 窗格': 'cmux Panes',
  '手动终端模式': 'Manual terminal mode',
  '在单独的终端窗口中启动每个 agent：': 'Launch each agent in a separate terminal window:',
  'cmux 窗格模式': 'cmux pane mode',
  'cmux 自动创建和管理窗格：': 'cmux creates and manages panes automatically:',
  'cmux 是可选的。没有 cmux 也可以手动创建终端窗口并粘贴启动命令。': 'cmux is optional. Without cmux, manually create terminal windows and paste launch commands.',
  '下一步': 'Next Steps',
  '了解角色、邮箱和 Lead 真相': 'Learn roles, mailboxes, and Lead truth.',
  'Issues、PR 流程和合并门控': 'Issues, local PR flow, and merge gates.',
  '通过模拟器学习每个功能': 'Learn each feature through simulators.',
  '理解 pi-company 的基础架构和运行原理。': 'Understand pi-company architecture and operating model.',
  '角色与职责': 'Roles and Responsibilities',
  'pi-company 有 6 个核心角色，每个角色有明确的职责边界。': 'pi-company has six core roles, each with explicit boundaries.',
  '职责': 'Responsibility',
  '边界': 'Boundaries',
  '常见错误': 'Common Mistakes',
  '本地状态与事件': 'Local State and Events',
  'pi-company 的所有状态存储在项目本地的': 'All pi-company state is stored locally in the project',
  '目录中。': 'directory.',
  '事件日志 + Reducer 模式': 'Event Log + Reducer Pattern',
  '审计完整的历史变更': 'audit the full change history',
  '在状态损坏时重建': 'rebuild state after corruption',
  '理解每个决策的因果链': 'understand the causal chain behind each decision',
  '邮箱与唤醒': 'Mailbox and Wake Policy',
  'Agent 之间通过邮箱消息通信。消息的唤醒策略决定了是否立即唤醒目标 agent。': 'Agents communicate through mailbox messages. The wake policy decides whether to wake the target agent immediately.',
  '消息类型': 'Message Type',
  '唤醒策略': 'Wake Policy',
  '始终唤醒 lead': 'always wakes lead',
  '可立即唤醒': 'can wake immediately',
  '默认 digest（批量处理）': 'digest by default',
  '冷却机制': 'Cooldowns',
  '同一 agent 唤醒间隔：': 'Same-agent wake spacing:',
  '每 agent 每分钟：': 'Per agent per minute:',
  '全公司每分钟：': 'Company-wide per minute:',
  'Lead 真相': 'Lead Truth',
  '这是 pi-company 最重要的概念之一：': 'This is one of pi-company most important concepts:',
  '唯一的全局真相来源。': 'the single global source of truth.',
  '代码已实现，PR 已创建并标记 ready。所有测试通过。可以合并了。': 'The code is implemented, the PR is ready, and all tests pass. It can be merged.',
  '不能': 'must not',
  'pi-company 的核心协作流程，从人类需求到代码合并。': 'The core collaboration flow from human intent to merged code.',
  '人类引导': 'Human Steering',
  '自动镜像到 lead': 'automatically mirrored to lead',
  '模拟演示：人类引导': 'Simulation: human steering',
  '输入引导消息...': 'Type steering message...',
  '发送': 'Send',
  '不应重复': 'should not repeat',
  '问题与任务': 'Issues and Tasks',
  'Lead 创建 issue 并分配给 owner。只有分配的 owner 能更新任务状态。': 'Lead creates issues and assigns an owner. Only the owner can update task state.',
  '任务状态流转': 'Task State Flow',
  'Coder 工作树': 'Coder Worktrees',
  '隔离的 git 工作树': 'isolated git worktree',
  '本地 PR 流程': 'Local PR Flow',
  '代码变更必须通过 PR 流程完成。不能用散文 "done" 替代。': 'Code changes must go through the PR flow. Prose "done" is not a substitute.',
  '创建 PR': 'Create PR',
  '自测': 'Self-test',
  '标记 Ready': 'Mark Ready',
  '审查': 'Review',
  '测试': 'Test',
  '验收': 'Acceptance',
  '合并': 'Merge',
  '记录自动化测试': 'Record automated tests',
  '审查、测试与验收': 'Review, Test, and Acceptance',
  '三个独立的质量关卡：': 'Three independent quality gates:',
  'Reviewer 审查': 'Reviewer Review',
  'Tester 验证': 'Tester Validation',
  'PM/Lead 验收': 'PM/Lead Acceptance',
  '产品级别验收': 'product-level acceptance',
  '角色模型策略': 'Role Model Policy',
  'Lead 可以为不同角色或 agent 配置不同的 AI 模型。': 'Lead can configure different AI models for different roles or named agents.',
  '配置目标': 'Configuration Targets',
  '速率限制与恢复': 'Rate Limits and Recovery',
  'pi-company 有内置的 provider 请求门控来减少过载失败。': 'pi-company includes provider request gates to reduce provider overload failures.',
  '最大并发': 'Max Concurrent',
  '启动间隔': 'Start Spacing',
  '首次退避': 'First Backoff',
  '最大退避': 'Max Backoff',
  '请求/provider': 'requests/provider',
  '同 provider': 'same provider',
  '过载后': 'after provider overload',
  'Provider 请求门控减少过载失败': 'Provider request gates reduce overload failures',
  '报告 provider 过载/配额压力': 'report provider overload/quota pressure',
  '扫描可见 cmux pi-company 表面的 provider 过载提示': 'scan visible cmux pi-company surfaces for provider overload signals',
  '反复 provider overload 或 quota exhausted': 'repeated provider overload or quota exhausted',
  'Provider 过载': 'Provider Overload',
  '13. Provider 过载': '13. Provider Overload',
  '13. Provider 过载与恢复': '13. Provider Overload and Recovery',
  '模拟 provider 请求队列。最多 3 个并发请求；过载会触发退避冷却。': 'Simulate the provider request queue. At most three concurrent requests; overload triggers backoff cooldown.',
  '并发请求：': 'Concurrent requests:',
  '退避级别：': 'Backoff level:',
  '冷却中：': 'Cooling down:',
  '队列可用': 'queue available',
  '发送请求': 'Send request',
  '重置': 'Reset',
  '首次过载：': 'First overload:',
  '上限': 'cap',
  '恢复顺序': 'Recovery Order',
  'cmux 集成': 'cmux Integration',
  '有 cmux': 'With cmux',
  '无 cmux': 'Without cmux',
  '自动创建窗格': 'creates panes automatically',
  '可视化管理': 'visible pane management',
  '一键启动多个 agent': 'launch multiple agents quickly',
  '手动创建终端窗口': 'create terminal windows manually',
  '粘贴启动命令': 'paste launch commands',
  '完全一样可用': 'same runtime behavior',
  '重要：': 'Important:',
  'CLI 命令速查': 'CLI Command Reference',
  '主要用于初始化、启动和运维。日常协作发生在加载了 pi-company extension 的 Pi 会话里。': 'is mainly for initialization, launch, and operations. Daily collaboration happens inside Pi sessions loaded with the pi-company extension.',
  '默认姿势：': 'Default usage:',
  '后直接运行这些命令。只有从别的目录管理项目时，才在命令前加': 'then run these commands directly. Only add',
  '从别的目录管理项目时，才在命令前加': 'when operating on a project from another directory.',
  '命令': 'Command',
  '说明': 'Description',
  'Pi 工具速查': 'Pi Tool Reference',
  'Pi 会话中注册的工具函数。': 'Tools registered in Pi sessions.',
  'Pi 扩展命令': 'Pi Extension Commands',
  '在加载了 pi-company 扩展的 Pi 会话中可用的命令。': 'Commands available in Pi sessions loaded with the pi-company extension.',
  '在裸 Pi 会话中恢复/启动 pi-company 上下文': 'Resume/start pi-company context in a plain Pi session.',
  '的别名': 'alias',
  '常见问题': 'Troubleshooting',
  '诊断：': 'Diagnosis:',
  '解决：': 'Fix:',
  '源代码：': 'Source:',
  '技术栈': 'Tech Stack',
  '前端框架': 'Frontend framework',
  '构建工具': 'Build tool',
  '路由': 'Routing',
  '样式': 'Styling',
  '设计理念': 'Design Principles',
  '复古未来 TUI': 'Retro-future TUI',
  '终端风格界面，CRT 荧光色系': 'terminal-like UI with CRT phosphor colors',
  '文档即产品': 'Docs as product',
  '第一屏就是可用的文档体验': 'the first screen is the usable docs experience',
  '交互教学': 'Interactive teaching',
  '模拟器和交互组件，不是纯文字': 'simulators and interactive widgets, not only prose',
  '事实准确': 'Fact accuracy',
  '所有内容基于 pi-company-facts.md': 'all content is based on pi-company-facts.md',
  '通过模拟器和交互组件学习 pi-company 的每个功能。所有模拟器已标注为': 'Learn pi-company features through simulators and interactive components. Simulators are marked as',
  '模拟演示': 'simulation',
  '端到端演练': 'End-to-End Walkthrough',
  '从人类提出需求到最终合并的完整流程。': 'The full flow from human request to final merge.',
  '已复制': 'Copied',
  '复制命令': 'Copy command',
  '复制': 'Copy',
}

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return saved === 'zh-CN' || saved === 'en' ? saved : 'en'
}

export function useLocale() {
  return {
    locale: readonly(locale),
    setLocale,
    toggleLocale,
  }
}

export function setLocale(nextLocale: Locale) {
  locale.value = nextLocale
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, nextLocale)
  }
}

export function toggleLocale() {
  setLocale(locale.value === 'en' ? 'zh-CN' : 'en')
}

export function installRuntimeI18n() {
  if (typeof window === 'undefined') return
  observer?.disconnect()
  applyLocale()
  queueApplyLocale()

  observer = new MutationObserver(() => {
    queueApplyLocale()
  })

  observer.observe(document.body, { attributes: true, characterData: true, childList: true, subtree: true })

  watch(locale, () => {
    nextTick(() => applyLocale())
  })
}

export function stopRuntimeI18n() {
  observer?.disconnect()
  observer = null
}

function applyLocale() {
  document.documentElement.lang = locale.value === 'en' ? 'en' : 'zh-CN'
  translateTextNodes(document.body)
  translateAttributes(document.body)
}

function queueApplyLocale() {
  if (pending) return
  pending = true
  window.requestAnimationFrame(() => {
    pending = false
    applyLocale()
  })
  window.setTimeout(() => applyLocale(), 0)
  window.setTimeout(() => applyLocale(), 100)
}

function translateTextNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)

  for (const node of nodes) {
    const parent = node.parentElement
    if (!parent || parent.closest('[data-no-i18n]') || parent.closest('script, style')) continue

    const original = textOriginals.get(node) ?? node.nodeValue ?? ''
    textOriginals.set(node, original)
    const nextValue = locale.value === 'en' ? translate(original) : original
    if (node.nodeValue !== nextValue) node.nodeValue = nextValue
  }
}

function translateAttributes(root: HTMLElement) {
  const elements = root.querySelectorAll<HTMLElement>('[placeholder], [aria-label], [title]')
  for (const element of elements) {
    translateAttribute(element, 'placeholder')
    translateAttribute(element, 'aria-label')
    translateAttribute(element, 'title')
  }
}

function translateAttribute(element: HTMLElement, attribute: string) {
  const value = element.getAttribute(attribute)
  if (!value) return

  const key = `i18nOriginal${attribute.replace(/(^|-)([a-z])/g, (_, __, char) => char.toUpperCase())}`
  const dataset = element.dataset as Record<string, string | undefined>
  const original = dataset[key] ?? value
  dataset[key] = original
  const nextValue = locale.value === 'en' ? translate(original) : original
  if (value !== nextValue) element.setAttribute(attribute, nextValue)
}

function translate(input: string): string {
  let output = input
  for (const [zh, en] of Object.entries(zhToEn)) {
    output = output.replaceAll(zh, en)
  }
  return output
}
