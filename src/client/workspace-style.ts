/** Theme-token surfaces, one task-first layout. No body mount or global reset. */
export function workspaceStyles(): string {
  return `
.saw{box-sizing:border-box;height:100%;min-height:0;min-width:0;padding:calc(var(--dsh-frame-top-clearance,0px) + 12px) 20px 16px;display:flex;flex-direction:column;gap:16px;position:relative;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit;font-size:13px;line-height:1.5;container-type:inline-size}
.saw *{box-sizing:border-box}
.saw h1,.saw h2,.saw h3,.saw h4,.saw h5,.saw p{margin:0}
.saw h1{font-size:18px;letter-spacing:-.03em;white-space:nowrap}
.saw h2{font-size:16px}.saw h3{font-size:14px}.saw h4{font-size:13px}
.saw p+p{margin-top:6px}
.saw button,.saw input,.saw textarea,.saw select{font:inherit;color:var(--dsw-alias-label-primary)}
.saw button:focus-visible,.saw input:focus-visible,.saw textarea:focus-visible,.saw select:focus-visible,.saw summary:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.saw button{cursor:pointer}.saw button:disabled{opacity:.5;cursor:default}
.saw input,.saw textarea,.saw select{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:7px;padding:7px 9px;min-width:0}
.saw input::placeholder,.saw textarea::placeholder{color:var(--dsw-alias-label-secondary)}
.saw textarea{resize:vertical;max-height:180px}.saw textarea:disabled{opacity:.7}
.saw-top{position:relative;display:flex;align-items:center;gap:16px;flex-wrap:wrap;flex-shrink:0;min-height:36px}
.saw-brand{display:flex;align-items:center;gap:14px;min-width:0}
.saw-top-actions{display:flex;align-items:center;gap:8px;margin-inline-start:auto}
.saw-connection{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.saw-connection i{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.saw-connection-error{color:var(--dsw-alias-state-error-primary)}
.saw-meta,.saw-message-head time,.saw-fields dt{color:var(--dsw-alias-label-secondary);font-size:12px}
.saw-search{flex:1;min-width:120px;max-width:240px;margin-inline-start:auto}.saw-search input{width:100%}
.saw-btn{display:inline-flex;justify-content:center;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:6px 10px;min-height:32px;background:var(--dsw-alias-bg-layer-1);text-align:center;overflow-wrap:anywhere}
.saw-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.saw-btn[aria-pressed=true]{border-color:var(--dsw-alias-label-primary);font-weight:600}
.saw .saw-send,.saw .saw-action-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-label-primary);font-weight:600}
.saw .saw-send:hover:not(:disabled),.saw .saw-action-primary:hover:not(:disabled){background:var(--dsw-alias-label-primary);opacity:.85}
.saw .saw-text-btn{background:var(--dsw-alias-bg-layer-1);border:0;font-size:12px;padding:4px 6px}
.saw-icon-btn{width:32px;padding:4px;font-size:18px}
.saw-banner{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;flex-shrink:0;overflow-wrap:anywhere}
.saw-boundary{font-size:11px;color:var(--dsw-alias-label-secondary)}
.saw-boundary summary{cursor:pointer;font-size:11px;list-style:none;padding:4px 0;white-space:nowrap}
.saw-boundary summary::-webkit-details-marker{display:none}
.saw-boundary[open]{position:absolute;top:0;inset-inline:0;z-index:4;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:12px 16px;color:var(--dsw-alias-label-primary)}
.saw-boundary p{margin-top:8px;max-width:70em}
.saw-safety-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-secondary);margin:0 6px 1px 0}
.saw-error{color:var(--dsw-alias-state-error-primary)}
.saw-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.saw-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
/* Main work first in both DOM and visual order. Conversation is an auxiliary rail. */
.saw-workspace{flex:1;min-height:0;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) 304px;grid-template-areas:"work chat";gap:24px;overflow:hidden}
.saw-workspace[data-review-open=true]{grid-template-columns:minmax(0,1fr) min(560px,50%)}
.saw-board-region{grid-area:work;position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.saw-board-head{display:flex;align-items:center;gap:8px;padding:0 0 16px;flex-shrink:0;flex-wrap:wrap}
.saw-board-head h2{font-size:20px;letter-spacing:-.025em;margin-inline-end:12px}
.saw-work-scroll{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0 4px 16px 0;display:flex;flex-direction:column;gap:24px}
.saw-work-scroll>.saw-ledger,.saw-work-scroll>.saw-briefing-group{flex-shrink:0}
.saw-ledger{min-width:0}
.saw-ledger-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.saw-ledger-head h3{font-size:13px}
.saw-scope-details{font-size:11px;color:var(--dsw-alias-label-secondary);max-width:100%}
.saw-scope-details summary{cursor:pointer;list-style:none}.saw-scope-details summary::after{content:" ⌄"}
.saw-scope-details[open]{flex-basis:100%;order:2;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.saw-scope-details p{margin-top:8px}
.saw-coverage{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.saw-columns{min-width:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:start}
.saw-column{display:flex;flex-direction:column;min-height:180px;min-width:0;border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.saw-column-head{display:flex;align-items:center;gap:8px;padding:12px 10px 6px;flex-shrink:0}
.saw-column-head h3{font-size:12px;font-weight:500}
.saw-count{display:inline-block;min-width:20px;text-align:center;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.saw-column-scroll{min-height:0;padding:8px}.saw-column-scroll>.saw-meta{font-size:11px;padding:6px 2px}
.saw-card{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);margin-bottom:8px;overflow:hidden}
.saw-card>.saw-btn{margin:0 8px 8px}
.saw-card-open{display:block;border:0;background:var(--dsw-alias-bg-base);width:100%;padding:10px;text-align:start;white-space:normal;overflow-wrap:anywhere}
.saw-card-open:hover{background:var(--dsw-alias-bg-layer-2)}
.saw-card-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:600;font-size:14px;line-height:1.45;margin:8px 0}
.saw-card-line{display:block;font-size:12px;margin-top:6px}
.saw-badge{display:inline-block;padding:2px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-size:11px}
.saw-attention{font-size:12px;overflow-wrap:anywhere}.saw-attention .saw-fields{display:block}.saw-attention dd{margin:0}
.saw-board-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:36px 20px;border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;text-align:center}
.saw-board-empty h4{font-size:15px;font-weight:500}.saw-board-empty p{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:32em}
.saw-board-empty>.saw-btn{margin-top:8px}
.saw-empty-mark{font-size:28px;line-height:1;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.saw-flow-labels{display:flex;justify-content:center;align-items:center;gap:12px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:20px;flex-wrap:wrap}
.saw-flow-labels span+span::before{content:"→";margin-inline-end:12px}
/* Actionable decisions, then observed work. Never an additional task ledger. */
.saw-briefing-group,.saw-recent{display:flex;flex-direction:column;gap:8px;min-width:0;flex-shrink:0}
.saw-group-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:2px}
.saw-group-head h3{font-size:13px}.saw-group-head .saw-btn{font-size:11px;border:0;padding:2px 4px;min-height:28px;background:var(--dsw-alias-bg-layer-1)}
.saw-decision-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:10px}
.saw-decision{display:flex;flex-direction:column;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere;min-width:0}
.saw-decision h4{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:4px 0;font-size:14px;line-height:1.5}
.saw-decision>.saw-line-clamp{margin-bottom:12px}.saw-decision>.saw-btn{align-self:flex-start;margin-top:auto;min-height:30px;font-size:12px}
.saw-line-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;font-size:12px;color:var(--dsw-alias-label-secondary)}
.saw-source-state{font-size:12px;color:var(--dsw-alias-label-secondary);padding:10px 12px;border-inline-start:2px solid var(--dsw-alias-border-l1)}
.saw-session-work{display:flex;flex-direction:column;gap:8px;min-width:0;flex-shrink:0}
.saw-project-group{min-width:0;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.saw-project-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.saw-project-head h4{font-size:14px;font-weight:600}
.saw-project-head small:last-child{margin-inline-start:auto}
.saw-project-preview-hint{font-size:11px}
.saw-session-work-card h5{font-size:13px}
.saw-session-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:10px}
.saw-session-work-card{padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere;min-width:0}
.saw-session-work-card h5{line-height:1.5;font-weight:600}
.saw-session-preview .saw-session-work-card h5{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.saw-session-source{margin-top:4px}.saw-session-preview .saw-session-source{font-size:11px}
.saw-session-line{margin-top:6px;font-size:12px;white-space:pre-wrap}
.saw-session-preview .saw-session-line{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.saw-session-facts{margin-top:10px;color:var(--dsw-alias-label-secondary);font-size:11px}
.saw-session-facts summary{cursor:pointer}.saw-session-facts>span{display:block;margin-top:4px}
.saw-session-preview .saw-session-facts{font-size:10px}
.saw-session-decision{margin-top:8px;padding-inline-start:8px;border-inline-start:2px solid var(--dsw-alias-label-primary);font-size:12px;white-space:pre-wrap}
.saw-session-decision small{color:var(--dsw-alias-label-secondary)}
.saw-session-work-card>.saw-text-btn{margin-top:8px}
.saw-session-sources{margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.saw-session-excluded{margin-top:8px}.saw-session-excluded>summary{cursor:pointer;font-size:12px}
.saw-session-excluded>p,.saw-session-excluded>.saw-session-work-card,.saw-session-excluded>.saw-btn{margin-top:8px}
/* Communication stays focused on input/reply; long history is secondary. */
.saw-chat{grid-area:chat;position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;overflow:hidden}
.saw-section-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-shrink:0}.saw-section-head h2{font-size:13px}
.saw-head-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.saw-chat-inner{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.saw-messages{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px;display:flex;flex-direction:column;gap:12px;scrollbar-gutter:stable}
.saw-chat-intro{padding:8px 2px 16px}.saw-chat-intro h3{font-size:15px;font-weight:500;margin-bottom:8px}.saw-chat-intro p{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.saw-recent-details{font-size:12px}.saw-recent-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary);margin:8px 0}
.saw-new-reply{padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);flex-shrink:0}.saw-new-reply p{margin:6px 0}
.saw-record-row{display:block;width:100%;text-align:start;border:0;border-top:1px solid var(--dsw-alias-border-l1);padding:10px 0;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.saw-record-row:hover{background:var(--dsw-alias-bg-layer-2)}
.saw-record-heading{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.saw-record-heading strong{min-width:0;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;font-size:13px}.saw-record-heading .saw-badge{flex-shrink:0;max-width:45%}
.saw-record-summary{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.saw-history-selector{display:flex;align-items:center;gap:6px;padding:8px 10px;font-size:12px}.saw-history-selector select{flex:1;max-width:100%}
.saw-message{flex-shrink:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px;background:var(--dsw-alias-bg-base);overflow-wrap:anywhere}.saw-message-user{margin-inline-start:16px}.saw-message-notice{border-inline-start:3px solid var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.saw-message-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:6px}.saw-message-head time{font-size:10px}
.saw-pre{white-space:pre-wrap;overflow-wrap:anywhere}.saw-empty{padding:18px 4px;color:var(--dsw-alias-label-secondary)}.saw-empty h3{color:var(--dsw-alias-label-primary);margin-bottom:8px}
.saw-composer{flex:0 1 auto;min-height:0;display:flex;flex-direction:column;align-items:stretch;gap:10px;margin:10px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);max-height:52%;overflow:auto}
.saw-composer textarea{width:100%;height:84px;min-height:64px;max-height:160px;flex-shrink:0;border:0;border-radius:4px;padding:4px 2px;background:var(--dsw-alias-bg-base);resize:vertical}
.saw-compose-modes{display:flex;gap:3px;align-self:flex-start;padding:0;background:var(--dsw-alias-bg-base)}
.saw-compose-modes .saw-btn{border:0;background:var(--dsw-alias-bg-base);font-size:11px;min-height:26px;padding:3px 8px}.saw-compose-modes .saw-btn[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2)}
.saw-compose-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.saw-compose-footer>.saw-send{width:auto;min-width:76px;margin-inline-start:auto;padding:6px 12px}.saw-compose-footer>.saw-meta{font-size:10px}.saw-compose-footer>.saw-request{width:100%}
.saw-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);padding:3px 5px;overflow-wrap:anywhere}.saw-chip .saw-btn{padding:0 6px;min-height:26px}
.saw-request{padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;display:grid;gap:6px}
.saw-receipt,.saw-history-info{font-size:11px;color:var(--dsw-alias-label-secondary)}.saw-message-technical summary{cursor:pointer}
.saw-collapsed{grid-template-columns:minmax(0,1fr) 44px}
.saw-collapsed .saw-chat-inner,.saw-collapsed .saw-section-head h2{display:none}.saw-collapsed .saw-section-head{padding:8px 6px;border:0}.saw-collapsed .saw-collapse{padding:8px 6px}
.saw-collapsed .saw-head-actions .saw-text-btn{display:none}.saw-collapsed .saw-head-actions{flex-direction:column}
/* Existing complete review/detail paths remain readable and independently scrollable. */
.saw-detail{position:absolute;inset:0 0 0 auto;width:min(560px,100%);z-index:2;display:flex;flex-direction:column;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.saw-detail-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-shrink:0}
.saw-detail-head h2{overflow-wrap:anywhere;min-width:0}
.saw-detail>.saw-detail-head h2{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:1.6}.saw-detail-head>.saw-btn{flex-shrink:0}
.saw-original-request{font-size:12px;margin-bottom:14px;overflow-wrap:anywhere}.saw-original-request>p{margin-top:8px;padding:10px;background:var(--dsw-alias-bg-base);border-radius:7px}
.saw-result-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.saw-result-section{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.saw-result-section h3{margin-bottom:8px}
.saw-checks{list-style:none;padding:0;margin:8px 0}.saw-checks>li{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.saw-check-heading{display:flex;align-items:flex-start;gap:8px;justify-content:space-between}.saw-check-heading strong{min-width:0;overflow-wrap:anywhere;font-weight:500}.saw-check-heading .saw-badge{flex-shrink:0}.saw-checks p{font-size:12px;margin-top:6px;color:var(--dsw-alias-label-secondary)}
.saw-result-technical{margin-top:16px;font-size:12px;overflow-wrap:anywhere}.saw-result-technical summary,.saw-original-request summary{cursor:pointer}
.saw-detail-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-shrink:0}
.saw-detail-scroll,.saw-system-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:12px;scrollbar-gutter:stable}
.saw-detail-actions{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1);flex-shrink:0}
.saw-box{padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);margin:8px 0;overflow-wrap:anywhere;flex-shrink:0}.saw-box h3,.saw-box h4{margin:0 0 6px}.saw-box .saw-row{margin-top:10px}
.saw-fields{display:grid;grid-template-columns:minmax(84px,auto) minmax(0,1fr);gap:6px 10px;margin:8px 0;overflow-wrap:anywhere;white-space:pre-wrap}.saw-fields dt{align-self:start}.saw-fields dd{margin:0;min-width:0}.saw-fields .saw-fields{margin:0;grid-template-columns:minmax(60px,auto) minmax(0,1fr)}
.saw-list{padding-left:20px;margin:4px 0;white-space:pre-wrap}.saw-list li+li{margin-top:4px}.saw-brief section{margin:12px 0}.saw-brief h4{margin-bottom:4px}
.saw-fingerprint{font-size:11px;word-break:break-all;white-space:pre-wrap}
.saw-timeline{list-style:none;margin:0;padding:0}.saw-timeline li{border-inline-start:2px solid var(--dsw-alias-border-l1);padding:6px 12px 16px;display:grid;gap:4px}.saw-timeline time,.saw-timeline small{font-size:12px;color:var(--dsw-alias-label-secondary)}
.saw-setting{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.saw-system{position:absolute;top:calc(var(--dsh-frame-top-clearance,0px) + 12px);bottom:12px;right:12px;width:min(600px,calc(100% - 24px));z-index:3;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.saw-inspector{position:absolute;inset:48px 0 0;display:flex;flex-direction:column;min-height:0;z-index:3;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1)}
.saw-inspector-scroll{flex:1;min-height:0;overflow:auto;padding:12px;overscroll-behavior:contain}.saw-inspector .saw-box{margin:0;border:0;padding:0}
.saw-confirm{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:18px;width:min(600px,calc(100% - 32px));max-height:calc(100% - 40px);overflow:auto}
.saw-confirm::backdrop{background:var(--dsw-alias-bg-base);opacity:.72}.saw-confirm h2{margin-bottom:8px}.saw-confirm-body{max-height:45vh;overflow:auto;margin:12px 0}
.saw-reason{display:flex;flex-direction:column;gap:6px;margin:12px 0}.saw-reason textarea{width:100%}.saw-confirm .saw-row{justify-content:flex-end}
.saw-document-sources{display:flex;flex-direction:column;gap:10px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.saw-document-evidence{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.saw-document-cell{padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;overflow-wrap:anywhere}.saw-document-cell>.saw-badge{margin-inline-start:8px}
.saw-document-image{margin:0;padding:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:7px}.saw-document-image figcaption{margin-bottom:6px;font-size:12px}.saw-document-image img{display:block;max-width:100%;height:auto}
.saw-document-review{display:flex;align-items:flex-start;gap:8px}.saw-document-review input{flex-shrink:0;margin-top:3px}
.saw-mobile-tabs{display:none}
@container(max-width:1050px){
.saw-mobile-tabs{display:flex;gap:4px;padding:3px;width:fit-content;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.saw-mobile-tabs .saw-btn{border:0;background:var(--dsw-alias-bg-layer-1);font-size:12px;min-height:30px}.saw-mobile-tabs .saw-btn[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2)}
.saw-workspace,.saw-collapsed{display:flex}.saw-chat,.saw-board-region{width:100%;flex:1}
.saw-workspace[data-mobile-tab=board] .saw-chat{display:none}.saw-workspace[data-mobile-tab=chat] .saw-board-region{display:none}
.saw-collapse{display:none}.saw-collapsed .saw-chat-inner{display:flex}.saw-collapsed .saw-section-head h2{display:block}
.saw-collapsed .saw-head-actions .saw-text-btn{display:inline-flex}.saw-collapsed .saw-head-actions{flex-direction:row}.saw-collapsed .saw-section-head{padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.saw-chat-intro{max-width:34em}.saw-composer{max-height:58%}.saw-detail{width:min(600px,100%)}
}
@container(max-width:720px){
.saw-top{gap:8px}.saw-brand{gap:8px}.saw-connection{font-size:10px}.saw-boundary{order:3;width:100%}
.saw-board-head h2{width:100%;font-size:18px}.saw-board-head{padding-bottom:12px}.saw-search{max-width:none;min-width:80px}.saw-board-head select{max-width:115px}
.saw-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.saw-session-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.saw-work-scroll{gap:20px}.saw-detail{width:100%}.saw-fields{grid-template-columns:minmax(70px,auto) minmax(0,1fr)}.saw-system{top:8px;bottom:8px;right:8px;width:calc(100% - 16px)}
}
@container(max-width:440px){
.saw-columns,.saw-session-grid{grid-template-columns:minmax(0,1fr)}.saw-top-actions{gap:3px}.saw-review-entry{font-size:11px;padding:4px 6px}.saw-board-head>.saw-btn{font-size:11px;padding:6px 8px}
}
@media(max-height:650px){
.saw{gap:8px;padding-bottom:8px}.saw-section-head{padding:8px 10px}.saw-composer{padding:8px;gap:6px}.saw-composer textarea{height:60px;min-height:48px}.saw-inspector{top:42px}
}
@media(prefers-reduced-motion:reduce){.saw *{scroll-behavior:auto}}
`
}
