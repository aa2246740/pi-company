# pi-company

[English](README.md) | [中文](README.zh-CN.md)

> 让多个 Pi 像一个可见的本地项目团队一样工作。

`pi-company` 把你已经打开的多个 Pi session 接成一个本地协作流程：lead 维护全局 brief，worker 通过 mailbox 协作，coder 在隔离 git worktree 里改代码，本地 PR 必须经过 review、test 和 PM/lead 产品验收才能合并。

- 源码：https://github.com/aa2246740/pi-company
- 官网：https://aa2246740.github.io/pi-company/

## 为什么要装？

如果你已经会为了一个项目开多个 Pi 窗口，`pi-company` 补上的是协作地基：

- **可见 agent，不是黑盒 subagent。** 每个 worker 仍然是普通 Pi session，你能看、能打断、能 steering。
- **一个共享项目真相。** Lead 在说“完成”前会看本地 issues、PR、gates、inbox、runtime 状态和恢复快照。
- **并行写代码但不乱。** Coder 在独立 git worktree 里改代码，必须提交本地 PR。
- **合并前有质量门禁。** Review、tester 验证、自动化检查、PM/lead 产品验收都会变成结构化证据。
- **人类 steering 会同步到 lead。** 你对任意 Pi session 说的话都会镜像给 lead，团队不容易跑偏。
- **Provider 压力会被管理。** 同 provider 请求会排队和错峰，先预防过载，再做退避恢复。

一句话：保留多 agent 的速度，同时保留人类能读懂、能接管、能审计的项目流程。

## 🏆 基准测试：OKF v3 在官方 SWE-bench 上超越单 agent

同一模型（`openai-codex/gpt-5.5`）、同一 instance、同一 base commit，由**官方 SWE-bench Verified harness** 评分。唯一差别：编排方式。

| Instance | plain 单agent | **pi-company v3** | 结果 |
|---|:---:|:---:|---|
| `django__django-13212` | ❌ 3/5 | ✅ **5/5** | **v3 胜** |
| `django__django-13128` | ✅ | ✅ | 平 |
| `sympy__sympy-18199` | ❌ 0/1 | ❌ 0/1 | 平 |
| `sympy__sympy-14248` | ❌ | ❌ | 平 |

**v3 对 plain：1 胜 3 平 0 负。Resolve 率：plain 25% → v3 50%。**
pi-company **从未低于 plain**，并把一个险胜的 near-miss 转为完全解决。

### 为什么能赢（不是运气——是机制）

`django-13212` 这次的胜利有明确的机制解释。plain 和旧版 OKF 都打 3/5——都漏了 `django/forms/fields.py`（`DecimalField` 在到达 validator 之前就拒了 `NaN`）。**pi-company v3 的合同谈判**（coder 和 tester 在写代码*之前*各自提出可测的 Done 断言）明确逼出了：

> “DecimalField 拒绝 `Decimal('NaN')` 时带 `%(value)s`……渲染为 NaN”
> “FileField……FileExtensionValidator 拒绝不允许的扩展名”

对着*点名了*这些隐藏路径的断言写代码，coder 改了 `forms/fields.py`——plain 从没碰过的文件——对抗 evaluator 再逐条验证所有字段类型。**这正是「能跑数小时的 agent」模式的核心论点落到实处：谈判出的合同把「用户故事」桥接到「可测行为」，对抗 evaluator 强制执行它。**

> 完整证据、诚实边界、逐 case 拆解：
> [`docs/okf/OKF_V3_BENCHMARK.md`](docs/okf/OKF_V3_BENCHMARK.md)

### v3 怎么工作

- **合同谈判**——写任何代码前，coder 和 tester 各自产出具体可测的「Done」断言；driver 合并写回 SprintContract。
- **对抗循环**——evaluator 按*谈判出的*断言验证；blocking finding 回传 coder；修复后重验；最多 `maxRounds` 轮，带防死循环升级到人类。

```bash
pi-company adversarial negotiate --contract <id> --agents coder=coder --agents tester=tester ...
pi-company adversarial run --contract <id> --coder coder --evaluator tester --max-rounds 3 ...
```

它是确定性 driver（不是 daemon），复用 OKF 操作层（mailbox、finding、contract、handoff、preflight、export gate），不引入新的 runtime 真相源。

## 60 秒开始

