# pi-company 官网

[English](README.md) | [中文](README.zh-CN.md)

> pi-company 的公开视频入口：让多个 Pi 像一个可见的本地项目团队一样工作。

这个网站是 `pi-company` 的官网和文档入口。它首先要让新访客快速明白项目是什么、为什么值得安装，然后再通过交互教程解释具体命令和流程。

## 本地开发

```bash
npm install
npm run dev
```

开发时访问 http://localhost:5173/pi-company/。

## 检查

```bash
npm run check
```

`check` 会执行隐私扫描、测试、生产构建，并在构建后再次扫描。

## 发布目标

构建后的网站通过 GitHub Pages 发布：

https://aa2246740.github.io/pi-company/

## 内容标准

首页在进入详细文档前，应该先让陌生访客理解三件事：

1. `pi-company` 把可见的 Pi session 接成本地项目团队。
2. Lead 维护全局真相，worker 通过本地 issues、mailbox、worktree 和 PR gates 协作。
3. 用户仍然保有控制权，因为每个 agent 都是看得见、能打断、能 steering 的 Pi。

TUI 风格应该帮助理解，不应该只是装饰。

## 许可证

Apache-2.0。除非明确另行说明，提交到本项目的贡献将按同一 Apache-2.0 许可证授权。
