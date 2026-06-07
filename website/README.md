# pi-company 官方网站

> Pi 原生的本地多智能体协作运行时 — 官方文档和教程网站

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883.svg)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vitejs.dev/)

## 什么是 pi-company？

pi-company 是一个 Pi 原生的本地多智能体协作运行时，让可见、可控的 Pi 智能体在一个项目中协同工作。

**核心特性：**
- 本地运行，无需云端
- 多角色协作：lead、PM、coder、reviewer、tester、researcher
- 完整的 PR 门控流程保证代码质量
- 可选 cmux 集成，也支持纯终端模式

## 网站功能

这个网站是 pi-company 的官方文档和教程，包含：

- **14 个交互式教程** — 通过模拟器学习每个功能
- **完整文档** — 从安装到高级配置
- **复古未来 TUI 风格** — 终端风格界面，CRT 荧光色系
- **响应式设计** — 支持桌面和移动端

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173 查看网站。

### 构建生产版本

```bash
npm run build
```

### 运行测试

```bash
npm test
```

## 技术栈

- **前端框架** — Vue 3 + Composition API
- **类型系统** — TypeScript
- **构建工具** — Vite
- **路由** — Vue Router
- **样式** — CSS Variables + 自定义 TUI 主题
- **测试** — Vitest + Vue Test Utils

## 项目结构

```
pi-company-site/
├── src/
│   ├── assets/
│   │   └── styles/          # 设计系统（CSS 变量、CRT 效果）
│   ├── components/
│   │   ├── layout/          # 布局组件（Header、SideNav）
│   │   ├── terminal/        # 终端风格组件
│   │   ├── tutorial/        # 交互式教程组件
│   │   └── common/          # 通用组件
│   ├── layouts/             # 页面布局
│   ├── pages/               # 页面组件
│   ├── router/              # 路由配置
│   ├── data/                # 静态数据
│   └── __tests__/           # 测试文件
├── docs/                    # 项目文档
├── public/                  # 静态资源
└── index.html               # 入口文件
```

## 设计系统

网站使用复古未来 TUI 风格，主要特点：

- **字体** — Inter（正文）、JetBrains Mono（代码）、VT323（装饰）
- **颜色** — CRT 荧光色系（绿色、琥珀色、青色、品红色）
- **间距** — 8px 基础单位系统
- **效果** — 扫描线纹理、荧光发光、状态指示灯

## 交互式教程

网站包含 14 个交互式教程：

1. 概念之旅 — 可点击概念地图
2. 初始化公司 — 分步引导
3. 启动 Agent — 手动/cmux 切换
4. 配置角色模型 — 模型选择器 + YAML 预览
5. 人类引导 — 输入消息 → 镜像动画
6. 邮箱与唤醒 — 消息滑块 + 唤醒可视化
7. 问题与任务 — 创建表单 + 状态时间线
8. Coder 工作树 — 工作树图 + 脏状态切换
9. 本地 PR 流程 — PR 表单 + 门控状态
10. 审查测试验收 — 决策切换 + caveats 阻塞
11. Lead 真相 — worker 假完成 vs brief
12. 合并门控 — 门控清单模拟器
13. Provider 429 — 队列模拟 + 冷却动画
14. 故障排查 — 症状选择 + 诊断路径

## 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

## 许可证

本项目基于 MIT 许可证开源 — 查看 [LICENSE](LICENSE) 文件了解详情。

## 相关链接

- [pi-company 源代码](https://github.com/aa2246740/pi-company)
- [pi-company 文档](https://aa2246740.github.io/pi-company/)

## 致谢

- [Vue.js](https://vuejs.org/) — 渐进式 JavaScript 框架
- [Vite](https://vitejs.dev/) — 下一代前端构建工具
- [JetBrains Mono](https://www.jetbrains.com/mono/) — 等宽字体
- [Inter](https://rsms.me/inter/) — 界面字体
