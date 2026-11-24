# G3 原图链与生命周期：实施合同

## 用户路径

在独立超管对话的底部文字＋图片入口上传/粘贴（无须先选项目）→ 选择附件缩略图进入同一聊天区的图片详情 → 本地与 Host 原图预览 → 核对定位目标 → 绑定目标与范围 revision → 经能力/外发授权后才理解或提供给受管目标。2026-11-23 已补混合剪贴板文字与图片时保留插入位置上的文字，不静默吞掉；附件存在或仍在本地处理时阻断当前纯文字发送口，不把上传当投递。当前生产执行闸继续关闭，原图理解/目标投递缺实际能力时显示阻断，不去图继续、不用 OCR/占位充当看图。

## 最窄数据合同（现有kv，无DDL/迁移）

- 原图上传：`epoch / draftId / uploadId / digest / mediaType / encoded`，UUID稳定ID，同uploadId不同字节/上下文409。当前只接受有CRC/解压后行检查、有限维度/像素/字节的8bit非交错PNG（灰度/RGB/灰度alpha/RGBA）；JPEG、调色板PNG、交错PNG、动画等尚不支持，明确阻断，不转换或裁剪需求。原字节原样保存，digest独立于预览/OCR。字节不进普通日志、错误或审计。
- Host附件：opaque `imageId`、digest、mime、尺寸、大小、draftId、epoch、seq、状态；独立私有证据目录内容寻址保存原始字节。浏览器不选择存储路径/URL，读取只能引用Host附件ID+digest+revision。
- staged上传不等于发送。`bind` 显式指定当前已验证target、scope/fact及附件seq，Host重新核验；定位不是图像访问许可。绑定后读取/使用每次重验授权与范围，排除立即阻止后续读取；恢复不复活旧绑定。
- 当前 Host-only `lease` 绑定附件/seq/digest、用途、目标和范围；进行中引用不能 release/rebind，未知外发结果保持引用，不因取消就假设没发送。**动作/调用 ID 与真实目标接收回执的绑定尚未实现**，不能据此启用生产外发。release仅撤回本地草稿/新访问；字节仍保留且没有后台 GC、备份删除或自动到期承诺，不保证第三方追溯删除。
- 生产原图理解与目标可访问要求严格原图能力、路由披露和Host授权；当前不注入真实外发端口。合成测试必须比较目标收到的字节/digest，不能以preview img loaded或description代替模型实际看图。

## 信任与验收

图片/OCR/文档里的指令都是证据，不构成授权。任何模型、浏览器、文件文本均不能伪造trusted context。HTTP owner/Origin/epoch闸保留。原URL真实点击、图片放大、粘贴/键盘/焦点/IME与窄屏另验；无浏览器不报告通过。

## #7 实现状态（2026-11-25，合成证据）

目标投递已接通到已存在的投递前确认链（#3–#6）；原图理解仍未实现，仍为显式阻止。

- **确认阶段**：`prepare`/`confirm` 回执新增只读 `imageCapability: not-required | supported | unsupported | unknown`。有图且未知=阻断预期；确认卡展示绑定图片缩略图、数量与原图提示，并在投递前提示能力风险，不等到失败。
- **发送前能力闸**：`dispatch` 在既有 dispatch fence 之后、任何附件/消息副作用之前，取目标会话当前模型（live 用 `agent.model.current()`；cold 唤醒后用同一方式）并调用 `ctx.llm.resolveModelInfo`。仅当 `inputModalities` 精确含 `image` 才放行；缺失/异常/unknown 一律固定码 `delivery_image_model_unsupported` blocked，不发送、不去图继续、不换模型。
- **原图转 Host 附件**：只对已绑定的确切引用取 Host 私有原字节；字节 SHA-256 必须等于确认 digest，且 `verify`/`materialize` 均在创建 dispatch fence 前重读校验，失配以 `image_original_corrupt` 拒绝。逐张 `ctx.attachments.saveImage({data, mediaType:'image/png', name})`，每条已确认消息一次；内容块为 `[{type:'text',text},{type:'image',attachment},…]`，随 continue→followup / supplement→inject / steer→steer 发送。stop 仍不允许图片。Host 可做规范化编码，引用形状由 Host 保证；本地提交的原始字节已按 digest 校验。
- **幂等/恢复**：附件创建与消息投递都在同一 dispatch fence 内，同 confirmed 重放只返回持久回执，不重复 saveImage/发送；saveImage 成功但消息结果未知 → `dispatch_unknown`（`delivery_image_upload_unknown`），重放/重启只对账、不换 ID 重发。固定失败码：`delivery_image_attachment_unavailable`（Host 无附件端口）、`delivery_image_original_changed`（材料化/摘要不符）。
- **测试**：真实 SQLite + Fake Host + HTTP seam 覆盖 1/5 张图（image 块数量、saveImage 来源、字节 digest）、无视觉与 unknown 阻断（saveImage/消息均 0）、确认 digest 变化与磁盘原字节被篡改拒绝、重放不重复上传/发送、上传后消息丢失 unknown 不重发、cold 唤醒后同一能力闸；客户端覆盖缩略图/原图提示/能力告警/失败保留草稿与图片。门禁沿用全量 build/typecheck/vitest。
- **真实 Host 仍缺证据**：安装版 `ctx.attachments.saveImage` 实际挂载与本机私有目录落盘、`ctx.llm.resolveModelInfo` 对真实目标模型返回 `inputModalities`、目标会话真实收到 image 块并实际看图、确认卡实图与点击、真实原图放大与窄屏。合成测试不得替代上述证据。
