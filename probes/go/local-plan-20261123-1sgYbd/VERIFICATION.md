# 本地来源 → 带出处待审阅计划（2026-11-23）

## 范围

本轮补齐本地无图来源到现有计划审阅链的可信接线，不是完整 Go 交付、真实会话控制或目标执行。未安装、部署、变更 profile、执行生产迁移、提交代码或调用真实模型／远程文档。测试使用隔离临时 SQLite、临时文件与明确 fake Host。

使用链：授权根内明确 MD/TXT/CSV → 手动 scan → 人工审阅并 claim 独立草稿 → 显式带出处 handoff → Host fresh 核实 → 空当前主对话填稿 → 另行发送 → 来源上下文工具证据 → 不可变计划 → 独立人工确认。已有草稿、目标、请求或附件不能被覆盖；独立原稿保留。含图材料双端阻断，不偷偷省图。

## 对抗检查与修正

1. **来源身份混用**：DocumentOrigin 扩展为精确五字段 local-document，旧 wecom digest 字节不变；Host facade 按 kind 分派，各 authority 拒绝其他来源 kind，不能只凭相同 hash 借权。
2. **跨 epoch 复活**：出处 digest 明确包含当前 workspace epoch；计划与上下文都从真实 workspace binding 重验，不靠客户端或重扫相同文件复活旧 token。
3. **事务／恢复**：来源 reserve 参加原 command journal 事务，不嵌套；失败同回滚。link 仅在 admission 已验证 settlement 后补 exact owner／origin／journal／thread，不因后续源文件变化否认已经发生的 settlement。新来源 stale 错误在 Host 映射为 document_*，避免单条失效命令使整个恢复失败。
4. **CSV 敏感结构**：原始 CSV 扫描不能发现 password 作为列名的短值。新增规范化敏感列与派生行 JSON 检查，提前拒绝而非删词脱敏，保留原有公共链接策略；不声称秘密识别完备。
5. **选中范围**：模型只取所选 CSV 行 JSON，明确标为 csv-row-json 并保留整份原文 digest／位置；不冒充逐字 CSV，不连带其他行正文。完整原文仍在来源审阅页。
6. **UI 迟到与占用**：精确 envelope／digest／claim 绑定，导航、隐藏、往返、epoch ABA、旧按钮和双击反例；parent callback 再验当前页与所有占用，false 保留原稿，成功也仅填稿不发送。

## 验证记录

- 首次跨层门禁 `test-bridge-first.log`：84/85，通过真实计划／确认／重启；唯一失败是新恢复测试期望普通聊天 processing，而已结束 turn 的正常状态为 published。按现有状态语义改为精确 published，未放宽来源、执行或回执校验。
- `test-bridge-recheck.log`：85/85 通过。
- 子任务最终报告：本地核心 100/100、实际序列化设置工厂 74/74，独立 noEmit 通过。主线程最终集成另行核实，不以子任务计数相加冒充全量。
- `build.log`：主线程 TypeScript noEmit、Host 构建、客户端工厂构建、客户端语法检查、git diff --check 通过。
- `test-integrated-final.log`：主线程最终受影响集成门禁 **29 文件／814 项全部通过**（43.68s，exit0），包括全部客户端、100 本地来源核心、39 production-port＋fake Host runtime、17 共有出处合同、11 企微来源、计划／命令／对抗与 HTTP 回归、真实已构建 bundle。不是全仓库回归，未重复声称旧全量通过。

## 离线包核对

`npm pack --ignore-scripts` 成功，未安装或运行安装脚本。[内容核对](<pack-content-check.json>) 验证 193 个 regular entry 与当前工作区逐字节一致，要求的 Host／来源核心／客户端／双语／合同文档均在；已知状态库、依赖和 probes 路径未打入。SHA256：`56bb595aa285dfdebc035fb12d20ea7e7ccbc418cbcc4a8b3b2bab8148421997`。这不是秘密识别完备证明、安装态验证或整体交付声明。

## 仍未通过

这不是全仓库回归。历史全量超时／worker RPC 失败未因本轮定向门禁消除，不提高 timeout、删除回归或机械重复暂停路径。当前 GUI 未安装新版，真实 DOM／键盘／IME／主题／窄屏未验。生产普通控制、原图理解／实际投递、阶段模型真实调用继续关闭；腾讯完整 OAuth／图像／远端版本／普通文档、Office/PDF、含图计划、真实来源→目标及父子工作／审批闭环仍未完成。

文件读取仍是同步有界检测，不是 openat 内核隔离或文件系统／SQLite 原子授权；外层事务回滚可能撤销 blocked head 元数据，但下一次仍执行 fresh。安全拒绝不等于对应产品需求已完成。
