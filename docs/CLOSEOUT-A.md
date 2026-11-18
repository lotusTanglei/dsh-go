# CLOSE-OUT A · P5 四页补齐

2026-11-18。自动数据/静态验收通过，**静态证据 ≠ 视觉通过**。

## 结果与证据

- 三闸原始输出：[a-gates.log](../probes/closeout/a-gates.log)，Node 24.21.0，26 files / **131 tests**，typecheck/build exit 0。构建前后均编译，避免陈旧 lib 假绿。
- 新增服务端 focused：[修复后输出](../probes/closeout/a-server-focused-fixed.log)。首次 [失败输出](../probes/closeout/a-server-focused.log) 为 Electron 直接导入 TS 的 `.js` 依赖不能解析；将展示层配置投影放到独立 panel/settings 模块，保留 config 原无本地运行依赖边界后通过，不隐去失败。
- 隔离真实 Host 零 token：[a-live-result.json](../probes/closeout/a-live-result.json)。三个 preset present/no broken，runtime ready，实际 Connection handler + owner Peer 的 threads/settings/health 均200，clientModules 真实资源200/33919bytes，当前factory匹配、七页中英文key齐、Slot注册恰3次；0模型，runtime.dispose后整个agents.list=0。
- CLI启动首次被workspace-write拒绝写开发profile生成的cordis.yml；在单次授权后同命令成功。没有更改desktop、没有安装依赖。正常DSH开发profile生命周期生成root/session不等于修改用户patch；源码包与临时overlay在工作区。开发root配置与会话历史保留，owner lock释放。
- [静态产物断言](../tests/client/artifact.test.ts)：通知/侧栏/main三次注册、无root替代、七页i18n、已inspect核实主题tokens；[字段接线契约](../tests/client/pages.test.ts)。不模拟React/DOM，不把这些断言当真实渲染。
- 独立UI/UX只读审查已完成：修复null时间被Number强转为0的伪stallMs与语言切换冻结来源标签；随后全量131绿。

## 四页口径

| 页 | 自动实现/证明 | 边界 |
|---|---|---|
| Threads | 来源分组、最后入站、真实Trigger数、订阅、实际Eval state/ID、上一页/下一页 | 不是会话全文消息数；offset不是快照分页，活跃数据跨页可能变动 |
| Settings | 全配置安全投影；Loader raw显式值/default/派生值/环境引用表达式 | patch合称bundle/profile/overlay显式配置，不细分具体层；环境标签仅表明表达式含环境引用，带fallback，不冒称确定本值由环境提供；根表达式/缺Loader元数据为unavailable |
| Sources | id/kind/attended/健康/最后事件/暂停只读禁用switch | 仅运行已接Source；首次无事件lastAt未知；未接GitHub/飞书 |
| Health | DB主文件+WAL字节数、迁移版本、最近20终态Watchdog动作快照、Outbox pending/dropped、安全错误码 | 无判定时空数组；不回显原始error/paths；大库当前全audit扫描有规模边界 |

沿用九条POST buffered路由、结构化body与白名单，Sources复用health。没有DDL/依赖变化。

## 三级验收

- **自动可验：通过**——131测试/构建、真实资源/owner-handler/配置来源/清理实测。
- **需人工：未验**——侧栏点击、DOM/控制台、明暗主题、焦点、通知人可见。见[8条人工清单](P5-VISUAL-CHECKLIST.md)。当前desktop未安装，不能冒称此GUI已出现面板。
- **本环境不可验**——无浏览器控制时不能获取真实视觉执行证据，不造模拟截图。

自由文本用户路径脱敏、Worker allowWrite执行约束、stall后escalate缺口留下一阶段实修，不据本节宣称P6安全已过。
