# Agent Note: Web 工作区文件引用

Status: implemented

[English](2026-08-16-web-workspace-file-references.md) | 中文

## Problem

Web 用户可以在提示词中写出工作区文件名，但 composer 没有路径发现能力。面向模型的 `glob` 和 `grep` 工具不能填充浏览器菜单，而 Host 目录选择器允许接收当前 Session 之外的任意文件系统路径。向浏览器发送绝对路径还会在没有以 Session 为范围的授权判断时暴露 Host 文件系统布局。

## Decision

Web composer 在 `@deepseek-ai/dsh-client-ui-workspace` 中注册 `workspace-file` `@` input source。它调用 `ctx.workspaces.searchWorkspaceFiles(sessionId, query, signal)`，渲染相对文件和目录路径，并把选择的候选项作为字面 `@path` 文本插入。普通用户消息事件会记录该文本，因此 replay 可以重建模型可见的提示词，无需另一种事件类型。该 source 不读取文件内容，也不向消息附加文件数据。

`session.searchWorkspaceFiles` 是一个有类型的 ApiProxy 方法。Host 仅接收 Session id 和 query，解析运行中的 Agent，并以其 `Session.header.cwd` 作为搜索根。浏览器从不提供文件系统根，也只会收到标准化为斜杠的相对路径和文件或目录种类。空 query 返回一级路径页；非空 query 搜索后代。扫描器跳过符号链接、`.git` 和 `node_modules`，在可配置的 `workspaceFileSearchMaxResults` 和 `workspaceFileSearchMaxEntries` 限制处停止，并在 wire 中报告截断。固定的响应上限仍是 100 条路径，但部署可以配置更低的候选项上限。

工作区运行时持有浏览器调用，而不是让 `ui-workspace` 直接访问 connection service。`ui-input-trigger` 继续是通用 source 注册表；它只增加本地化的 `workspace-file` 分组标签。

## Alternatives considered

- **从浏览器调用模型 `glob` 工具** — 该工具是面向模型的 Consumer，带有工具结果格式化和 Agent 所有权，不是浏览器 API。复用它会暴露没有有类型浏览器授权路径的执行面。
- **使用 `host.listDirectory`** — 目录浏览有意面向整个 Host，并接收由浏览器选择的路径。它无法保证请求停留在活动 Session cwd 下方，也不返回文件。
- **返回绝对路径并让客户端限制它们** — 浏览器端检查无法阻止受损或过期的客户端请求其他 Host 路径。Host 在访问文件系统前解析 Session，且只返回相对路径。
- **选择候选项时读取文件内容** — 选择是路径发现交互，不是上下文附加。预先读取会增加 token 成本，并可能把无关或不可信的文件内容注入用户请求。
- **将 source 放入 `ui-input-trigger`** — 该包持有命令、技能和 subagent source 共享的触发机制。工作区授权和路径查询属于 workspace feature 与运行时服务。

## Consequences

新的 Web 功能只对记录了工作目录的 Session 有效。缺失的 Session 或不可读的工作区会返回普通 RPC 失败，并使 trigger 菜单没有候选项。递归 query 以受限的 Host 工作量换取更广的发现范围；当结果页被截断时，用户可以缩小路径片段。现有 `@` subagent 候选项仍独立注册。扫描器和 ApiProxy 测试、`ui-workspace` 注册测试以及组装后的 Web 检查覆盖该行为。
