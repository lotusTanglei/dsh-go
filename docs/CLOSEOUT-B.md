# CLOSE-OUT B · 完整 Watchdog 动作链

2026-11-18。**B1受控生产动作链通过；不是自然长任务/完整Router模型e2e，也不是视觉或全崩溃恢复证明。**

## B1 原始实测

[运行器](../probes/closeout/b-live.cjs)、[临时隔离overlay](../probes/closeout/b-live.patch.yml)、[原始结果](../probes/closeout/b2-live-result.json)。只启动superagent-dev；一个Ticket、一个Assignment/真实Worker，maxWorkers=1/maxRetries=0。Worker首个真实structured_output受可取消fixture拦住，故不汇报进展。直接调用同一生产runtime.tick维护路径，不另写Watchdog规则。

```text
15:36:59.204 report tool held
15:37:00.715 actual agent.steer; stallMs=4125; stallStage=1
15:37:00.820 actual subagents.interrupt; stallMs=4231; stallStage=2
15:37:00.821 hold released by abort=true
15:37:00.833 Assignment state=ended, Ticket ended/stopped/non-human
15:37:00.955 escalate notice persisted to real Router inbox; stallStage=3
TicketCount=1 / WorkerCount=1 / liveAgents=0
```

nudge→cancel间隔106ms>受控stallMs阈值100ms。三步都是`rule='stall'`，不是借预算链冒充；6条requested/completed审计，completed stage1/2/3，metrics有实际stallMs、重复次数、token、时长。通知Outbox sent/attempts1且真实inbox splice幂等id对应；**sent≠浏览器显示或人已读**。

本项目没有DSH具名`assignmentStop` Service；验证的是与Router `assignment_stop`相同的产品stopTicket持久停止路径（Assignment ended＋interrupt＋await activation.dispose），不伪造不存在的API调用。

真实provider请求 **1次**；usage input920/cacheRead3840/cacheWrite0/output178，合计**4938 token**。Router没有模型请求。第一次 [失败回执](../probes/closeout/b-live-result.json) SA_HOLD_DEADLINE保留；冷读多帧Session日志确认Worker无provider/model、请求0。根因为冷Router有pending selection却无request/header，DSH spawn仅继承历史header/options；产品现显式传`parent.model.current()`及undefined effort，离线回归覆盖。不靠fixture硬塞Worker模型掩盖产品缺口。

## B2 反例证据复用

按提示词不专门重跑20分钟长任务；引用原 [P4报告](P4-report.md#L21) 与 [FINAL-VERIFY原始记录](FINAL-VERIFY.md#L19-L24)。原用例 [20分钟每两分钟有进展](../tests/engine/watchdog.test.ts) 保留不改。本次提交门禁的全量套件正常包含该用例，不把门禁的离线重跑冒充新增长时真实测试。

## B3 审计与持久状态

动作审计原命名action=`watchdog`；sampler补为`watchdog.sample_requested/completed/failed`，也带完整metrics。断言覆盖非空6条动作记录，不能筛选0条假绿。追加stallMs不改DDL；state.stallStage存原audit JSON，取消后保留ended候选直到升级完成；离线覆盖stage2恢复后只升级一次。

## 门禁与限制

- [三闸原始输出](../probes/closeout/b-gates.log)：含并行C隐私测试的143项通过；B独立提交快照另见 [b-snapshot-gates.log](../probes/closeout/b-snapshot-gates.log)。typecheck/build均成功。
- 生产tick与定时pump同路径；无真实长时墙钟卡死/多Worker负载保证；无视觉。
- **保留crash窗口**：cancel已写ended而completed stage2审计尚未落盘时崩溃，当前恢复可能遗漏升级；本轮不宣称完整crash-safe。阶段C继续故障注入并诚实标注。
- C隐私增强并行开发，不纳入B源码提交；所有暂存内容须独立快照门禁后提交。
