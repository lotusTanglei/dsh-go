/** Fixed, layered workspace shell; prototype proportions with host theme tokens. */
export function workspaceStyles(): string {
  return `
.saw-frame{width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;container-type:inline-size;container-name:saw-frame}
.saw{box-sizing:border-box;height:100%;min-height:0;min-width:0;padding:var(--dsh-frame-top-clearance,0px) 0 0;display:grid;grid-template-columns:214px minmax(0,1fr);grid-template-rows:minmax(0,1fr);position:relative;isolation:isolate;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit;font-size:13px;line-height:1.6}
.saw *{box-sizing:border-box}
.saw [hidden]{display:none!important}
.saw h1,.saw h2,.saw h3,.saw h4,.saw h5,.saw p{margin:0}
.saw h1,.saw h2,.saw h3,.saw h4,.saw h5{min-width:0;line-height:1.35;overflow-wrap:anywhere}
.saw h1{font-size:28px;letter-spacing:-.03em;white-space:normal}
.saw h2{font-size:19px}.saw h3{font-size:14px}.saw h4{font-size:13px}
.saw p+p{margin-top:6px}
.saw button,.saw input,.saw textarea,.saw select{font:inherit;color:var(--dsw-alias-label-primary)}
.saw :focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:3px}
.saw button{cursor:pointer;max-width:100%;white-space:normal;overflow-wrap:anywhere}.saw button:disabled{opacity:.5;cursor:default}
.saw a{color:inherit;overflow-wrap:anywhere;text-underline-offset:3px}.saw svg{flex-shrink:0}
.saw input,.saw textarea,.saw select{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:7px;padding:7px 9px;min-width:0}
.saw input::placeholder,.saw textarea::placeholder{color:var(--dsw-alias-label-secondary)}
.saw textarea{resize:vertical;max-height:180px}.saw textarea:disabled{opacity:.7}
/* Application chrome stays outside the current content's scroll container. */
.saw-sidebar{grid-column:1;grid-row:1;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:27px 15px 18px;background:var(--dsw-alias-bg-layer-1);border-inline-end:1px solid var(--dsw-alias-border-l1)}
.saw-brand{display:flex;align-items:center;gap:10px;min-width:0;padding:0 13px 31px;font-size:18px;font-weight:750;letter-spacing:-.025em}
.saw-brand-symbol,.saw-brand-mark{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border-radius:9px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-size:16px}
.saw-nav-heading{padding:27px 13px 10px;color:var(--dsw-alias-label-secondary);font-size:10px;letter-spacing:.1em}
.saw-project-index{display:flex;flex-direction:column;gap:2px;min-width:0}
.saw-pinned-project{display:flex;align-items:center;gap:9px;width:100%;border:0;border-radius:6px;padding:8px 13px;background:transparent;text-align:start;font-size:11px;color:var(--dsw-alias-label-secondary)}
.saw-pinned-project:hover{background:var(--dsw-alias-bg-layer-2)}.saw-pinned-project i{flex:0 0 7px;width:7px;height:7px;border-radius:2px;background:var(--dsw-alias-label-secondary)}
.saw-sidebar-bottom{margin-top:auto;padding-top:28px;min-width:0}.saw-sidebar-note{font-size:10px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1);margin:17px 12px 0;padding-top:14px;overflow-wrap:anywhere}
.saw-main{grid-column:2;grid-row:1;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.saw-top{position:relative;display:flex;align-items:center;gap:13px;flex-wrap:wrap;flex:0 0 auto;min-width:0;min-height:65px;padding:12px 30px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.saw-breadcrumbs{display:flex;align-items:center;gap:9px;flex:1 1 140px;min-width:0;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.saw-breadcrumbs>*{min-width:0;max-width:100%}
.saw-breadcrumbs button{padding:3px 0;border:0;background:transparent;text-align:start;font-size:inherit;color:inherit}.saw-breadcrumbs strong{font-weight:600;color:var(--dsw-alias-label-primary)}
.saw-top-actions{display:flex;align-items:center;gap:8px;margin-inline-start:auto;min-width:0;max-width:100%;flex-wrap:wrap}
.saw-main-body{position:relative;display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden}
.saw-overview-host,.saw-projects-host{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden}
.saw-overview>.saw-next-action,.saw-overview>.saw-brief-card{margin-bottom:24px}.saw-project-preview-grid{width:100%}
.saw-main-body>.saw-banner{margin:12px 30px 0}.saw-main-body>.saw-boundary{margin:8px 30px 0}
.saw-view-scroll{flex:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:32px 30px 36px}
.saw-content{width:100%;max-width:1180px;margin-inline:auto;min-width:0}.saw-page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:25px}.saw-page-heading>div{min-width:0}.saw-page-heading p{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.saw-eyebrow{font-size:10px;letter-spacing:.14em;font-weight:700;color:var(--dsw-alias-label-secondary);margin-bottom:6px}.saw-page-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex-shrink:0;padding:5px 30px;font-size:10px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1)}
.saw-menu-toggle,.saw-mobile-menu,.saw-menu-backdrop{display:none}
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
/* Overview is one next action and a compact project index, not another board. */
.saw-overview-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(230px,.85fr);gap:20px;align-items:stretch}
.saw-next-action{position:relative;display:flex;flex-direction:column;min-width:0;min-height:240px;padding:24px 27px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}
.saw-next-action::before{content:'';position:absolute;inset:26px auto 26px 0;width:3px;border-radius:3px;background:var(--dsw-alias-label-secondary)}
.saw-next-action h2{font-size:21px;letter-spacing:-.02em;margin:14px 0 9px;max-width:450px}.saw-next-action>p{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:430px}.saw-next-action>.saw-row:last-child{margin-top:auto;padding-top:22px}.saw-next-action>.saw-decision{flex:1;padding:0;border:0;border-radius:0;background:transparent}.saw-next-action .saw-decision h4{font-size:21px;margin:14px 0 9px;display:block;overflow:visible}
.saw-brief-card{display:flex;flex-direction:column;align-items:flex-start;gap:9px;min-width:0;padding:24px;border-radius:11px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}.saw-brief-card h3{font-size:16px}.saw-brief-card p{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:250px}.saw-brief-card>.saw-btn{margin-top:auto}.saw-mini-emblem{display:grid;place-items:center;width:37px;height:37px;border-radius:11px;background:var(--dsw-alias-bg-layer-1);margin-bottom:6px}
.saw-home-bottom{margin-top:28px}.saw-home-activity{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:22px;padding:12px 2px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.saw-project-preview-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin-top:14px}.saw-project-preview{display:flex;flex-direction:column;gap:12px;min-width:0;padding:18px;text-align:start;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.saw-project-preview h3{font-size:13px}.saw-project-preview footer{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:10px;color:var(--dsw-alias-label-secondary)}
.saw-project-purpose{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px}.saw-project-state{font-size:12px;color:var(--dsw-alias-label-secondary)}.saw-project-mark{display:grid;place-items:center;flex:0 0 37px;width:37px;height:37px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:650}
/* Collection → one project → one work; object lists share a quiet single surface. */
.saw-project-collection{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.saw-project-card{display:flex;flex-direction:column;min-width:0;padding:23px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.saw-project-card h2{font-size:19px;margin:17px 0 5px}.saw-project-card p{font-size:12px;color:var(--dsw-alias-label-secondary);min-height:40px}.saw-project-card>.saw-btn{width:100%;margin-top:auto}.saw-project-counts{display:flex;gap:17px;flex-wrap:wrap;padding:19px 0;margin-top:17px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}.saw-project-counts strong{display:block;font-size:16px;color:var(--dsw-alias-label-primary)}
.saw-projects{flex:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:32px 30px 36px}.saw-projects.saw-view-scroll{padding:32px 30px 36px}.saw-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:25px}.saw-actions{display:flex;gap:8px;flex-wrap:wrap}.saw-project-collection{margin-top:20px}.saw-project-card h3{font-size:19px;margin-bottom:5px}.saw-project-card details{margin:12px 0}.saw-project-card code,.saw-projects code{overflow-wrap:anywhere}
.saw-project-detail{min-width:0}.saw-project-detail-top{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:24px}.saw-project-detail-top .saw-project-mark{width:47px;height:47px;flex-basis:47px;font-size:13px}
.saw-project-tabs,.saw-work-tabs{display:flex;align-items:stretch;gap:23px;min-width:0;max-width:100%;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:22px;padding:0}
.saw-project-tabs .saw-btn,.saw-work-tabs .saw-btn{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:11px 2px;min-height:40px}
.saw-project-tabs .saw-btn[aria-pressed=true],.saw-project-tabs .saw-btn[aria-current],.saw-work-tabs .saw-btn[aria-pressed=true],.saw-work-tabs .saw-btn[aria-current]{border-bottom-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary);font-weight:700}
.saw-work-list{min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.saw-work-row{display:grid;grid-template-columns:10px minmax(0,1fr) 140px 120px 18px;align-items:center;gap:16px;width:100%;min-width:0;padding:20px 23px;text-align:start;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:0;overflow-wrap:anywhere}.saw-work-row:last-child{border-bottom:0}.saw-work-row>*{min-width:0}.saw-work-row h3{font-size:13px;margin-bottom:4px}.saw-work-row p{font-size:11px;color:var(--dsw-alias-label-secondary)}.saw-row-state{font-size:11px;color:var(--dsw-alias-label-secondary)}.saw-row-time{font-size:10px;color:var(--dsw-alias-label-secondary)}.saw-work-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.saw-work-row:where(:not(:has(>.saw-work-dot))){grid-template-columns:minmax(0,1fr) 140px 18px;gap:8px 16px}.saw-work-row:where(:not(:has(>.saw-work-dot)))>strong{grid-column:1;grid-row:1;font-size:13px}.saw-work-row:where(:not(:has(>.saw-work-dot)))>p:not(.saw-meta){grid-column:1;grid-row:2;margin:0}.saw-work-row:where(:not(:has(>.saw-work-dot)))>span{grid-column:2;grid-row:1;font-size:11px;color:var(--dsw-alias-label-secondary)}.saw-work-row:where(:not(:has(>.saw-work-dot)))>.saw-meta{grid-column:2;grid-row:2;font-size:10px;margin:0}.saw-work-row:where(:not(:has(>.saw-work-dot)))::after{content:'→';grid-column:3;grid-row:1/3;color:var(--dsw-alias-label-secondary)}
.saw-work-row:is(article){display:flex;flex-wrap:wrap;gap:10px 16px}.saw-work-row:is(article)>h3{flex:1 1 220px;margin:0}.saw-work-row:is(article)>p{flex-basis:100%;margin:0}.saw-work-row:is(article)>details{min-width:0;max-width:100%;font-size:11px}.saw-work-row:is(article)::after{content:none}
.saw-work-summary>div+div,.saw-work-summary>p+div{margin-top:18px}.saw-work-summary h4{margin-bottom:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.saw-projects .saw-work-detail{display:block;flex:none;min-height:auto;overflow:visible}.saw-projects .saw-work-detail>button{margin-bottom:20px}.saw-projects .saw-work-detail h3{font-size:23px;margin-bottom:8px}.saw-projects .saw-work-summary h3{font-size:12px}
.saw-work-structure{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(240px,.8fr);gap:20px;align-items:start}.saw-work-summary{min-width:0;padding:25px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.saw-work-summary h3{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:10px}.saw-work-summary .saw-lead{font-size:17px;line-height:1.7;max-width:620px}.saw-work-summary .saw-next{padding-top:16px;margin-top:18px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
/* Inbox never hides an unselected list: only an explicit selected detail replaces it on mobile. */
.saw-inbox-layout{display:grid;grid-template-columns:285px minmax(0,1fr);gap:20px;align-items:start;min-width:0}.saw-inbox-list{display:grid;align-content:start;gap:9px;min-width:0}.saw-inbox-item{display:block;width:100%;min-width:0;padding:18px;text-align:start;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.saw-inbox-item h3{font-size:12px;margin:9px 0 7px}.saw-inbox-item p{font-size:11px;color:var(--dsw-alias-label-secondary)}
.saw-inbox-item[aria-current],.saw-inbox-item[aria-pressed=true],.saw-inbox-item[data-selected=true]{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.saw-decision-detail{min-width:0;max-width:760px;padding:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.saw-decision-detail h2{font-size:21px;letter-spacing:-.025em;margin:14px 0 10px}.saw-decision-detail>.saw-box:first-of-type{margin-top:0}.saw-decision-detail p{font-size:12px;line-height:1.85}.saw-decision-origin{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11px;margin-bottom:21px;color:var(--dsw-alias-label-secondary)}.saw-inbox-back{display:none}
.saw-choice{display:flex;align-items:flex-start;gap:10px;padding:14px 15px;margin-top:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);cursor:pointer;overflow-wrap:anywhere}.saw-choice input{flex-shrink:0;margin-top:5px}.saw-choice:has(input:checked){border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}.saw-choice strong{display:block;font-size:12px}.saw-choice small{display:block;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px}
/* Settings keeps categories, object lists and the selected editor distinct. */
.saw-settings-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.saw-setting-tile{display:flex;flex-direction:column;align-items:flex-start;min-width:0;min-height:210px;padding:25px;text-align:start;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.saw-setting-tile>svg{margin-bottom:24px}.saw-setting-tile h2{font-size:17px}.saw-setting-tile p{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:8px;max-width:250px}.saw-setting-tile footer{font-size:11px;margin-top:auto;padding-top:20px}
.saw-setting-list{max-width:900px;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.saw-setting-list-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;min-width:0;width:100%;padding:20px 23px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;text-align:start;overflow-wrap:anywhere}.saw-setting-list-row:last-child{border-bottom:0}.saw-setting-list-row>div{flex:1;min-width:0}.saw-setting-list-row h3{font-size:12px}.saw-setting-list-row p{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px}.saw-setting-detail{max-width:720px;min-width:0;padding:25px}.saw-editor-footer{display:flex;align-items:center;gap:13px;flex-wrap:wrap;margin-top:23px;padding-top:18px;border-top:1px solid var(--dsw-alias-border-l1)}
.saw-project-preview:hover,.saw-setting-tile:hover{border-color:var(--dsw-alias-label-secondary)}.saw-work-row:hover,.saw-setting-list-row:hover{background:var(--dsw-alias-bg-layer-2)}
/* Persistent conversation/system mounts retain their existing selectors and hidden contract. */
.saw-workspace{flex:1;min-height:0;min-width:0;display:flex;overflow:hidden}
.saw-workspace[data-mobile-tab=board] .saw-chat{display:none}
.saw-workspace[data-mobile-tab=chat] .saw-board-region{display:none}
.saw-board-region{position:relative;display:flex;flex:1;flex-direction:column;width:100%;min-width:0;min-height:0;overflow:hidden}
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
.saw-registry-list{min-width:0;display:flex;flex-direction:column;gap:18px}.saw-registry-list .saw-column{min-height:0}.saw-registry-list .saw-card-open{display:grid;grid-template-columns:minmax(80px,auto) minmax(0,1fr);gap:6px 14px;align-items:start}.saw-registry-list .saw-card-title{margin:0}.saw-registry-list .saw-card-line{grid-column:2;margin:0}.saw-registry-list .saw-card{border-radius:6px}
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
.saw-chat{position:relative;flex:1;width:100%;max-width:1200px;margin-inline:auto;min-width:0;min-height:0;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;overflow:hidden}
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
.saw-chat-context{display:flex;flex-direction:column;gap:10px;min-width:0;flex-shrink:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);overflow-wrap:anywhere}.saw-chat-context>div,.saw-chat-context>section{min-width:0;max-width:100%}
.saw-compose-attachments{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;min-width:0;max-width:100%}.saw-attachment{display:flex;align-items:center;gap:6px;flex-wrap:wrap;max-width:100%;min-width:0;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);overflow-wrap:anywhere}.saw-attachment img{display:block;max-width:96px;max-height:80px;object-fit:contain}.saw-attachment small{font-size:10px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.saw-attachment .saw-btn{min-height:28px;padding:3px 6px}
.saw-compose-modes{display:flex;gap:3px;align-self:flex-start;padding:0;background:var(--dsw-alias-bg-base)}
.saw-compose-modes .saw-btn{border:0;background:var(--dsw-alias-bg-base);font-size:11px;min-height:26px;padding:3px 8px}.saw-compose-modes .saw-btn[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2)}
.saw-compose-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.saw-compose-footer>.saw-send{width:auto;min-width:76px;margin-inline-start:auto;padding:6px 12px}.saw-compose-footer>.saw-meta{font-size:10px}.saw-compose-footer>.saw-request{width:100%}
.saw-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);padding:3px 5px;overflow-wrap:anywhere}.saw-chip .saw-btn{padding:0 6px;min-height:26px}
.saw-request{padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;display:grid;gap:6px}
.saw-receipt,.saw-history-info{font-size:11px;color:var(--dsw-alias-label-secondary)}.saw-message-technical summary{cursor:pointer}
/* Existing complete review/detail paths remain readable and independently scrollable. */
.saw-detail{position:absolute;inset:0 0 0 auto;width:min(560px,100%);z-index:2;display:flex;flex-direction:column;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.saw-work-detail{position:relative;inset:auto;z-index:auto;display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;width:100%;max-width:none;border:0;border-radius:0;background:transparent;overflow:hidden}
.saw-work-detail>.saw-detail-head{padding:28px 30px 18px;border:0;align-items:flex-start;flex-wrap:wrap}.saw-work-detail>.saw-detail-head h2{font-size:26px;white-space:normal;overflow-wrap:anywhere}.saw-work-detail>.saw-detail-tabs{margin:0 30px;padding:0;gap:23px}.saw-work-detail>.saw-detail-scroll{padding:24px 30px 32px}.saw-work-detail>.saw-detail-actions{padding:12px 30px}
.saw-detail-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-shrink:0}
.saw-detail-head h2{overflow-wrap:anywhere;min-width:0}
.saw-detail:not(.saw-work-detail)>.saw-detail-head h2{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:1.6}.saw-detail-head>.saw-btn{flex-shrink:0}
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
.saw-primary-panel{flex:1;min-width:0;min-height:0}
.saw-system{position:relative;flex:1;min-width:0;min-height:0;width:100%;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.saw-main-body>.saw-system{border:0;border-radius:0;background:transparent}.saw-main-body>.saw-system>.saw-detail-head{padding:28px 30px 18px;border:0;flex-wrap:wrap;align-items:flex-start}.saw-main-body>.saw-system>.saw-detail-head h2{font-size:26px}.saw-main-body>.saw-system>.saw-system-scroll{padding:0 30px 36px}.saw-main-body>.saw-system>.saw-system-scroll>div:not([hidden]){min-width:0}
.saw-workspace[data-mobile-tab=board]{padding:28px 30px 0}.saw-chat{max-width:930px;border:0;border-radius:0;background:transparent}.saw-chat>.saw-section-head{padding:24px 32px 19px}.saw-chat .saw-messages{padding:25px 33px;gap:24px}.saw-chat .saw-composer{margin:10px 32px 20px}
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
.saw-mobile-tabs{display:flex;flex-shrink:0;flex-wrap:wrap;gap:4px;padding:3px;width:fit-content;max-width:100%;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.saw-mobile-tabs .saw-btn{border:0;background:var(--dsw-alias-bg-layer-1);font-size:12px;min-height:30px}.saw-mobile-tabs .saw-btn[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2)}
.saw-primary-nav{display:flex;flex-direction:column;flex-shrink:0;gap:5px;padding:0;width:100%;max-width:100%;border-radius:0;background:transparent}
.saw-primary-nav .saw-btn,.saw-nav-item{display:flex;align-items:center;justify-content:flex-start;gap:11px;width:100%;min-width:0;min-height:40px;padding:11px 13px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:550;text-align:start}
.saw-primary-nav .saw-btn:hover,.saw-nav-item:hover{background:var(--dsw-alias-bg-layer-2)}.saw-primary-nav .saw-btn[aria-pressed=true],.saw-primary-nav .saw-btn[aria-current=page],.saw-nav-item[aria-current=page]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:700}
.saw-nav-icon{display:inline-grid;place-items:center;flex:0 0 19px;width:19px;font-size:17px}.saw-nav-text{min-width:0;overflow-wrap:anywhere}.saw-nav-badge{margin-inline-start:auto;min-width:18px;padding:0 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);font-size:10px}
.saw-collapse{display:none}
/* View descendants and the root grid query the outer frame, never the root itself. */
@container(min-width:1550px){.saw-view-scroll,.saw-projects.saw-view-scroll{padding:40px 55px}.saw-overview-grid{gap:25px}.saw-next-action{min-height:260px}.saw-project-preview-grid{gap:19px}}
@container(max-width:1050px){
.saw-sidebar{padding:25px 10px 15px}.saw-brand{padding-inline-start:10px}.saw-top{padding-inline:23px}.saw-view-scroll,.saw-projects,.saw-projects.saw-view-scroll{padding:27px 24px}.saw-main-body>.saw-banner{margin-inline:24px}.saw-main-body>.saw-boundary{margin-inline:24px}
.saw-project-collection{grid-template-columns:repeat(2,minmax(0,1fr))}.saw-inbox-layout{grid-template-columns:245px minmax(0,1fr)}.saw-work-structure{grid-template-columns:minmax(0,1fr)}.saw-work-row{grid-template-columns:8px minmax(0,1fr) 95px 18px}.saw-work-row:where(:not(:has(>.saw-work-dot))){grid-template-columns:minmax(0,1fr) 95px 18px}.saw-work-row .saw-row-time{display:none}
.saw-overview-grid{grid-template-columns:minmax(0,1.4fr) minmax(200px,.8fr)}.saw-next-action,.saw-brief-card{padding:22px}.saw-settings-grid{gap:12px}.saw-setting-tile{padding:20px}
.saw-chat-intro{max-width:34em}.saw-composer{max-height:58%}.saw-detail:not(.saw-work-detail){width:min(600px,100%)}
}
@container(max-width:820px){
.saw-sidebar{padding:25px 9px 14px}.saw-brand{padding:0 10px 26px}.saw-brand-text,.saw-sidebar .saw-nav-text,.saw-sidebar .saw-nav-badge,.saw-sidebar .saw-nav-heading,.saw-sidebar .saw-pinned-project,.saw-sidebar .saw-sidebar-note{display:none}.saw-primary-nav .saw-btn,.saw-nav-item{justify-content:center;padding:11px 6px}.saw-sidebar-bottom{padding-top:20px}
.saw-overview-grid{grid-template-columns:minmax(0,1fr)}.saw-brief-card{min-height:0;flex-direction:row;align-items:center;gap:16px;padding:18px 20px;flex-wrap:wrap}.saw-brief-card p{max-width:none}.saw-brief-card>.saw-btn{margin:0 0 0 auto}.saw-mini-emblem{margin:0;flex-shrink:0}.saw-project-preview-grid{grid-template-columns:minmax(0,1fr)}
.saw-inbox-layout{grid-template-columns:220px minmax(0,1fr);gap:14px}.saw-decision-detail{padding:21px}.saw-decision-detail h2{font-size:18px}.saw-settings-grid{grid-template-columns:minmax(0,1fr)}.saw-setting-tile{min-height:0;gap:4px}.saw-setting-tile>svg{margin-bottom:10px}.saw-setting-tile h2{font-size:14px}.saw-setting-tile p{max-width:none}.saw-setting-tile footer{padding-top:10px}.saw-page-heading h1{font-size:24px}
.saw-board-head h2{width:100%;font-size:18px}.saw-board-head{padding-bottom:12px}.saw-search{max-width:none;min-width:80px}.saw-board-head select{max-width:115px}.saw-columns,.saw-session-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.saw-fields{grid-template-columns:minmax(70px,auto) minmax(0,1fr)}
}
@container(max-width:620px){
.saw-main{grid-column:1}.saw-sidebar{display:none}.saw[data-menu-open=true] .saw-sidebar{position:absolute;inset:var(--dsh-frame-top-clearance,0px) auto 0 0;display:flex;width:min(228px,calc(100% - 48px));z-index:20;padding:25px 15px 18px;border-inline-end:1px solid var(--dsw-alias-border-l1)}
.saw[data-menu-open=true] .saw-sidebar .saw-brand-text,.saw[data-menu-open=true] .saw-sidebar .saw-nav-text,.saw[data-menu-open=true] .saw-sidebar .saw-nav-badge,.saw[data-menu-open=true] .saw-sidebar .saw-nav-heading,.saw[data-menu-open=true] .saw-sidebar .saw-sidebar-note{display:block}.saw[data-menu-open=true] .saw-sidebar .saw-pinned-project{display:flex}.saw[data-menu-open=true] .saw-primary-nav .saw-btn,.saw[data-menu-open=true] .saw-nav-item{justify-content:flex-start;padding:11px 13px}
.saw[data-menu-open=true] .saw-menu-backdrop{display:block;position:absolute;inset:0;z-index:19;width:100%;height:100%;padding:0;border:0;border-radius:0;background:var(--dsw-alias-label-primary);opacity:.3}.saw-menu-toggle,.saw-mobile-menu{display:inline-flex;flex-shrink:0;justify-content:center;align-items:center;min-width:33px;min-height:33px}
.saw-top{min-height:58px;padding:10px 15px;gap:10px}.saw-breadcrumbs{font-size:10px;gap:6px;flex-basis:90px}.saw-top-actions{gap:5px}.saw-top-actions>.saw-btn{font-size:11px;padding:7px 9px}.saw-connection{font-size:10px}.saw-view-scroll,.saw-projects,.saw-projects.saw-view-scroll{padding:24px 17px}.saw-main-body>.saw-banner{margin-inline:17px}.saw-main-body>.saw-boundary{margin-inline:17px}.saw-page-footer{padding-inline:14px}.saw-page-heading{margin-bottom:21px;gap:12px}.saw-page-heading h1{font-size:23px}
.saw-next-action{padding:21px;min-height:230px}.saw-next-action h2,.saw-next-action .saw-decision h4{font-size:19px}.saw-brief-card{padding:16px;gap:11px}.saw-brief-card h3{font-size:14px}.saw-project-collection{grid-template-columns:minmax(0,1fr)}.saw-project-card{padding:20px}.saw-project-card p{min-height:0}
.saw-project-tabs,.saw-work-tabs{gap:16px}.saw-work-row{grid-template-columns:7px minmax(0,1fr) 18px;gap:12px;padding:17px 15px}.saw-work-row .saw-row-state{grid-column:2;font-size:11px}.saw-work-row .saw-row-time{display:none}.saw-work-summary{padding:20px}.saw-setting-list-row{gap:12px;padding:17px 15px}.saw-setting-detail{padding:20px}
.saw-work-row:where(:not(:has(>.saw-work-dot))){grid-template-columns:minmax(0,1fr) 18px;gap:5px 10px}.saw-work-row:where(:not(:has(>.saw-work-dot)))>span{grid-column:1;grid-row:3}.saw-work-row:where(:not(:has(>.saw-work-dot)))>.saw-meta{grid-column:1;grid-row:4;overflow-wrap:anywhere}.saw-work-row:where(:not(:has(>.saw-work-dot)))::after{grid-column:2;grid-row:1/3}
.saw-main-body>.saw-system>.saw-detail-head{padding:24px 17px 16px}.saw-main-body>.saw-system>.saw-detail-head h2{font-size:23px}.saw-main-body>.saw-system>.saw-system-scroll{padding:0 17px 24px}.saw-workspace[data-mobile-tab=board]{padding:24px 17px 0}.saw-chat>.saw-section-head{padding:18px 17px}.saw-chat .saw-messages{padding:18px 17px}.saw-chat .saw-composer{margin:8px 12px 14px}
.saw-inbox-layout{grid-template-columns:minmax(0,1fr)}.saw-inbox-layout[data-selected=true]>.saw-inbox-list,.saw-inbox-list[data-selected=true]{display:none}.saw-inbox-back{display:inline-flex;margin-bottom:16px}.saw-decision-detail{max-width:none;padding:20px}.saw-inbox-item{padding:16px}
.saw-work-detail>.saw-detail-head{padding:24px 17px 16px}.saw-work-detail>.saw-detail-head h2{font-size:23px}.saw-work-detail>.saw-detail-tabs{margin-inline:17px}.saw-work-detail>.saw-detail-scroll{padding:20px 17px 24px}.saw-work-detail>.saw-detail-actions{padding-inline:17px}.saw-detail:not(.saw-work-detail){width:100%}
.saw-head-actions{flex-wrap:wrap;flex-shrink:1;justify-content:flex-end}.saw-section-head{align-items:flex-start;flex-wrap:wrap}.saw-work-scroll{gap:20px}
}
@container(max-width:440px){.saw-columns,.saw-session-grid{grid-template-columns:minmax(0,1fr)}.saw-review-entry{font-size:11px;padding:4px 6px}.saw-board-head>.saw-btn{font-size:11px;padding:6px 8px}.saw-fields{grid-template-columns:minmax(0,1fr)}.saw-fields .saw-fields{grid-template-columns:minmax(0,1fr)}.saw-fields dd{margin-bottom:6px}}
/* Named outer container sizes the root grid, even inside a narrow desktop host panel. */
@media(max-width:1050px){.saw{grid-template-columns:180px minmax(0,1fr)}}
@media(max-width:820px){.saw{grid-template-columns:70px minmax(0,1fr)}}
@media(max-width:620px){.saw{grid-template-columns:minmax(0,1fr)}}
@container saw-frame (min-width:1051px){.saw{grid-template-columns:214px minmax(0,1fr)}}
@container saw-frame (max-width:1050px){.saw{grid-template-columns:180px minmax(0,1fr)}}
@container saw-frame (max-width:820px){.saw{grid-template-columns:70px minmax(0,1fr)}}
@container saw-frame (max-width:620px){.saw{grid-template-columns:minmax(0,1fr)}}
@media(max-height:650px){.saw-section-head{padding:8px 10px}.saw-composer{padding:8px;gap:6px}.saw-composer textarea{height:60px;min-height:48px}.saw-inspector{top:42px}}
@media(prefers-reduced-motion:reduce){.saw *{scroll-behavior:auto;transition:none}}
`
}
