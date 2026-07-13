# 让强模型只在关键时刻思考：我在 pi-company 里实现 Advisor，并用三道难题验证它

我真正想解决的问题，不是怎么让 AI 再聪明一点。

而是怎么让它只在值得的时候，使用最昂贵、最慢、最强的那部分智力。

这几年模型一直在变强，但另一个感受也越来越明显：强模型更慢了。它会思考得更久，也会在一个本来很普通的开发步骤上花掉大量时间。可真实的软件工作并不是每一步都需要最高水平的推理。查文件、改接口、跑测试、修格式，很多时候一个更快的模型就能完成。真正需要强模型的，往往只是少数节点：架构分岔、长时间卡住、证据互相冲突、风险操作，以及最后那次关键复核。

所以我想要的并不是“让最强模型包办一切”，而是一种更像真实团队的协作方式：

- 快模型负责持续执行；
- 独立 tester 和 reviewer 负责验证；
- 强模型不常驻干活，只在关键时刻作为 Advisor 介入；
- agent 应该自己知道什么时候问，而不是让我一直盯着终端输入提示词；
- 我还要能随时开启、关闭，或者只授权一次咨询。

这就是这次实验的起点。

## pi-company 原本解决的是横向协作

[pi-company](https://github.com/aa2246740/pi-company) 是我在 Pi 上做的多 agent 协作项目。它让不同角色围绕同一个任务工作：lead 分配任务，coder 在独立 worktree 里实现，tester 提前列出验收风险，reviewer 在完成后独立检查，最后再经过修订和质量门。

这套结构解决的是“横向分工”：同一层级上，让不同角色分别负责实现、测试、审查和协调。

但它缺少一种“纵向升级”。

假设 coder 使用一个速度快、成本低的模型。它大部分时候都工作得很好，可一旦遇到真正困难的决策，它只有两个选择：继续靠自己试，或者把整个 coder 都换成最强模型。前者可能陷入重复失败，后者又会让所有普通步骤都承担强模型的延迟和成本。

Advisor 正好补上这一层。

## Advisor 不是另一个替你写代码的 agent

[Claude 官方 Advisor Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) 的思路，可以概括成一句话：

> 执行模型继续掌握 agent loop，强模型只提供一次战略建议，然后执行模型接着做。

它和传统的 orchestrator 不一样。Orchestrator 是强模型站在上面拆任务、派任务，便宜模型在下面执行。Advisor 则把主循环留给快模型，只有在重要节点才向强模型升级。

Claude 官方版本是 inference server 内部能力。executor 生成到 Advisor 调用时，服务器暂停当前生成，把完整上下文交给更强模型，再把建议作为特殊结果注入 executor 的上下文，最后恢复原来的生成过程。客户端看起来仍像一次请求。

pi-company 无法复制这套闭源的 server-side 调度，但可以在 Pi extension 层实现等价的协作语义：

1. coder 或 lead 获得一个 `company_consult_advisor` 工具；
2. 调用时，只暂停当前 executor；
3. pi-company 收集它正在工作的 Pi 分支、有限长度的 transcript，以及只读的公司状态；
4. 使用配置好的强模型做一次独立推理；
5. 把建议作为 tool result 送回原来的 agent loop；
6. coder 自己决定怎样执行，tester、reviewer 和质量门仍然拥有最终证据权。

这里有一个很重要的边界：Advisor 的回答是“待验证的高级建议”，不是命令，也不是正确答案。

## 最难的产品问题不是调用，而是“什么时候调用”

最早我也担心一个问题：agent 默认总觉得自己会做，它为什么会知道什么时候应该问 Advisor？

如果每次都要用户写一句“现在请咨询强模型”，体验就失败了。那不叫自动协作，只是把 human in the loop 换了一个名字。

Claude 官方文档也明确提醒：如果没有 system-prompt steering，executor 在 coding 任务里往往会少调用 Advisor。也就是说，不能简单放一个工具进去，然后期待模型天然掌握正确的升级时机。

最终实现用了两条升级路径。

第一条是 agent 自主选择。工具说明和公司工作知识会告诉 executor：当它面对高影响且尚未解决的选择、明显低置信度、互相冲突的证据，或者自己无法可靠验证的方案时，可以调用 Advisor。模型不是“天生知道”，而是因为它在当前工具和工作协议中获得了这种能力与使用边界。

第二条是 runtime 的确定性触发。pi-company 不读取模型的隐藏思维，而是观察可审计的外显事件：

- 同一个 bash、write 或 edit 尝试重复失败；
- issue 被标记为 blocked；
- reviewer 明确 request changes；
- 进入需要升级的审查状态。

触发之后，executor 仍可进行只读检查，但在继续修改状态前要先完成一次咨询。这样既不会靠猜测模型“是不是困惑”，也不需要人守着终端。

为了避免 Advisor 反过来接管工作，默认预算被限制为每个任务最多一次成功咨询。项目可以把默认状态设为 `auto`，用户也可以在会话中随时切换：

```text
/company-advisor auto
/company-advisor once
/company-advisor off
/company-advisor default
/company-advisor status
```

这些命令不会被伪装成用户提示词塞进上下文。模式作为 Pi session state 保存，恢复会话或切换分支后仍然存在。`auto` 也不意味着每个任务都要问一次，它只是让工具与触发机制可用。

## 第一版并没有证明 Advisor 更好

实现功能以后，我们先跑了两道非安全类 Terminal-Bench 2.1 难题：Raman 光谱拟合和自定义压缩器。

第一版策略比较 eager。它鼓励 agent 在开局、卡住和结束前都咨询。结果非常有教育意义：

- Raman 从 10/11 被救到 11/11；
- 压缩器却从 6/6 退化到 2/6；
- 两组最终都是 1/2 个任务通过；
- Advisor 组的细粒度检查反而从 16/17 降到 13/17。

强模型确实有能力救任务，但它也会让一个本来已经接近正确的 executor 临时换方向。尤其在 deadline 前，咨询本身会占用实现时间。如果 agent 把建议当成权威，而不是假设，强模型一样可以破坏已有的正确结果。

所以我们把 eager 策略改成 adaptive：

- 不再固定要求开局咨询；
- 不再固定要求结束前咨询；
- 每个任务最多一次；
- 需要可观察证据，或者由 agent 明确自主升级；
- 已经通过本地验证的 artifact 不因一条建议就被直接替换；
- Advisor 应该给出可证伪的验证方法和 fallback。

## 第二版又遇到了一个更隐蔽的问题：题目太容易

改完 adaptive 后，我们跑了四道更复杂的任务：推理批处理调度器、Rust/C++ polyglot、电路生成和 regex chess。

结果 pi-company 是 24/24，pi-company 加 Advisor 也是 24/24。

表面上这是好成绩，实际上它几乎回答不了“Advisor 有没有提升质量”。因为 baseline 已经满分，Advisor 没有任何上升空间。这就是 benchmark 的天花板效应。

这轮实验仍然证明了自动路由能工作：四个任务里发生了三次成功咨询，全部由 runtime 证据触发，不需要 prompt 提醒。但它不能证明质量提升。更糟的是，Advisor 组在那个小样本里还更慢、tokens 更多。

于是我们又改了实验，而不是继续解释满分。

## 为了公平，我们先把时间预算翻倍

之前有些阶段只有五分钟。对 Sol 和 Luna 这种会进行长推理、反复检查的模型来说，五分钟很容易把“尚未做完”误判成“没有能力做完”。

新实验把任务和阶段预算全部乘以 2。比如蛋白设计的 coder 最多可以工作 40 分钟，整题最多 60 分钟。Raman coder 最多 20 分钟，整题最多 30 分钟。

这不是让模型无限拖延，而是避免 benchmark 只测速度。最后真实数据也证明了这个修改是必要的：蛋白 baseline 的 coder 用了 19.6 分钟和 95 次工具调用。如果还用五分钟，它会被直接记成失败，我们根本看不到真实质量。

同时，用户的电脑硬盘空间有限，所以没有运行 Harbor、Docker、VM，也没有下载本地模型。我们做了一个 native harness：fixture 按 SHA-256 固定到 Terminal-Bench 2.1 的特定 commit，grader 在 agent 工作区之外运行，模型看不到标准答案。

整个实验的峰值磁盘占用只有约 108 MiB，其中约 95 MiB 是 Raman 临时使用的 NumPy 和 SciPy。跑完后全部清理，最终只保留 25 KiB 的原始 checkpoint 和 8 KiB 的机器报告。

## 这次到底怎么比

最终选择了三道非安全类难题：

1. **Protein assembly**：从 FASTA、PDB、FPbase、GenBank 和分子结合信息中选择五段蛋白，按指定顺序拼成 FRET fusion，设计 GS linker，再做密码子和滑窗 GC 优化。
2. **SQLite WAL recovery**：诊断一个看起来损坏或加密的 WAL，恢复更新与插入记录，并输出精确 JSON。
3. **Raman fitting**：解析测量数据，完成物理量转换，对 G 和 2D 峰做 Lorentzian 拟合，输出八个带容差的参数。

每道题都跑两次：

- **pi-company**：Luna 做 tester、coder 和 reviewer；
- **pi-company + Advisor**：仍然由 Luna 做 tester、coder 和 reviewer，只允许 coder 在需要时咨询一次 Sol。

这里的 Luna 是较快的执行模型路线，Sol 是更强、更慢的 Advisor 路线。两组都使用 high thinking。唯一的 treatment difference 是 Advisor 是否启用。

题目 prompt 没有提 Advisor，也没有要求 agent 调用它。用户没有输入 `once`，也没有在旁边盯着。

三个 grader 都先用 oracle 和故意残缺的负样本做了自检：

| 任务 | Oracle | 负样本 |
| --- | ---: | ---: |
| Protein | 9/9 | 5/9 |
| WAL | 9/9 | 7/9 |
| Raman | 11/11 | 2/11 |

完整仓库检查是 273/273 tests，通过 typecheck、build 和两次 privacy scan。

## 实验中途还真的撞到了额度上限

第一次跑 Protein baseline 时，tester、coder 和 reviewer 都已经完成，最后 coder revision 刚启动，ChatGPT Pro 的短期用量窗口到了。

它不应该被算成任务失败，所以评测器正确地把它标记为基础设施中断。但进一步检查发现，旧的 retry 逻辑会删除整个 cell。也就是说，前面十几分钟已经完成的阶段都会被重跑。

我们停下实验，先修 benchmark harness。

新的 `--resume-existing` 会保存有效的阶段前缀，只移除失败的 checkpoint tail。恢复时，它从第一个未完成阶段继续，并从剩余任务预算中扣掉已经消耗的有效执行时间。等待额度恢复的墙钟时间不计入任务能力。

我们还构造了一个假的 timed-out checkpoint，验证恢复过程能够直接对已有文件评分，而不会偷偷再调用一次模型。然后重新跑完 273 个测试，才继续正式实验。

这件事和 Advisor 本身无关，但它解释了为什么 agent benchmark 很容易不公平：provider 限额、网络中断、任务 timeout 和模型真实失败必须被分开记录。

## 最终成绩

先看最直接的质量结果：

| 任务 | pi-company | + Advisor | Sol 调用 | 结果 |
| --- | ---: | ---: | ---: | --- |
| Protein assembly | 5/9，失败 | 5/9，失败 | 1 | 平局，未救成 |
| SQLite WAL recovery | 9/9，通过 | 9/9，通过 | 0 | 平局，无需升级 |
| Raman fitting | 4/11，失败 | 11/11，通过 | 1 | Advisor 胜 |
| **合计** | **18/29，1/3 通过** | **25/29，2/3 通过** | **2** | **1 胜、0 负、2 平** |

从 aggregate 看：

- binary pass 从 1/3 变成 2/3；
- 细粒度检查从 18/29，也就是 62.1%，变成 25/29，也就是 86.2%；
- 增加 7 个检查，提升 24.1 个百分点；
- mean task score 从 64.0% 变成 85.2%。

这是当前 adaptive Advisor 第一次在没有 baseline 天花板的配对实验中，产生净正向质量结果。

但三个任务的故事比总分更重要。

## Protein：Advisor 被触发了，但没有救成

Protein 两组都是 5/9。

它们都成功生成了合法 DNA，满足单行输出、ATCG 字符、阅读框、总长度和所有 50 nucleotide 滑窗 GC 约束。真正的问题是 donor sequence 选错了。

这个错误连锁影响了 component identity、完整顺序、termini 和 linker 提取，所以一次错选导致四个检查失败。

Advisor 组确实自动升级了。runtime 看到相同 bash 工具指纹失败两次，产生 `repeated_tool_failure` trigger。Sol 在 14.2 秒内读取约 88k 字符上下文，使用 31,116 tokens，返回一次建议。

咨询在技术上成功，trigger 也被正确清除，但最终 donor 仍然选错。

这暴露了 adaptive 的一个盲点：外显的工具失败不一定对应真正的语义风险。模型可能解决了“命令为什么失败”，却没有重新怀疑“我选的蛋白是不是错了”。Advisor 不是只要被调用就会自动提高答案质量。

不过这组的执行轨迹更短：总活跃时间从 27.36 分钟降到 20.45 分钟，工具调用从 155 降到 139。它提高了效率，没有提高质量。

## WAL：开着 auto，也可以一次都不问

SQLite WAL 两组都是 9/9。

两个 candidate 都恢复了精确的 11 条记录，包括 WAL 中的两个更新和六个插入，JSON schema、排序和唯一性也全部正确。

Advisor 组没有调用 Sol。

这看起来不戏剧化，却是产品上很重要的结果。`auto` 不是“每个任务自动问一次”，而是“需要时允许升级”。当 Luna 很快识别出可逆变换、修复 WAL、查询出完整记录并通过独立检查时，pi-company 没有为了展示功能而烧一次强模型。

这回答了另一个担心：Advisor 可以持续开启，但并不意味着强模型持续工作。

## Raman：agent 自己决定求助，并从 4/11 变成 11/11

Raman 是这次最关键的样本。

baseline 成功输出了格式正确的 JSON，但八个物理拟合参数只通过一个。G 峰中心被拟合成 1641.61，而标准容差中心是 1580.30；两个峰的 gamma、amplitude 和 offset 都严重偏离。最后 revision 用满四分钟阶段上限，评测器按 deadline 时的文件评分，得到 4/11。

Advisor 组没有出现重复工具失败，也没有 deterministic trigger。

但 coder 自己调用了 Advisor。

审计记录是 `automatic: true`，`trigger_ids: []`，被归类为一次 voluntary consultation。换句话说，不是用户提醒，不是 runtime 强制，也不是 reviewer 仲裁，而是 Luna 在工作过程中自己判断：这里值得问一次更强模型。

Sol 用了 14.3 秒，Advisor 输入输出合计 20,539 tokens。之后 Luna 继续执行与验证，最终八个参数全部通过：

- G x0：1580.338；
- G gamma：8.444；
- G amplitude：8298.827；
- G offset：5769.888；
- 2D x0：2670.085；
- 2D gamma：17.297；
- 2D amplitude：12285.026；
- 2D offset：1298.345。

最终成绩从 4/11、reward 0，变成 11/11、reward 1。

这不是只修了 JSON 格式，也不是 grader 碰巧宽松。最终结果通过了对应物理转换、peak selection 和 Lorentzian 参数约定的全部参数验收。

更有意思的是，这个方向和早期 eager 实验里的 Raman rescue 一致，但当前条件更严格：tester 和 reviewer 也都是 Luna，Advisor 只有一次，而不是三次。

## 效率和成本发生了什么

把三道题加在一起：

| 指标 | pi-company | + Advisor | 观察到的变化 |
| --- | ---: | ---: | ---: |
| Agent stage time | 60.66 分钟 | 52.10 分钟 | -14.1% |
| Combined tokens | 8.530M | 7.919M | -7.2% |
| Pi catalog cost estimate | $2.1715 | $2.2269 | +2.5% |
| Pi tool calls | 380 | 357 | -6.1% |
| Direct Advisor tokens | 0 | 51,655 | +51,655 |
| Direct Advisor estimate | $0 | $0.2909 | +$0.2909 |

这批样本里，Advisor 组质量更高，总执行时间、tokens 和工具调用反而更少，但估算成本高了 2.5%。

不要把这理解成“Advisor 必然省 14% 时间”。每组只有一个随机采样，Luna 的执行轨迹差异很大。比如 WAL 的 Advisor 组根本没调用 Sol，却比 baseline 更快，这只能算 sampling variance，不能归因于 Advisor。

这里的美元也是 Pi model catalog 根据观察到的 subscription route usage 计算的估值，不代表账单上额外扣了这么多钱。真正可以确认的是：两次 Sol 咨询一共使用 51,655 tokens，直接估值约 $0.2909。

## 这个结果有没有统计意义

还没有。

Advisor 是 1 胜、0 负、2 平，但只有一个 discordant pair。McNemar 和 sign test 的双侧 `p` 都是 1.0。task-level mean score delta 的 bootstrap 区间是 `[0, +63.6 pp]`，包含 0。

所以这次实验可以证明一件事：

> 当前 adaptive Advisor 有能力在无需人工触发的情况下，显著改变一次困难任务的结果。

但它还不能证明：

> 打开 Advisor 后，长期平均通过率会稳定提高 33 个百分点。

所有质量增益都来自 Raman 一个任务。Protein 没救成，WAL 本来就会过。更何况 Raman 自己的随机波动很大，早期 baseline 曾经得到 10/11，这次却只有 4/11。

下一步真正可信的实验，应该在 Raman 和 Protein 上至少运行五个 paired seeds，最好再做不泄漏答案、但保持同一能力结构的参数化变体，然后报告完整的 reward 和 granular score 分布。

## 所以，Advisor 到底有没有用

我的答案现在比实验前更明确，也更克制：

**有用，但它是选择性救援通道，不是普遍质量倍增器。**

它最有价值的场景，不是“快模型不够聪明，所以任何时候都问强模型”，而是：

- 任务中存在少数高影响决策；
- executor 能完成大部分机械工作；
- 错误可以通过测试、review 或客观指标验证；
- 任务还有足够时间执行 Advisor 给出的验证路径；
- 强模型只给方向，执行模型仍对落地负责。

它不适合的场景也很清楚：

- 工作简单、路径明确；
- 没有客观验证，建议对错无法判断；
- 已接近 deadline，咨询会挤占修复时间；
- agent 会无条件服从建议，覆盖一个已经通过验证的 artifact。

这也是为什么 pi-company 保留 `off`、`once` 和 `auto`，并把 adaptive 设为推荐策略，而不是默认让强模型在开局和结束时各讲一次话。

## 我从这次实验里学到的，不只是一个功能

最初的直觉是“让强模型思考，让快模型干活”。真正实现以后才发现，这句话缺了最难的一半：谁判断现在值得思考，谁验证思考结果，以及失败发生时怎样恢复。

一个可用的 Advisor 系统至少需要五样东西：

1. **能力路由**：快模型和强模型的职责要不同；
2. **升级政策**：既允许 agent 自主求助，也要有可审计的 runtime trigger；
3. **预算边界**：一次任务不能无限咨询；
4. **证据闭环**：建议必须经过 tester、reviewer 和实际测试；
5. **基础设施诚实**：quota、网络中断、timeout 和质量失败不能混为一谈。

这也是 pi-company 和 Advisor 真正“异曲同工”的地方。pi-company 原本在做组织设计，让不同 agent 各自承担责任。Advisor 不是外挂一个更聪明的聊天框，而是在这个组织里增加一条纵向升级通道。

理想的 AI company 不应该让所有员工永远使用最强模型。

它应该让大部分工作快速流动，让独立角色持续验证，并在少数真正值得的时刻，把完整问题交给最强的大脑想一次。

这次三题实验还没有证明这个组织一定更好。

但它第一次证明了：这种组织真的可以在 Pi 上运行，而且有一次，agent 确实自己知道该求助了。

## 项目与原始数据

- 项目：[aa2246740/pi-company](https://github.com/aa2246740/pi-company)
- 实验分支：[`feat/advisor-mode`](https://github.com/aa2246740/pi-company/tree/feat/advisor-mode)
- 完整实验报告：[`NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.md`](https://github.com/aa2246740/pi-company/blob/feat/advisor-mode/docs/benchmarks/NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.md)
- 机器可读结果：[`NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.json`](https://github.com/aa2246740/pi-company/blob/feat/advisor-mode/docs/benchmarks/NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.json)

本文中的成绩来自一次低磁盘、非 Harbor 的本地 paired pilot，不是 Terminal-Bench 官方 leaderboard submission。完整实现通过 273/273 tests、typecheck、build 和 privacy scan。
