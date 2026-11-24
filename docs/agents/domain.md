# Domain Docs

工程技能在探索代码库时如何消费本仓库的领域文档。

## 探索前先读这些

- 根目录 **`GLOSSARY.md`**；或
- 根目录 **`GLOSSARY-MAP.md`**（若存在）：它指向每个上下文的 `GLOSSARY.md`，读与当前主题相关的那些。
- **`docs/adr/`**：读与即将改动区域相关的 ADR。多上下文仓库还要看 `src/<context>/docs/adr/`。

如果这些文件不存在，**静默继续**：不要提示缺失，也不要主动建议创建。`/domain-modeling`（经 `/grill-with-docs`、`/improve-codebase-architecture` 到达）会在术语或决策真正定下来时按需创建。

**过渡期（v1 冻结期间）**：本仓库尚未建 `GLOSSARY.md`，领域术语的现有权威来源是 `docs/001-domain.md`（对象定义、五个状态机、十条不变式）与 `docs/SCOPE-V1.md`（v1 范围与决策记录）；`docs/002-architecture.md` 提供分层与角色。新术语沉淀进 `GLOSSARY.md` 时以这几份为准，不要另造同义词。

## 文件结构

单上下文仓库（本仓库）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── src/
```

多上下文仓库（根目录存在 `GLOSSARY-MAP.md`）：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                ← 系统级决策
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/        ← 上下文专属决策
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## 使用 GLOSSARY 的词汇

输出中命名领域概念时（issue 标题、重构提案、假设、测试名），使用 `GLOSSARY.md` 定义过的术语，不要漂移到它明确避免的同义词。

若需要的概念尚未进 glossary，这本身是信号：要么你在发明项目不用的语言（重新考虑），要么存在真实缺口（记下来交给 `/domain-modeling`）。

## 标出 ADR 冲突

如果输出与既有 ADR 矛盾，显式说明，不要静默覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重开，因为……_
