# Go

跑在 DeepSeek Harness（DSH）上的单机、单用户“超管”bundle：一个入口，既能控制你已有的受管会话，也能自己派 Worker，进展与待决策用人话回到同一界面。

**v1 边界：[SCOPE-V1](docs/SCOPE-V1.md)（2026-11-24 冻结）。当前状态：代码与自动证据完成，v1 尚未验收——缺真实 Host 探针与你本人的实图+点击。** 逐项证据见 [VERIFY-V1](docs/VERIFY-V1.md)。

## 当前能力（v1 范围）

| 能力 | 状态 |
|---|---|
| 单入口工作台：概览 / 项目 / 待决策 / 超管对话 / 设置 | 已实现，视觉未验收 |
| 范围管理：项目→会话默认纳入、排除/恢复、跨重启保留 | 已实现 |
| 自然语言定位：阶段模型解析口语意图 → 既有 locate 证据链 → 歧义只追问 | 已实现，真实模型未验 |
| 投递前人工确认：绑定目标+动作+正文+图片，改任一即失效 | 已实现 |
| 控制受管会话：继续 / 补充 / 纠偏 / 停止，Fake Host 合同 + 真实回执语义 | 已实现，真实 Host 未验 |
| cold 会话唤醒：一次 resume、原 preset、身份/模型漂移即回滚 | 已实现，真实 Host 未验 |
| 图片随消息投递：视觉能力闸 + 原字节 digest 校验 + image blocks | 已实现，真实看图未验 |
| 待决策：Host 有投影的 timed 问题可答；legacy/通用审批标“未覆盖” | 已实现，真实回答未验 |
| 阶段模型：默认+六阶段覆盖、真实调用、回执披露非原子窗口 | 已实现，真实 provider 未验 |
| Worker：自建票根 Agent + 每票工作副本 + sandbox-exec 进程树写边界 | 已实现，本机探针 18/18 通过；真实往返未验 |
| 台账：幂等命令、重启恢复、unknown 不换 ID 重发 | 已实现 |

**v1 不做**：外部来源（企微/腾讯文档/本地文档/GitHub issue）、legacy 审批集中投影、跨 Host/多用户、工作流 DSL、备份与成本曲线。下一版重新接入来源。

## 自动门禁

```sh
pnpm -s build && pnpm -s typecheck && pnpm -s vitest run   # 1529 tests / 77 files
node probes/worker-isolation/run.mjs                        # 隔离探针，18/18
npm pack --dry-run                                           # 包内容校验
```

隔离探针允许：票内写/读、heredoc、python、tsc、`node --test`；拒绝：父目录、跨票、`$HOME`、`/tmp`、heredoc/python 外写、延迟后台写、symlink/hardlink 逃逸、嵌套 sandbox 放宽。

## 运行环境

- 安装版 DSH `0.2.2-rc.5`（Electron 44.7.0 / Node 24.21.0），`engines.dsh: >=0.2.2-rc.3 <0.3.0`
- 持久化用内置 `node:sqlite`，零原生依赖
- 不修改任何 `@deepseek-ai/*` 包，通过 bundle patch 加载
- Worker 执行默认 fail-closed；只有 `executionBoundary: verified-dir` 且本机隔离收据通过才放行

## 读什么

| 文档 | 内容 |
|---|---|
| [SCOPE-V1](docs/SCOPE-V1.md) | **v1 唯一权威边界**与 15 条决策记录 |
| [VERIFY-V1](docs/VERIFY-V1.md) | 当前证据、未验清单、复跑命令、完成判定 |
| [WORKER-ISOLATION](docs/WORKER-ISOLATION.md) | L1/L2 实现、探针证据与残余风险 |
| [001 · 领域模型](docs/001-domain.md) | 对象、状态机、不变式 |
| [002 · 架构](docs/002-architecture.md) | 分层、三个会话角色、Source/Channel |
| [005 · 安全与预算](docs/005-security-budget.md) | 信任边界、权限矩阵、审批 |
| [GO-SESSION-ACTIONS](docs/GO-SESSION-ACTIONS.md) | 会话控制/唤醒动作合同 |
| [GO-STAGE-MODELS](docs/GO-STAGE-MODELS.md) | 阶段模型与安装版合同 |
| [GO-DECISIONS](docs/GO-DECISIONS.md) | 待决策回答合同 |
| [GO-IMAGE-LIFECYCLE](docs/GO-IMAGE-LIFECYCLE.md) | 图片生命周期与投递 |

`docs/000/006/007`、`docs/superagent-design-20261121-v2/`、`docs/KANBAN-*` 与 `docs/FINAL-VERIFY*` 为历史设计/验收记录，与 SCOPE-V1 冲突时一律以 SCOPE-V1 为准。

## 复现

```sh
pnpm -s typecheck && pnpm -s test && pnpm -s build
node --test tests/domain-bare.test.mjs
```

Desktop profile 由应用管理，CLI 的 plugin add / dump-config 会被拒绝；安装使用桌面 Plugin Manager 的本地目录入口。`cordis.patch.yml` 配置数据目录；`host-runtime.json` 是安装版 Schemastery 引导路径，迁移到其他机器时需设置新路径（或由 `DSH_INSTALL_DIR` 提供）。迁移只增不改、降级拒开、升级前先备份；文件锁异常退出后只回收已确认死亡的 owner，无法确认的损坏锁 fail-closed。