```bash
npm install -g pi-company
pi install npm:pi-company
cd ~/Documents/cmux/tarot-draw
pi
```

进入 Pi 后运行：

```text
/company-init
```

然后直接对 lead 说：

```text
我们要做塔罗抽卡网站。请判断需要哪些角色，创建 issues，分发任务，并在测试和验收通过前不要合并。
```

项目里有 `.pi-company/` 之后，在这个目录里普通启动 `pi` 就会自动接入已有 company。普通目录仍然是普通 Pi。

## 它看起来是什么流程？

```text
human -> lead -> local issues -> coder worktrees -> local PR
      -> reviewer + tester -> PM/lead acceptance -> gates -> lead merge
```

每个 company agent 都有自己的 Pi 内工作面板。agent 通过本地工具和 mailbox 消息协作。cmux 可以自动开窗，但不是必需；没有 cmux 时，你也可以把启动命令粘贴到普通终端窗口里。

## 你会得到什么？

| 能力 | 实际意义 |
| --- | --- |
| Lead brief | 在任何人说“完成”前，有一个本地权威交付真相。 |
| Human steering mirror | 你在任意 company Pi 里输入的 steering 都会到 lead。 |
| 本地 issues | Lead 把工作拆成有 owner 的任务，而不是聊天里的口头承诺。 |
| Coder worktrees | 多个 coder 并行实现，不抢同一个 checkout。 |
| 本地 PR gates | Coder ready、自动化测试、reviewer approval、tester pass、PM/lead acceptance。 |
| 恢复快照 | worker 窗口消失时，lead 看到有界终端文本，不会一直干等。 |
| Provider queue | 同 provider 请求限流错峰，减少过载错误和恢复风暴。 |
| 角色模型策略 | 不同角色可以使用不同的 Pi 已配置模型。 |
| Advisor 模式 | 快模型在高杠杆节点暂停，并在原 agent loop 内咨询一个显式配置的强模型。 |

## 它到底是什么？

它由两部分组成：

- **Pi extension/package**：启动 Pi agent 时加载，给 Pi 增加状态面板、mailbox、工具、斜杠命令和 human steering 镜像能力。
- **辅助 CLI**：用来初始化项目、打印启动命令、规划/启动 agent、查看状态、做少量运维操作。

Node 只是 CLI 和扩展代码的运行环境。日常工作不是“启动一个 Node 服务”，而是进入你的项目目录，启动带 pi-company extension 的 Pi。

## 它不是什么？

- 不是云服务。
- 不是把工作藏起来的 headless orchestrator。
- 不是 Pi 的替代品。
- 不是 cmux 专用工具。cmux 让窗格管理更方便，但 runtime 可以配合普通终端使用。
- 不是跳过 review 的理由。它的核心价值正是让多 agent 工作可审计。

## 日常用法

```bash
pi
```

进入 Pi 后：

```text
/company-init
```

`/company-init` 会创建项目本地 `.pi-company/` 状态，并把当前 Pi session 接成 `lead`。之后在这个目录里直接启动 Pi 就够了：Pi 正常恢复对话，pi-company 自动接入已有 company，显示工作面板，注册 company tools，镜像人类 steering，控制 provider 请求，并在每一轮 agent 开始前刷新角色职责和 lead brief。

如果你更喜欢 shell-first，也可以先在终端运行 `pi-company init`，再启动 Pi。

如果你想把当前角色职责和 lead brief 手动推送到可见聊天里，可以在 Pi 里运行 `/company-start`。它现在是刷新命令，不是必需的恢复步骤。

如果某个一次性 skill 或维护任务需要普通 Pi 行为，可以在当前 Pi session 里运行
`/company-pause`。它会暂停 inbox 投递和 provider gate，阻止 `company_*`
工具，关闭角色文件守卫，并注入一个很小的 pause override，让 Pi 在这个 session
里忽略之前的 company role/brief 指令。运行 `/company-resume` 可恢复 company
上下文。它是逃生口，不是日常绕过角色职责的工作流。

安装 Pi package 不等于让每个 `pi` 都变成 company session。普通目录里没有 `.pi-company/` 时，Pi 仍然是普通 Pi：pi-company 不会创建文件、不会注册 company tools、不会镜像人类输入、不会拦 provider 请求，也不会显示 company 工作面板。

然后你主要用自然语言对 lead 说需求，例如：

