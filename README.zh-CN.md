# pi-company

[English](README.md) | [中文](README.zh-CN.md)

`pi-company` 是一个 Pi 原生的本地多智能体协作运行时，用来在一个项目里运行一个可见、可控、可接管的 agent company。

- 源码：https://github.com/aa2246740/pi-company
- 官网：https://aa2246740.github.io/pi-company/

## 它到底是什么？

`pi-company` 不是一个 Node 后端服务，也不是让你一直开着的 daemon。

它由两部分组成：

- **Pi extension/package**：启动 Pi agent 时加载，给 Pi 增加状态面板、mailbox、工具、斜杠命令和 human steering 镜像能力。
- **辅助 CLI**：用来初始化项目、打印启动命令、规划/启动 agent、查看状态、做少量运维操作。

Node 只是 CLI 和扩展代码的运行环境。日常工作不是“启动一个 Node 服务”，而是进入你的项目目录，启动带 pi-company extension 的 Pi。

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

## 工作流

```text
human -> lead -> local issues -> coder worktrees -> local PR
      -> reviewer + tester -> PM/lead acceptance -> gates -> lead merge
```

每个 Pi agent 都有自己的可见工作面板。agent 通过本地工具和 mailbox 消息协作；cmux 只是可选的启动器和窗格管理器。

Lead 是人类的本地代理，不是被动派发器。PM 可以定义产品范围和验收标准，但 routine、低风险的默认决策应由 lead 直接做出并推动公司前进。只有不可逆、昂贵、法律/安全敏感、外部合同相关、品牌风险或使命变更时，lead 才应该询问人类。

## 开发

```bash
npm install
npm run check
npm run build
```

`npm run check` 会执行隐私扫描、类型检查、测试、构建，并在构建后再次扫描，避免把 key、本机路径、支付二维码等敏感内容放进发布候选。

## 日常用法

如果你习惯先启动 Pi，先把 pi-company 装成 Pi package：

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

`/company-init` 会创建项目本地 `.pi-company/` 状态，并把当前 Pi session 接成 `lead`。之后在这个目录里直接启动 Pi 就够了：Pi 正常恢复对话，pi-company 自动接入已有 company，显示工作面板，注册 company tools，镜像人类 steering，控制 provider 请求，并在每一轮 agent 开始前刷新角色职责和 lead brief。

如果你更喜欢 shell-first，也可以先在终端运行 `pi-company init`，再启动 Pi。

如果你想把当前角色职责和 lead brief 手动推送到可见聊天里，可以在 Pi 里运行 `/company-start`。它现在是刷新命令，不是必需的恢复步骤。

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

开发者也可以从源码运行：

```bash
npm install
npm run build
node dist/src/cli.js status
```

## 角色模型策略

pi-company 可以为不同角色或具名 agent 使用不同 Pi 模型。模型不是自由填写的；lead 使用 Pi 已配置的可选模型列表，也就是 `/model` 和 `pi --list-models` 的同一来源。

在 lead 的 Pi pane 中，人类可以直接说“配置角色模型”，或运行：

```text
/company-configure-models
```

Lead 会打开基于选择项的配置流程。用户不需要提前知道所有角色名。配置目标包括：

- future/unconfigured roles 的 default model
- 内置角色：lead、pm、designer、researcher、coder、reviewer、tester
- 已存在的 named agents

配置会保存到 `.pi-company/company.yaml`：

```yaml
model_policy:
  roles:
    coder:
      provider: openai-codex
      model: gpt-5.4-mini
      thinking: low
```

运行中的 Pi pane 会保持当前模型，直到重启或在 Pi 内手动切换。

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
- 命令：`/company-init`、`/company-start`（手动刷新 brief）、`/company-resume`（兼容别名）、`/company-status`、`/company-brief`、`/company-inbox`、`/company-ack`、`/company-send`、`/company-configure-models`
- 工具：状态、lead/global brief、inbox、message、issues、task updates、spawn agent、本地 PR gates、review、test、acceptance、automated-test evidence、merge request、rate-limit report、model policy configuration

`company_lead_brief` 是 lead 的权威全局交付视图。Lead 在告诉人类“完成”“可以合并”之前必须使用它。worker 的 “done”“merged”“tested” 之类散文报告不是交付真相。

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
