# Go 原稿页面重构与答案恢复验证（2026-11-23）

## 交付边界

这是工作区实现与离线构建证据，不是已安装到当前 GUI 的版本，也不是 R1—R5 或 A01—A15 全部验收通过。未安装、启用、重启、部署、改 profile、迁移、提交 Git，未调用真实 provider、普通会话控制或外部文档。

## 本轮实现

- 固定 214px 侧栏、顶栏、面包屑、全局超管对话入口；外层 named container 驱动 180px／70px／手机菜单布局。
- namespaced `#go/` 路由、原生 hashchange／返回合同；其他 Host hash 不接管；路由只改变查看位置，不是发送许可。
- 概览只一条下一待决与项目摘要；可信项目目录 → 项目 tabs → 当前工作观察四 tabs。不把会话数当事项数，不虚构事项实体、来源关联或时间线。
- 待决列表／当前单项详情；计划、具体操作审批、普通会话问题观察分开，不同时展开全部正文。
- 持久独立对话底部图片入口／缩略图与聊天内定位、图片上下文。混合粘贴保留文字；图片存在或正在处理时阻止纯文字发送，绝不静默漏图。原图实际投递仍未实现。
- G6 `close(originalInput)` 完整原请求 digest 墓碑及指针同事务；只封存无记录 ID，拒绝 payload 冲突，迟到 prepare 不投递。已有真实状态不封存或降级。界面二次确认、严格最小 closed 回执、超时保留 closeRequested、只手动 status；404 保持 unknown。
- 双语新增 102 keys／语言；既有值不替换。设置保留分类 → 对象 → 单项编辑层级。

## 对抗复核与回归

独立只读审查发现并修复五项：已有草稿被 Supplement 改投；已观察到撤权后范围页仍保留旧正文；旧范围定位响应重新发布；导航 A→chat→A 的 ABA 迟到抢页；missing fact 的启用按钮与父处理条件不一致。

回归覆盖原稿页面实际工厂、导航 closures、原生事件回调、HTTP→隔离 SQLite、生产 panel port 的合成 Host、原题／附件／模型／配置合同。上述都不是 DOM、截图或真实用户会话验收。

## 失败记录与修正

- `test-integrated.log`：654/658 通过，4 个失败均已定位：旧 locate 页面字串、发送夹具缺新增 image refs、撤权后清正文与旧保留断言冲突、主题测试不接受 transparent。
- `test-integrated-recheck.log`：657/658 通过，剩余是透明 tab 边框的精确 CSS 声明；测试仅允许当前 `2px solid transparent` 以及 inherit／transparent，不放宽其他颜色、未知 token 或硬编码色校验。
- `test-artifact-final.log`：修正后真实已构建 artifact 的 3 项合同通过。
- `typecheck-final.log`：TypeScript noEmit 通过。
- `build.log`：Host TypeScript、显式注入全部浏览器工厂、客户端语法检查通过。
- `test-runtime-final.log`：37 项 runtime、5 项 HTTP+SQLite、3 项 artifact，共 45 项通过。
- `test-integrated-final.log`：最终匹配全客户端与受影响跨层代码的 **22 文件／695 项测试全部通过**（47.43s，exit0）。包含全部客户端、141 项业务答案核心、37 项 runtime、HTTP＋隔离 SQLite 和真实构建 artifact；这是受影响集成门禁，不是全仓库回归。

## 离线包

`npm pack --ignore-scripts` 未执行安装脚本；dry-run 与实际清单一致。[内容核对](<pack-content-check.json>) 验证 193 个 regular entries 的每个字节与工作区一致，包含 Host/client、项目工厂、答案封存服务、双语和实施合同，没有 state、凭据、node_modules 或 probes。SHA256：`58b380bd88f1bf41e713d136c2669f086b9ba63b8fff2a1a35651fe726e3a160`。仅离线包，未安装或部署；不代表全仓库、真实 GUI 或 R1—R5 已通过。

## 全量与真实 GUI 未验

这不是全仓库门禁。此前 2026-11-22 全量存在跨用例长暂停／超时，备用 Node24 又被本机 native 签名策略拒绝；失败记录仍保留于 [历史验证](<../g3-g6-ui-final-20261122-g51inn/VERIFICATION.md>)。本轮不删除回归、不提高 timeout、不把定向通过替代全量，也不机械重复已暂停路径。

当前 URL：`http://127.0.0.1:53162`。匿名只读探活返回 HTTP401，只证明服务可达且要求认证，不能据此说用户未登录、插件未加载或新版可用。没有绕过 owner 认证，没有浏览器／DOM／截图能力，没有替代服务器；浅深主题、窄屏、焦点、IME、图片放大及真实点击未通过验收。

真实普通控制／业务回答／原图理解／阶段调用继续 fail-closed。L1/L2、目标 durable receipt、最终 provider I/O 原子授权、腾讯 OAuth／图像／remote revision／普通文档、本地 Office/PDF、来源→目标、完整父子工作／审批／验收证据、跨 epoch 恢复仍有缺口。阻断不是这些需求已经完成。