```text
我们要继续做塔罗抽卡网站。请检查当前状态，告诉我还需要哪些角色，然后分发任务。
```

Lead 会通过 pi-company 工具创建 issue、分配角色、让 coder/reviewer/tester/PM 协作。需要新窗口时，lead 可以调用 spawn 工具；你也可以在项目目录里手动运行：

```bash
npm install -g pi-company # 可选：安装辅助 CLI
pi-company spawn tester --manual
pi-company spawn coder --name coder-ui --yes --manual
```

如果安装了 cmux，可以让它自动开窗：

```bash
pi-company spawn tester --cmux
pi-company spawn coder --name coder-ui --yes --cmux
```

`spawn` 和 `launch-command` 会用 Pi `--approve` 启动 company 托管的 agent，
避免生成的 worktree 卡在 Pi 的 project trust 弹窗。普通目录里的普通 `pi`
会话不受影响。

`--root <project>` 只是在你不在项目目录里操作时使用。例如：

```bash
pi-company --root ~/Documents/cmux/tarot-draw status
```

人在项目目录里时，直接省略 `--root`。

如果你不想先进普通 Pi，也可以从 shell 直接启动 lead：

```bash
eval "$(pi-company launch-command lead)"
```

`spawn` 可以创建新的具名 agent，也可以启动已有 roster 中的 planned agent。若只想拿到精确 shell 命令，可使用 `launch-command <agent>`。

在已有 company 中再次运行 `init` 是幂等的。它会加载已有事件日志，不会重置 roster、issues、PRs 或 agent 状态。`init` 也会把 `.pi-company/` 加入 `.gitignore`，避免本地 company 状态和托管 worktrees 被 `git add .` 提交。

## Lead 是人类代理

Lead 不是被动派发器。Lead 应该做出 routine、低风险的默认决策，保留人类要求，并推动项目继续前进。只有不可逆、昂贵、法律/安全敏感、外部合同相关、品牌风险或使命变更时，lead 才应该询问人类。

Lead 不应该吸收其他角色拥有的执行工作。如果人类指定了必须使用的 skill、工具或方法，lead 应该把要求传给负责角色，而不是在 lead 上下文里自己做。

Handoff 是重要例外。如果人类调用 `$handoff`，或要求把当前工作交接给另一个
agent/session，lead 应该直接产出脱敏的非 runnable handoff 文档，保存到 OS
临时目录，包含 suggested skills，不要派 worker，不要建 issue，不要走 PR gate，
也不要写进项目 worktree。Handoff 是给人类迁移上下文的导出物，不是项目交付物。

## 当前范围

- 需要 Pi
- 本地单机运行
- 一个项目一个 company
- 项目本地 `.pi-company/` 状态
- 事件日志 + reducer + mailbox
- 本地 issues 和 PR 门控
- 独立 coder worktrees 支持并行开发
- 人类对任意 Pi session 的 steering 会镜像到 lead
- 组织级速率限制退避和交错恢复
- 可选 cmux 启动适配器

## 开发

```bash
npm install
npm run check
npm run build
```

`npm run check` 会执行隐私扫描、类型检查、测试、构建，并在构建后再次扫描，避免把 key、本机路径、支付二维码等敏感内容放进发布候选。

## 角色文件边界

pi-company 按文件影响面分边界，不按“是不是 write 工具”一刀切。非 coder
角色可以写自己职责范围内的非 runnable Markdown/docs：PRD、产品规格、设计说明、
测试报告、review 记录、研究报告、`AGENTS.md` / `CLAUDE.md` 这类 repo
治理文档，以及 `docs/agents/**`。

runnable 或会改变行为的文件仍然属于 coder worktree 和 PR gate：源码、
HTML/CSS/JS、配置、package 文件、脚本、CI、测试实现、资产、生成的应用文件和
其他实现产物。coder 也只能在自己的 worktree 里修改。

OS 临时目录下的非 runnable Markdown/text handoff 文件对所有角色开放。它们被视为
人类导出物，不是项目交付物。

开发者也可以从源码运行：

```bash
npm install
npm run build
node dist/src/cli.js status
```

## 角色模型策略

pi-company 可以为不同角色使用不同 Pi 模型。模型不是自由填写的；lead 使用 Pi 已配置的可选模型列表，也就是 `/model` 和 `pi --list-models` 的同一来源。

