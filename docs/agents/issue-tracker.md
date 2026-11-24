# Issue tracker: GitHub

本仓库的 issue 与 spec 都以 GitHub issue 形式存在。所有操作使用 `gh` CLI；仓库为 `lotusTanglei/dsh-go`（在仓库内执行时 `gh` 自动推断）。

## 约定

- **新建**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读取**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列表**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按 `--label` / `--state` 过滤。
- **设为子 issue**：`gh issue create --parent <parent> ...`，或 `gh issue edit <parent> --add-sub-issue <child>`（gh 2.94+）。旧版：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（database id）。不可用时在子 issue 正文顶部写 `Part of #<parent>`。
- **阻塞关系**：优先 GitHub 原生依赖，`gh issue create --blocked-by <n>,<n> ...` 或 `gh issue edit <child> --add-blocked-by <blocker>`（gh 2.94+）。旧版：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`。不可用时在正文顶部写 `Blocked by: #<n>, #<n>`。所有 blocker 关闭即解除阻塞。
- **开放 blocker 数**：`gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`（只看未关闭）。`gh issue view <n> --json blockedBy` 含已关闭项，需过滤。
- **评论**：`gh issue comment <number> --body "..."`。
- **标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- **关闭**：先 `gh issue comment <number> --body "..."` 说明原因，再 `gh issue close <number>`。对已关闭 issue，`gh issue close --comment` 会丢弃评论但仍退出 0。

## 仓库与身份

- 只向本仓库（`lotusTanglei/dsh-go`，用户本人 ADMIN）建单；不要向 `mattpocock/skills` 或任何上游建单。
- 本会话首次 `gh issue create` 前，用 `gh repo view --json nameWithOwner` 确认目标；与预期不符就停下询问。

## 环境注意

- 本机 `github.com` 直连 HTTPS/SSH 不通（DNS 被投毒），但 `api.github.com` 正常；`gh` 走 API，已登录（keyring 存储），可直接使用，不要重跑 `gh auth login`。
- 需要 `git push` 时按项目记忆的本地 CONNECT 代理方式，不改全局 git 配置。

## PR 作为需求入口

**PRs as a request surface: no.** _（若要本仓库把外部 PR 当需求入口，改成 `yes`；`/triage` 会读取此标记。）_

## 当技能要求「发布到 issue tracker」

新建一个 GitHub issue。

## 当技能要求「获取相关工单」

按上面的「读取」执行。

## Wayfinding

由 `/wayfinder` 使用。**map** 是单个 issue，子 issue 是工单。

- **Map**：一个带 `wayfinder:map` 标签的 issue，正文写 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子工单**：以 GitHub sub-issue 关联到 map；不可用时写进 map 正文的 task list，并在子 issue 顶部写 `Part of #<map>`。标签 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。认领后 assign 给执行者。
- **阻塞**：见上面「阻塞关系」。
- **前沿查询**：列出 map 下未关闭子 issue，剔除有开放 blocker 或已有 assignee 的项；按 map 顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，作为本会话第一次写操作。
- **解决**：`gh issue comment <n> --body "<答案>"`，`gh issue close <n>`，再把上下文指针（要点 + 链接）追加到 map 的 Decisions-so-far。
