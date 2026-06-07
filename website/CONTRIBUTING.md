# 贡献指南

感谢你对 pi-company 网站项目的关注！本文档将帮助你了解如何贡献。

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发环境](#开发环境)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)

## 行为准则

本项目采用贡献者契约行为准则。参与本项目即表示你同意遵守其条款。

## 如何贡献

### 报告 Bug

1. 检查 [Issues]({GITHUB_URL}/issues) 确认 bug 未被报告
2. 创建新 issue，包含：
   - 清晰的标题和描述
   - 复现步骤
   - 预期行为 vs 实际行为
   - 环境信息（浏览器、操作系统等）

### 建议新功能

1. 检查 [Issues]({GITHUB_URL}/issues) 确认功能未被建议
2. 创建新 issue，包含：
   - 功能描述
   - 使用场景
   - 实现建议（可选）

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'feat: add your feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

## 开发环境

### 前置条件

- Node.js 18+
- npm 或 yarn

### 安装

```bash
# 克隆仓库
git clone {GITHUB_URL}.git
cd pi-company-site

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 常用命令

```bash
# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 运行测试
npm test

# 运行测试（监听模式）
npm run test:watch

# 预览生产版本
npm run preview
```

## 代码规范

### TypeScript

- 使用 TypeScript 进行类型检查
- 避免使用 `any` 类型
- 为复杂类型定义接口

### Vue

- 使用 Composition API
- 使用 `<script setup>` 语法
- 组件名使用 PascalCase

### CSS

- 使用 CSS Variables 定义设计令牌
- 遵循 BEM 命名规范（可选）
- 使用 scoped 样式

### 文件命名

- 组件：PascalCase（如 `MyComponent.vue`）
- 页面：PascalCase + Page 后缀（如 `HomePage.vue`）
- 工具函数：camelCase（如 `useMyHook.ts`）

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### 类型

- `feat` — 新功能
- `fix` — Bug 修复
- `docs` — 文档更新
- `style` — 代码格式（不影响功能）
- `refactor` — 代码重构
- `test` — 测试相关
- `chore` — 构建/工具相关

### 示例

```
feat(tutorial): 添加 Provider 429 教程
fix(header): 修复移动端菜单显示问题
docs(readme): 更新安装说明
```

## Pull Request 流程

1. **确保测试通过**：运行 `npm test`
2. **确保构建通过**：运行 `npm run build`
3. **更新文档**：如有必要，更新 README 或其他文档
4. **描述更改**：在 PR 描述中说明更改内容和原因
5. **关联 Issue**：使用 `Closes #123` 关联相关 issue
6. **等待审查**：维护者会审查你的代码

### PR 标题

使用与提交规范相同的格式：

```
feat(tutorial): 添加 Provider 429 教程
```

## 开发提示

### 添加新教程

1. 在 `src/components/tutorial/` 创建新组件
2. 在 `src/pages/TutorialsPage.vue` 导入并使用
3. 添加测试：`src/__tests__/tutorials.test.ts`
4. 更新导航：`src/data/navigation.ts`

### 修改设计系统

1. CSS 变量在 `src/assets/styles/variables.css`
2. CRT 效果在 `src/assets/styles/crt-effects.css`
3. 全局样式在 `src/assets/styles/main.css`

### 运行测试

```bash
# 运行所有测试
npm test

# 运行特定测试文件
npm test -- facts.test.ts

# 监听模式
npm run test:watch
```

## 问题？

如有问题，请在 [Issues]({GITHUB_URL}/issues) 中提问。

## 许可证

参与本项目即表示你同意你的贡献将在 [MIT 许可证](LICENSE) 下发布。