在 lead 的 Pi pane 中，人类可以直接说“配置角色模型”，或运行：

```text
/company-configure-models
```

Lead 会打开基于选择项的配置流程。用户不需要提前知道所有角色名。每个配置目标都会展示当前值。配置目标包括：

- future/unconfigured roles 的 default model
- 全局最多两个 fallback model，用于 provider 故障时继续推进
- 内置角色：lead、pm、designer、researcher、coder、reviewer、tester
- inline advisor 模型目标（它不是可常驻启动的 agent role）

目标会显示它是已显式配置、继承 default，还是回落到 Pi 当前启动模型。用户不用盲改。

配置会保存到 `.pi-company/company.yaml`：

```yaml
model_policy:
  roles:
    coder:
      provider: openai-codex
      model: gpt-5.6-luna
      thinking: low
    advisor:
      provider: openai-codex
      model: gpt-5.6-sol
      thinking: high
    reviewer:
      provider: openai-codex
      model: gpt-5.6-terra
      thinking: high
    tester:
      provider: openai-codex
      model: gpt-5.6-terra
      thinking: medium
  fallbacks:
    - provider: xiaomi-token-plan-cn
      model: mimo-v2.5-pro
    - provider: openai-codex
      model: gpt-5.5
      thinking: high
```

Fallback 是全局的，不按每个 role 单独配置。某个 provider 出现 `429`、quota 或类似服务故障时，新启动或重启的 agent 会先看自己的 role 主模型；如果主模型正好使用故障 provider，就按顺序切到第一个可用 fallback，再不行才用第二个。这样用户只需要配置角色主模型，再配一两个全局备用 provider，避免每个角色都维护一串复杂配置。

这是组织级策略。某一个正在运行的具体 agent 如果临时想换模型，直接进入那个 Pi pane，用 Pi 自己的模型切换能力处理，不需要写进 pi-company 的全局配置。

运行中的 Pi pane 会保持当前模型，直到重启或在 Pi 内手动切换。

## Advisor 模式

Advisor 模式给 pi-company 原有的横向团队协作增加了一条纵向升级通道。lead
或 coder 仍由快模型担任 executor；在制定关键方案、反复卡住、高风险操作和
宣称完成之前，它可以调用无参数的 `company_consult_advisor`。pi-company 只
暂停当前 executor，把有界的 Pi active branch 和只读公司快照交给已配置的
强模型，再把建议作为同一 agent loop 的 tool result 原位返回。

在 lead pane 运行 `/company-configure-models`，按三档配置：

1. `coder` 使用快速、便宜的模型，thinking 设为 low 或 medium。
2. `advisor` 使用你信任的最强模型，通常设为 high thinking。
3. `reviewer` 和 `tester` 使用可靠的独立验证模型；可以比 advisor 便宜，
   但不要与写代码的 executor 混成同一个自证角色。

`advisor` role 是同步能力，不需要另外启动常驻 advisor pane。没有显式配置
`model_policy.roles.advisor` 时，工具不会发送 transcript，只会返回配置提示。
只有 lead 和 coder executor 会拿到这个工具；reviewer/tester 会话保持独立。

正常使用**不需要**在 prompt 里点名工具。`auto` 模式会把工具规则暴露给
executor，由快模型在高杠杆节点自主判断是否升级。你可以在 Pi 会话的任意
阶段控制它：

| 命令 | 当前 Pi 会话中的效果 |
| --- | --- |
| `/company-advisor auto` | 暴露工具，由 executor 仅在必要时咨询；`on` 是别名。 |
| `/company-advisor once` | 武装一次真实咨询；provider payload 准备好、即将 dispatch 时才自动切到 `off`，此前的配置、队列、空上下文或 adapter 预处理失败不会消耗机会。 |
| `/company-advisor off` | 隐藏工具；即使旧上下文残留 tool call，也会在读取或发送 transcript 前拦截。 |
| `/company-advisor default` | 清除会话覆盖，重新跟随 `advisor_policy.enabled`。 |
| `/company-advisor status` | 查看模式、来源、工具状态、模型和本轮用量；不带参数时也显示状态。 |

这些命令不会注入 user message。模式保存在 Pi custom session entry 中，恢复
会话或切换 session tree 时会还原，而且不会进入模型上下文。状态栏会持续显示
`advisor:auto`、`advisor:once` 或 `advisor:off`。要求 Pi `0.80.6+`；在
agent run 中途切换 active tools，会从同一 run 的下一次 provider request 生效。
Pi 启动时显式传入的 `--tools` / `--exclude-tools` 是硬过滤，session mode 不会
绕过它；要使用 advisor，需去掉该过滤条件并重启 Pi。

可以在 `.pi-company/company.yaml` 调整项目默认值和预算：

```yaml
advisor_policy:
  enabled: true
  max_uses_per_turn: 2
  timeout_ms: 120000
  max_output_tokens: 4096
  max_transcript_chars: 240000
  max_company_context_chars: 24000
```

`enabled: true` 表示项目默认 `auto`，`false` 表示默认 `off`；会话命令可以
临时覆盖两者，不会改写 company 配置。

Advisor 调用进入现有 provider 并发队列。事件日志只记录模型、状态、耗时、
可用时的 token usage 和截断统计，不保存 transcript 或顾问正文；如果元数据
写入失败，tool result 会明确返回审计 warning，不会悄悄吞掉。Advisor
只能提供战略建议；reviewer/tester evidence、产品验收、lead brief、git 状态和
merge gates 仍然是权威事实。

## Pi 扩展

package 通过 `package.json` 暴露编译后的扩展：

```json
{
  "pi": {
    "extensions": ["./dist/extensions/company.js"]
  }
}
```

开发时也可以直接加载源码扩展：

```bash
pi -e ./extensions/company.ts --company-root "$PWD" --company-agent lead --company-role lead
```

扩展注册：

- UI：当前 agent 的状态行和 desk panel
- input hook：把交互式 human steering 镜像到 lead
- mailbox poller：读取本地消息
- 命令：`/company-init`、`/company-start`（手动刷新 brief）、`/company-resume`、`/company-pause`、`/company-maintain`、`/company-status`、`/company-advisor`、`/company-brief`、`/company-inbox`、`/company-ack`、`/company-send`、`/company-configure-models`
- 工具：同步 advisor 咨询、状态、lead/global brief、lifecycle maintenance、inbox、message、issues、task updates、spawn agent、本地 PR gates、review、test、acceptance、automated-test evidence、merge request、rate-limit report、model policy configuration

`company_lead_brief` 是 lead 的权威全局交付视图。Lead 在告诉人类“完成”“可以合并”之前必须使用它。worker 的 “done”“merged”“tested” 之类散文报告不是交付真相。

## 生命周期维护

pi-company 把临时存活状态放在 `.pi-company/runtime/`，不再用周期性
heartbeat 事件刷永久日志。lead 会运行轻量 watchdog：

- 用 `cmux read-screen` 读取 live terminal 纯文本
- 把有界恢复快照写到 `.pi-company/runtime/recovery/`
- worker 离线或任务长时间无进展时通知 lead
- 用 `cmux close-surface` hibernate 空闲 worker 窗口，但保留 worktree、
  branch、issue 和 PR 记录

默认策略最多保留 6 个 company-owned active surface；coder 空闲 5 分钟后
可 hibernate，其他 worker 空闲 15 分钟后可 hibernate；空闲时保留一个 warm
`pm`、`tester`、`reviewer`。默认不会自动重启关闭的 worker，lead 需要先阅读
terminal-text excerpt，再决定重启同一个 owner 还是重新分配。

Lead 也可以手动运行 `/company-maintain` 或 `company_maintain` tool。

## 消息背压与 provider 安全

每条消息都会写入目标 agent mailbox，同时带有 wake decision：

- `immediate`：适合立即唤醒目标 agent
- `digest`：进入 inbox，等目标 agent 下一批读取

默认策略：

- human steering 总是唤醒 lead
- assignment、review request、test request、system message 可以立即唤醒，但受 cooldown 约束
- report、reply、question 默认进入 digest

provider 安全主要靠 request gate：默认每个 provider 最多 3 个并发请求，同 provider 请求启动间隔 5 秒。如果观察到 provider overload、quota exhaustion 或重复 retry failure，可报告：

```bash
pi-company rate-limit --actor tester --reason "provider overload / retry failure"
```

Lead 会优先恢复，其他 agents 交错恢复，避免全公司同时唤醒。

## 许可证

Apache-2.0。除非明确另行说明，提交到本项目的贡献将按同一 Apache-2.0 许可证授权。
