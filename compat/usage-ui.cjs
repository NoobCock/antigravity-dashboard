// Shared local usage views. Values and model labels are inserted as text.
module.exports = function createUsageDashboard({root,language,setMarkup,hostLabel='Antigravity',guideDismissed=false,onDismissGuide,onLanguage,onRefresh,onPricing=null}) {
  const dialog=document.createElement('dialog');dialog.id='usage-dashboard';
  dialog.style.cssText='width:min(1040px,calc(100vw - 40px));max-width:none;height:min(820px,calc(100dvh - 64px));max-height:none;box-sizing:border-box;overflow:hidden;visibility:visible;pointer-events:auto;padding:0;border:1px solid var(--pulse-border);border-radius:18px;background:var(--pulse-background);color:var(--pulse-foreground);box-shadow:0 24px 100px #0006';
  const shell=document.createElement('div'),view=shell.attachShadow({mode:'open'});shell.style.height='100%';dialog.append(shell);root.append(dialog);
  const backdrop=document.createElement('style');backdrop.textContent='#usage-dashboard::backdrop{background:#0006;backdrop-filter:blur(3px)}';root.append(backdrop);
  const css=document.createElement('style');css.textContent=`
    :host{display:block;color:var(--pulse-foreground);font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;font-variant-numeric:tabular-nums}
    *{box-sizing:border-box}button,select{font:inherit;color:inherit}button{cursor:pointer}button,select{border:1px solid var(--pulse-border);background:transparent;border-radius:7px}button{transition:background 140ms ease,transform 120ms cubic-bezier(.23,1,.32,1)}button:active{transform:scale(.97)}button:focus-visible,select:focus-visible{outline:2px solid var(--pulse-accent);outline-offset:3px}button[disabled]{opacity:.35;cursor:default}
    .page{padding:28px 32px 24px;max-height:90dvh;overflow:auto;background:var(--pulse-background)}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.eyebrow{font-size:10px;color:var(--pulse-muted);letter-spacing:1.7px;margin-bottom:7px}h1{font-size:24px;letter-spacing:-.7px;line-height:1.2;margin:0;font-weight:600}.sub{display:none}.actions{display:flex;gap:8px;align-items:center}.actions button{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;line-height:1;border-radius:8px;color:var(--pulse-muted)}.actions button:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}.actions svg{display:block;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.locale-label{display:block;min-width:16px;height:16px;line-height:16px;text-align:center;font-size:11px}
    .tabs{display:flex;gap:22px;border-bottom:1px solid var(--pulse-separator);margin:20px 0 22px}.tabs button{border:0;border-radius:0;background:transparent;color:var(--pulse-muted);padding:0 2px 11px;position:relative}.tabs button[aria-selected=true]{color:var(--pulse-foreground);font-weight:600}.tabs button[aria-selected=true]:after{content:'';position:absolute;height:2px;background:var(--pulse-accent);bottom:-1px;left:0;right:0}
    .totals{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border:1px solid var(--pulse-border);border-radius:12px;padding:16px 0;margin-bottom:28px}.metric{padding:0 16px;min-width:0}.metric+.metric{border-left:1px solid var(--pulse-separator)}.metric label{display:block;color:var(--pulse-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.value{font-size:24px;letter-spacing:-.8px;margin:5px 0 0;font-weight:550;white-space:nowrap}.metric-sub{display:flex;align-items:center;font-size:11px;color:var(--pulse-muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}.metric-cost{color:var(--pulse-foreground);opacity:.82}.unit{font-size:11px;color:var(--pulse-muted);margin-left:4px;font-weight:400;letter-spacing:0}
    section[hidden]{display:none}.section-head{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:0 0 18px}h2{font-size:14px;font-weight:600;letter-spacing:-.2px;margin:0}.muted{font-size:11px;color:var(--pulse-muted)}.seg{display:flex;padding:3px;background:var(--pulse-hover);border-radius:8px;gap:2px}.seg button{border:0;padding:4px 12px;border-radius:5px;font-size:11px;color:var(--pulse-muted)}.seg button[aria-pressed=true]{background:var(--pulse-control);color:var(--pulse-foreground);box-shadow:0 1px 3px #0001}select{padding:4px 8px;font-size:11px;background:var(--pulse-background)}
    .heat-wrap{overflow-x:auto;padding:3px 3px 7px}.calendar{min-width:680px}.months{display:grid;margin-left:31px;font-size:10px;color:var(--pulse-muted);margin-bottom:7px}.heat-row{display:flex;gap:9px}.weekdays{display:grid;grid-template-rows:repeat(7,1fr);width:22px;flex:none;font-size:9px;color:var(--pulse-muted)}.heat{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,1fr);gap:3px;width:100%}.heat button{border:0;border-radius:3px;padding:0;min-width:0;aspect-ratio:1;background:var(--pulse-hover);outline-offset:1px}.heat button[data-level="1"],.swatch[data-level="1"]{background:color-mix(in srgb,var(--pulse-accent) 22%,var(--pulse-hover))}.heat button[data-level="2"],.swatch[data-level="2"]{background:color-mix(in srgb,var(--pulse-accent) 45%,var(--pulse-hover))}.heat button[data-level="3"],.swatch[data-level="3"]{background:color-mix(in srgb,var(--pulse-accent) 68%,var(--pulse-hover))}.heat button[data-level="4"],.swatch[data-level="4"]{background:var(--pulse-accent)}.heat button.future{opacity:.25;cursor:default}.heat.week{grid-template-columns:repeat(26,minmax(0,1fr))!important;grid-template-rows:repeat(2,1fr);grid-auto-flow:row}.week button{max-height:28px;aspect-ratio:1}.heat-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:10px 0 27px;font-size:10px;color:var(--pulse-muted)}.scale{display:flex;align-items:center;gap:4px}.swatch{width:11px;height:11px;border-radius:3px;background:var(--pulse-hover)}.selected{padding:16px 18px;border:1px solid var(--pulse-border);border-radius:10px;display:flex;justify-content:space-between;gap:16px;align-items:center}.selected button{border:0;color:var(--pulse-accent);font-size:12px;padding:5px}.selected .title{font-weight:500;margin-bottom:3px}.selected strong{font-weight:550}
    .chart-controls{display:flex;gap:10px;align-items:center}.range{display:flex;align-items:center;gap:10px}.range button{height:26px;width:26px;border:0}.range strong{font-size:12px;font-weight:500;min-width:106px;text-align:center}.legend{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 18px}.legend button{display:flex;align-items:center;gap:7px;padding:5px 9px;border-radius:6px;font-size:11px;border-color:transparent;background:var(--pulse-hover)}.legend button[aria-pressed=false]{opacity:.35}.dot{width:8px;height:8px;border-radius:2px;display:inline-block;flex:none;background:var(--model-color)}
    .chart-wrap{overflow-x:auto;border-bottom:1px solid var(--pulse-separator);padding-bottom:17px;margin-bottom:18px}.chart{height:246px;display:flex;gap:10px;min-width:650px}.axis{width:42px;flex:none;position:relative;font-size:9px;color:var(--pulse-muted)}.axis span{position:absolute;right:0;transform:translateY(50%)}.plot{position:relative;flex:1;display:flex;align-items:stretch;gap:6px;padding:0 1px}.grid-line{position:absolute;left:0;right:0;border-top:1px solid var(--pulse-separator);pointer-events:none}.bar-column{position:relative;flex:1;min-width:0;display:flex;align-items:flex-end;border:0;border-radius:4px;background:transparent;padding:0;margin-bottom:19px}.bar-column:hover{background:var(--pulse-hover)}.stack{display:flex;flex-direction:column-reverse;width:100%;gap:1px;pointer-events:none;border-radius:3px 3px 0 0;overflow:hidden}.bar-segment{width:100%;background:var(--model-color);min-height:1px}.x-label{position:absolute;top:calc(100% + 5px);left:50%;transform:translateX(-50%);font-size:9px;color:var(--pulse-muted);white-space:nowrap}.empty-bar{height:2px;width:100%;background:var(--pulse-track);border-radius:2px}.chart-empty{position:absolute;left:0;right:0;top:40%;text-align:center;color:var(--pulse-muted);font-size:12px;pointer-events:none}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;text-align:right;font-size:11px;white-space:nowrap}.table th{font-weight:400;color:var(--pulse-muted);padding:8px 12px;border-bottom:1px solid var(--pulse-separator)}.table td{padding:12px;border-bottom:1px solid var(--pulse-separator)}.table th:first-child,.table td:first-child{text-align:left;padding-left:0}.table td:first-child span{margin-right:7px}.table tr:last-child td{border-bottom:0}.footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:20px;font-size:10px;color:var(--pulse-muted)}.alert{color:var(--pulse-warning);margin-top:12px;font-size:11px}.tip{position:fixed;z-index:20;max-width:280px;padding:12px 14px;border:1px solid var(--pulse-border);border-radius:9px;background:var(--pulse-menu);box-shadow:0 8px 30px var(--pulse-shadow);color:var(--pulse-foreground);font-size:11px;pointer-events:none}.tip[hidden]{display:none}.tip .tip-title{font-size:10px;color:var(--pulse-muted);margin-bottom:5px}.tip strong{font-size:16px;font-weight:550}.tip-model{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:5px}.tip-model .dot{margin-right:6px}
    @media(max-width:780px){.metric{padding:0 12px}.value{font-size:21px}}@media(max-width:650px){.page{padding:20px 18px}.totals{grid-template-columns:repeat(2,minmax(0,1fr));gap:15px 0}.metric{padding:0 16px}.metric:nth-child(odd){border-left:0}.value{font-size:23px}.section-head{align-items:flex-start;flex-wrap:wrap}.chart-controls{width:100%;justify-content:space-between}.footer{align-items:flex-start;flex-direction:column;gap:5px}.selected{align-items:flex-start}.chart{gap:8px}}@media(prefers-reduced-motion:reduce){button{transition:none}button:active{transform:none}}
  `;view.append(css);
  css.textContent+=' .months span{white-space:nowrap}.chart-wrap{padding-top:9px}';
  css.textContent+=`
    :host{height:100%}.page{height:100%;max-height:none;display:flex;flex-direction:column;scrollbar-gutter:stable}.page>*{flex:none}.footer{margin-top:auto;padding-top:20px}
    .year-picker{position:relative;flex:none}.year-trigger{display:flex;align-items:center;justify-content:space-between;gap:14px;min-width:76px;height:30px;padding:0 10px;background:var(--pulse-control);color:var(--pulse-foreground);font-size:11px;border-radius:8px}.year-trigger:hover,.year-trigger[aria-expanded=true]{background:var(--pulse-hover)}.year-chevron{width:12px;height:12px;fill:none;stroke:var(--pulse-muted);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;transition:transform 160ms cubic-bezier(.23,1,.32,1)}.year-trigger[aria-expanded=true] .year-chevron{transform:rotate(180deg)}
    .year-menu{position:fixed;inset:auto;margin:0;padding:5px;width:112px;max-height:232px;overflow-y:auto;border:1px solid var(--pulse-border);border-radius:10px;background:var(--pulse-menu);color:var(--pulse-foreground);box-shadow:0 8px 26px var(--pulse-shadow);transform-origin:top right;opacity:1;transform:scale(1);transition:opacity 140ms ease,transform 160ms cubic-bezier(.23,1,.32,1)}.year-menu::backdrop{background:transparent;pointer-events:none}.year-option{width:100%;border:0;border-radius:6px;padding:7px 9px;display:flex;align-items:center;justify-content:space-between;gap:18px;font-size:12px;text-align:left;background:transparent;color:var(--pulse-foreground);font-variant-numeric:tabular-nums}.year-option:hover,.year-option:focus-visible{background:var(--pulse-hover)}.year-option[aria-selected=true]{background:color-mix(in srgb,var(--pulse-accent) 12%,var(--pulse-menu))}.year-check{color:var(--pulse-accent);width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;opacity:0}.year-option[aria-selected=true] .year-check{opacity:1}
    @starting-style{.year-menu:popover-open{opacity:0;transform:scale(.97)}}@media(prefers-reduced-motion:reduce){.year-menu,.year-chevron{transition:none}}
  `;
  css.textContent+=`
    .bar-column:hover{background:transparent}.bar-column:active{transform:none}.stack{width:var(--bar-width,62%);max-width:var(--bar-max-width,30px);margin-inline:auto;gap:0;border-radius:var(--bar-radius,4px) var(--bar-radius,4px) 0 0;overflow:hidden}.bar-segment{display:block;flex:none;min-height:0;border-radius:0;pointer-events:auto;background:var(--model-color);transition:opacity 140ms ease}.plot[data-highlight] .bar-segment:not([data-highlight=true]){opacity:.24}.empty-bar{height:1px;opacity:.35}.grid-line{border-top-style:solid;opacity:.45}.grid-line:first-child{opacity:.85}.legend{gap:4px 18px;margin-bottom:22px}.legend button{background:transparent;padding:3px 0;border:0;border-radius:3px;color:var(--pulse-muted);gap:7px}.legend button:hover,.legend button[aria-pressed=true]{color:var(--pulse-foreground)}.legend button[aria-pressed=false]{opacity:.4;text-decoration:line-through}.legend .dot{width:7px;height:7px;border-radius:50%}.chart{gap:16px;min-width:var(--chart-min-width,650px)}.plot{gap:var(--plot-gap,5px)}.axis,.x-label{font-size:10px}.chart-summary{font-size:11px;color:var(--pulse-muted);margin-top:5px}.chart-summary strong{color:var(--pulse-foreground);font-weight:500}.chart-wrap{padding-top:6px}.table .dot{border-radius:50%}
    .tip-model{padding:3px 0}.tip-model.dimmed{opacity:.5}.tip-model.active{font-weight:600}.tip-cost{font-size:10px;color:var(--pulse-foreground);opacity:.78;margin-left:7px}.model-share{font-size:10px;color:var(--pulse-muted);margin-left:7px}.usage-waiting{display:grid;place-items:center;min-height:260px;color:var(--pulse-muted);font-size:12px}.usage-waiting[hidden]{display:none}
    .merge-toggle{height:28px;padding:0 10px;border:1px solid var(--pulse-border);border-radius:7px;background:transparent;color:var(--pulse-muted);font-size:11px;white-space:nowrap}.merge-toggle:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}.merge-toggle[aria-pressed=true]{background:var(--pulse-hover);color:var(--pulse-foreground);border-color:color-mix(in srgb,var(--pulse-accent) 45%,var(--pulse-border))}.merge-toggle[hidden]{display:none}.variant-tag{display:inline-block;margin-left:6px;padding:1px 5px;border-radius:4px;font-size:9px;background:var(--pulse-hover);color:var(--pulse-muted);vertical-align:middle}
    .model-parent{cursor:pointer}.model-parent:hover td{background:var(--pulse-hover)}.fold-caret{display:inline-block;width:12px;margin-right:4px;color:var(--pulse-muted);font-size:9px;text-align:center;transition:transform 140ms ease}.model-parent[data-expanded=true] .fold-caret{transform:rotate(90deg);color:var(--pulse-foreground)}.fold-spacer{display:inline-block;width:12px;margin-right:4px}
    .model-tier-row td{background:color-mix(in srgb,var(--pulse-hover) 42%,transparent);color:var(--pulse-muted);font-size:10.5px;padding-top:8px;padding-bottom:8px}.model-tier-row td:first-child{padding-left:26px}.tier-pill{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;background:var(--pulse-hover);color:var(--pulse-foreground)}
    .custom-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin:0 0 16px;padding:10px 12px;border:1px solid var(--pulse-border);border-radius:10px;background:var(--pulse-control)}.custom-bar[hidden]{display:none}
    .custom-dates{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.custom-date{height:28px;padding:0 8px;border:1px solid var(--pulse-border);border-radius:6px;background:var(--pulse-background);color:var(--pulse-foreground);color-scheme:var(--pulse-scheme);font:inherit;font-size:11px}.custom-date:focus-visible{outline:2px solid var(--pulse-accent);outline-offset:2px}.date-sep{color:var(--pulse-muted);font-size:11px}
    .custom-presets{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.custom-presets button{border:1px solid transparent;padding:4px 9px;border-radius:6px;font-size:11px;color:var(--pulse-muted);background:transparent}.custom-presets button:hover{color:var(--pulse-foreground);background:var(--pulse-hover)}.custom-presets button[aria-pressed=true]{background:var(--pulse-hover);color:var(--pulse-foreground);border-color:var(--pulse-border)}
    .table tfoot td{border-top:1px solid var(--pulse-border);border-bottom:0;font-weight:600;color:var(--pulse-foreground);padding-top:11px}
    .est-windows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:18px}.est-card{padding:16px 18px;border:1px solid var(--pulse-border);border-radius:12px;background:var(--pulse-control);display:flex;flex-direction:column;gap:10px}
    .est-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.est-card-title{font-size:13px;font-weight:600}.est-card-meta{display:flex;align-items:center;gap:6px}.est-badge{font-size:10px;padding:2px 8px;border-radius:99px;background:var(--pulse-hover);color:var(--pulse-muted);white-space:nowrap}.est-badge.high{color:var(--pulse-success)}.est-badge.low{color:var(--pulse-warning)}
    .est-primary{font-size:25px;font-weight:600;letter-spacing:-.7px;line-height:1.15;font-variant-numeric:tabular-nums}.est-primary .unit{font-size:11px;font-weight:400;color:var(--pulse-muted);margin-left:5px;letter-spacing:0}.est-sub{font-size:11px;color:var(--pulse-muted);line-height:1.45;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center}
    .meta-row{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 0}.meta-item{display:inline-flex;align-items:center;min-width:0}.meta-item+.meta-item{margin-left:8px;padding-left:8px;border-left:1px solid var(--pulse-separator)}.row-sep{display:inline-block;width:1px;height:9px;background:var(--pulse-separator);margin:0 7px;vertical-align:middle}.mix-chip{display:inline-block;padding:1px 6px;border-radius:99px;background:var(--pulse-hover);font-size:10px;color:var(--pulse-muted);white-space:nowrap}
    .est-rows{display:grid;gap:6px;padding-top:10px;border-top:1px solid var(--pulse-separator);font-size:11px}.est-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}.est-row span:first-child{color:var(--pulse-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.est-row span:last-child{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
    .est-sim{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:11px 14px;margin-bottom:16px;border:1px solid var(--pulse-border);border-radius:10px;background:var(--pulse-background);user-select:none;-webkit-user-select:none}.est-sim-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.est-slider-wrap{display:flex;align-items:center;gap:8px;font-size:11px;flex:none;user-select:none;-webkit-user-select:none}.est-slider{width:118px;margin:0;accent-color:var(--pulse-accent);cursor:pointer;touch-action:none}#est-cache-value{display:inline-block;min-width:34px;text-align:right;font-variant-numeric:tabular-nums}.page.dragging-slider{user-select:none;-webkit-user-select:none}
    .est-basis{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;min-height:46px;padding:8px 14px;margin-bottom:14px;border:1px solid var(--pulse-border);border-radius:10px;background:var(--pulse-background);user-select:none;-webkit-user-select:none}.est-basis-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}.est-model-select{height:28px;min-width:158px;max-width:230px;padding:0 8px;border:1px solid var(--pulse-border);border-radius:7px;background:var(--pulse-control);color:var(--pulse-foreground);color-scheme:var(--pulse-scheme);font-size:11px}.est-model-select[hidden]{display:none}.est-mix-hint{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;max-width:280px}.est-mix-hint[hidden]{display:none}
    .est-pricing-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin:0 0 12px;font-size:11px;color:var(--pulse-muted)}.est-pricing-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.est-pricing-actions button{padding:4px 10px;border:1px solid var(--pulse-border);border-radius:7px;background:var(--pulse-control);color:var(--pulse-foreground);font-size:11px}.est-pricing-actions button:hover:not([disabled]){background:var(--pulse-hover)}.est-pricing-msg{font-size:11px}.est-pricing-msg.err{color:var(--pulse-warning)}
    .est-price-editor{margin:0 0 14px;padding:12px 14px;border:1px solid var(--pulse-accent);border-radius:10px;background:var(--pulse-control);display:grid;gap:10px}.est-price-editor[hidden]{display:none}.est-editor-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;font-weight:600}.est-editor-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.est-editor-field{display:grid;gap:4px;font-size:10px;color:var(--pulse-muted)}.est-editor-field input{height:28px;padding:0 8px;border:1px solid var(--pulse-border);border-radius:6px;background:var(--pulse-background);color:var(--pulse-foreground);font:inherit;font-size:11px;font-variant-numeric:tabular-nums}.est-editor-field input:focus-visible{outline:2px solid var(--pulse-accent);outline-offset:2px}.est-editor-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}.est-editor-actions button{padding:5px 12px;border-radius:7px;font-size:11px;background:var(--pulse-background)}.est-editor-actions button.primary{background:var(--pulse-accent);border-color:var(--pulse-accent);color:#fff}
    .est-price-cell{display:inline-flex;align-items:center;justify-content:flex-end;gap:6px}.est-src-tag{display:inline-block;padding:1px 5px;border-radius:4px;font-size:9px;background:var(--pulse-hover);color:var(--pulse-muted)}.est-src-tag.live{color:var(--pulse-success)}.est-src-tag.custom{color:var(--pulse-warning)}.est-edit-btn{border:1px solid var(--pulse-border);border-radius:5px;padding:1px 6px;font-size:10px;color:var(--pulse-muted);background:transparent}.est-edit-btn:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}
    .est-model-row{cursor:pointer}.est-model-row:hover td{background:var(--pulse-hover)}.est-model-row[data-selected=true] td{background:color-mix(in srgb,var(--pulse-accent) 10%,transparent)}
    .est-active-tag{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:99px;font-size:9px;font-weight:500;background:color-mix(in srgb,var(--pulse-accent) 18%,transparent);color:var(--pulse-accent);vertical-align:middle}
    .est-note{display:none}.est-empty{padding:34px 20px;text-align:center;border:1px dashed var(--pulse-border);border-radius:12px;color:var(--pulse-muted);font-size:12px}.est-empty[hidden]{display:none}
    @media(max-width:650px){.est-windows{grid-template-columns:1fr}.est-editor-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  const page=document.createElement('div');page.className='page';
  setMarkup(page,`<header class="top"><div><div class="eyebrow">ANTIGRATIVE DASHBOARD</div><h1 id="title"></h1><div class="sub" hidden><span id="subtitle"></span></div></div><div class="actions"><button id="locale" type="button" aria-label="Language"><span id="locale-label" class="locale-label">中</span></button><button id="refresh" type="button" aria-label="Refresh"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 7a5 5 0 1 0-1.3 4.4M13 3v4H9"/></svg></button><button id="close" type="button" aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button></div></header><nav class="tabs" role="tablist"><button id="overview-tab" role="tab" aria-controls="overview"></button><button id="details-tab" role="tab" aria-controls="details"></button><button id="estimate-tab" role="tab" aria-controls="estimate"></button></nav><div class="totals" id="totals"></div><section id="usage-waiting" class="usage-waiting" role="status" hidden></section><section id="overview" role="tabpanel"><div class="section-head"><div><h2 id="activity-title"></h2><div class="muted" id="heat-sub"></div></div><div class="chart-controls"><div class="seg" id="heat-controls"><button data-heat="day"></button><button data-heat="week"></button></div><div class="year-picker"><button id="year" type="button" class="year-trigger" aria-label="Year" aria-haspopup="listbox" aria-controls="year-menu" aria-expanded="false"><span id="year-label"></span><svg class="year-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><div id="year-menu" class="year-menu" role="listbox" aria-label="Year" popover="manual"></div></div></div></div><div class="heat-wrap"><div class="calendar"><div class="months" id="months"></div><div class="heat-row"><div class="weekdays" id="weekdays"></div><div class="heat" id="heat"></div></div></div></div><div class="heat-footer"><span id="heat-summary"></span><div class="scale"><span id="less"></span><i class="swatch"></i><i class="swatch" data-level="1"></i><i class="swatch" data-level="2"></i><i class="swatch" data-level="3"></i><i class="swatch" data-level="4"></i><span id="more"></span></div></div><div class="selected"><div><div class="title" id="selection-title"></div><span class="muted" id="selection-value"></span></div><button id="selection-details"></button></div></section><section id="details" role="tabpanel" hidden><div class="section-head"><h2 id="detail-title"></h2><div class="chart-controls"><div class="range"><button id="previous" aria-label="Previous">‹</button><strong id="range-label"></strong><button id="next" aria-label="Next">›</button></div><div class="seg" id="period-controls"><button data-period="day"></button><button data-period="week"></button><button data-period="month"></button><button data-period="custom"></button></div></div></div><div class="custom-bar" id="custom-bar" hidden><div class="custom-dates" id="custom-dates"></div><div class="custom-presets" id="custom-presets"><button type="button" data-preset="7"></button><button type="button" data-preset="14"></button><button type="button" data-preset="30"></button><button type="button" data-preset="90"></button><button type="button" data-preset="all"></button></div></div><div class="legend" id="legend"></div><div class="chart-wrap"><div class="chart"><div class="axis" id="axis"></div><div class="plot" id="plot"></div></div></div><div class="table-wrap"><table class="table" id="details-table"><thead><tr id="table-head"></tr></thead><tbody id="table-body"></tbody></table></div></section><section id="estimate" role="tabpanel" hidden><div class="section-head"><div><h2 id="est-title"></h2><div class="muted" id="est-sub"></div></div><div class="seg" id="est-groups"></div></div><div class="est-empty" id="est-empty" hidden></div><div id="est-content"><div class="est-basis" id="est-basis"><div class="est-basis-group"><span class="muted" id="est-basis-label"></span><div class="est-basis-group" id="est-basis-controls"></div></div><div class="est-basis-group"><span class="muted" id="est-cal-label"></span><div class="est-basis-group" id="est-cal-controls"></div></div></div><div class="est-windows" id="est-windows"></div><div class="est-sim" id="est-sim"><span class="muted" id="est-sim-label"></span><div class="est-sim-controls" id="est-sim-controls"></div></div><div class="est-pricing-bar" id="est-pricing-bar"><span id="est-pricing-status"></span><div class="est-pricing-actions" id="est-pricing-actions"></div></div><div class="est-price-editor" id="est-price-editor" hidden></div><div class="table-wrap"><table class="table"><thead><tr id="est-table-head"></tr></thead><tbody id="est-table-body"></tbody></table></div><p class="est-note" id="est-note"></p></div></section><div class="alert" id="alert" hidden></div><footer class="footer"><span id="coverage"></span><span id="timezone"></span></footer><div class="tip" id="tip" role="status" hidden></div>`);view.append(page);
  const intro=document.createElement('section');intro.id='usage-intro';intro.className='usage-intro';intro.hidden=true;intro.setAttribute('aria-labelledby','usage-intro-title');
  setMarkup(intro,'<div class="intro-heading"><span class="intro-mark" aria-hidden="true"><svg viewBox="0 0 16 16"><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 2 10 2 10 0V4M3 8c0 2 10 2 10 0"/></svg></span><h2 id="usage-intro-title"></h2></div><div class="intro-copy"><p id="usage-intro-history"></p><p id="usage-intro-scope"></p><p id="usage-intro-storage"></p></div><div class="intro-bottom"><span id="usage-intro-error" role="status"></span><button id="usage-intro-done" type="button"></button></div>');
  page.querySelector('.top').after(intro);
  css.textContent+=`
    .usage-intro{margin:18px 0 0;padding:17px 20px 14px;border:1px solid var(--pulse-border);border-radius:12px;background:var(--pulse-control)}.usage-intro[hidden]{display:none}
    .intro-heading{display:flex;align-items:center;gap:9px;margin-bottom:9px}.intro-heading h2{font-size:13px;font-weight:550;margin:0}.intro-mark{display:flex;color:var(--pulse-accent)}.intro-mark svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
    .intro-copy{display:grid;gap:5px;color:var(--pulse-muted);font-size:11px;line-height:1.65}.intro-copy p{margin:0}.intro-bottom{display:flex;justify-content:flex-end;align-items:center;gap:14px;margin-top:11px}.intro-bottom span{margin-right:auto;color:var(--pulse-warning);font-size:11px}
    #usage-intro-done{padding:6px 13px;min-height:30px;border:1px solid var(--pulse-border);border-radius:7px;background:var(--pulse-hover);color:var(--pulse-foreground);font:inherit;font-size:11px;cursor:pointer;transition:background-color 140ms ease,transform 120ms ease}#usage-intro-done:hover{background:var(--pulse-selected)}#usage-intro-done:active{transform:scale(.98)}#usage-intro-done:disabled{opacity:.55;cursor:wait}
    @media(max-width:520px){.usage-intro{padding:14px}.intro-bottom{align-items:flex-start}.intro-bottom span{line-height:1.5}}
  `;
  const $=id=>view.getElementById(id),text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
  let value=null,tab='overview',heatMode='day',period='day',year=null,anchor=null,selected=null,disabledModels=new Set(),expandedModels=new Set(),lastKey='',busy=false,opener=null;
  let customFrom=null,customTo=null,estGroupId=null,estBasis='mix',estCalMode='window',estSelectedModel=null,simMode='actual',simCachePct=90,estDragging=false,pendingDeferredRender=false;
  let estEditingModel=null,estPricingBusy=false,estPricingMsg='',estPricingErr=false;
  let disposed=false,refreshMotion=null,refreshDelay=null,finishRefresh=null,accountKey=null,tipTarget=null,tipModel=null;
  const zh=()=>language.language==='zh-CN',w=(cn,en)=>zh()?cn:en;
  const fmtUsd=n=>typeof n!=='number'||!Number.isFinite(n)?'—':n===0?'$0':n>=1000?'$'+Math.round(n).toLocaleString('en-US'):n>=100?'$'+n.toFixed(1):n>=1?'$'+n.toFixed(2):'$'+n.toFixed(3);
  const fmtCost=n=>typeof n==='number'&&Number.isFinite(n)?(n===0?'$0':'~'+fmtUsd(n)):null;
  const fmtStamp=iso=>{const ms=Date.parse(iso);return Number.isFinite(ms)?language.resetDate(ms):'—';};
  const groupShortName=g=>/gemini/i.test(g?.id||g?.name||'')?'Gemini':/3p|claude|gpt/i.test(g?.id||g?.name||'')?'Claude / GPT':g?.name||'Quota';
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
  const customFromInput=document.createElement('input');customFromInput.type='date';customFromInput.id='custom-from';customFromInput.className='custom-date';
  const customToInput=document.createElement('input');customToInput.type='date';customToInput.id='custom-to';customToInput.className='custom-date';
  const customSpanEl=document.createElement('span');customSpanEl.id='custom-span';customSpanEl.className='muted';
  const dateSepEl=document.createElement('span');dateSepEl.className='date-sep';dateSepEl.textContent='–';
  $('custom-dates').append(customFromInput,dateSepEl,customToInput,customSpanEl);
  const tableFoot=document.createElement('tfoot');tableFoot.id='table-foot';$('details-table').append(tableFoot);
  const expandAllBtn=document.createElement('button');expandAllBtn.type='button';expandAllBtn.id='toggle-expand-all';expandAllBtn.className='merge-toggle';expandAllBtn.hidden=true;
  let lastExpandableModels=[];
  expandAllBtn.addEventListener('click',()=>{
    const allOpen=lastExpandableModels.length>0&&lastExpandableModels.every(m=>expandedModels.has(m));
    if(allOpen)expandedModels.clear();else for(const m of lastExpandableModels)expandedModels.add(m);
    renderChart();
  });
  $('period-controls').after(expandAllBtn);
  const estBasisSeg=document.createElement('div');estBasisSeg.className='seg';
  const estBasisButtons=['mix','single'].map(id=>{
    const b=document.createElement('button');b.type='button';b.dataset.estBasis=id;
    b.addEventListener('click',()=>{estBasis=id;renderEstimate();});
    estBasisSeg.append(b);return {id,button:b};
  });
  const estModelSelect=document.createElement('select');estModelSelect.id='est-model-select';estModelSelect.className='est-model-select';estModelSelect.hidden=true;
  estModelSelect.addEventListener('change',()=>{estSelectedModel=estModelSelect.value;estBasis='single';renderEstimate();});
  const estMixHint=document.createElement('span');estMixHint.id='est-mix-hint';estMixHint.className='est-mix-hint';
  $('est-basis-controls').append(estBasisSeg,estModelSelect,estMixHint);
  const estCalSeg=document.createElement('div');estCalSeg.className='seg';
  const estCalButtons=['window','delta'].map(id=>{
    const b=document.createElement('button');b.type='button';b.dataset.estCal=id;
    b.addEventListener('click',()=>{estCalMode=id;renderEstimate();});
    estCalSeg.append(b);return {id,button:b};
  });
  $('est-cal-controls').append(estCalSeg);
  // Permanent live-pricing & custom-override editor controls (Trusted Types safe)
  const estFetchPricingBtn=document.createElement('button');estFetchPricingBtn.type='button';estFetchPricingBtn.id='est-fetch-pricing';
  const estResetAllBtn=document.createElement('button');estResetAllBtn.type='button';estResetAllBtn.id='est-reset-all-pricing';estResetAllBtn.hidden=true;
  $('est-pricing-actions').append(estFetchPricingBtn,estResetAllBtn);
  const editorTitle=document.createElement('span');editorTitle.id='est-editor-title';
  const editorDefaultHint=document.createElement('span');editorDefaultHint.className='muted';editorDefaultHint.id='est-editor-default';
  const editorHead=document.createElement('div');editorHead.className='est-editor-head';editorHead.append(editorTitle,editorDefaultHint);
  const editorGrid=document.createElement('div');editorGrid.className='est-editor-grid';
  const makePriceField=key=>{
    const wrap=document.createElement('label');wrap.className='est-editor-field';
    const lbl=document.createElement('span');const inp=document.createElement('input');
    inp.type='number';inp.min='0';inp.max='10000';inp.step='any';inp.id='est-price-'+key;
    wrap.append(lbl,inp);editorGrid.append(wrap);return {wrap,lbl,inp};
  };
  const editorFields={input:makePriceField('input'),cacheRead:makePriceField('cacheRead'),output:makePriceField('output'),cacheWrite:makePriceField('cacheWrite')};
  const editorActions=document.createElement('div');editorActions.className='est-editor-actions';
  const editorStatus=document.createElement('span');editorStatus.className='est-pricing-msg';editorStatus.style.marginRight='auto';
  const editorResetBtn=document.createElement('button');editorResetBtn.type='button';editorResetBtn.id='est-editor-reset';
  const editorCancelBtn=document.createElement('button');editorCancelBtn.type='button';editorCancelBtn.id='est-editor-cancel';
  const editorSaveBtn=document.createElement('button');editorSaveBtn.type='button';editorSaveBtn.id='est-editor-save';editorSaveBtn.className='primary';
  editorActions.append(editorStatus,editorResetBtn,editorCancelBtn,editorSaveBtn);
  $('est-price-editor').append(editorHead,editorGrid,editorActions);
  function openPriceEditor(modelEntry){
    if(!onPricing||!modelEntry)return;
    estEditingModel=modelEntry.model;
    editorFields.input.inp.value=String(modelEntry.pricing.input);
    editorFields.cacheRead.inp.value=String(modelEntry.pricing.cacheRead);
    editorFields.output.inp.value=String(modelEntry.pricing.output);
    editorFields.cacheWrite.inp.value=String(modelEntry.pricing.cacheWrite||0);
    editorStatus.textContent='';editorStatus.className='est-pricing-msg';
    syncPriceEditor(modelEntry);
    $('est-price-editor').hidden=false;
    editorFields.input.inp.focus({preventScroll:true});
  }
  function closePriceEditor(){estEditingModel=null;$('est-price-editor').hidden=true;editorStatus.textContent='';}
  function syncPriceEditor(modelEntry){
    if(!estEditingModel)return;
    editorTitle.textContent=`${estEditingModel} ($/1M)`;
    const def=modelEntry?.pricing?.defaultPricing;
    editorDefaultHint.textContent=def?w(`默认 $${def.input} / $${def.cacheRead} / $${def.output}`,`Default $${def.input} / $${def.cacheRead} / $${def.output}`):'';
    editorFields.input.lbl.textContent=w('输入','Input');
    editorFields.cacheRead.lbl.textContent=w('缓存读','Cache read');
    editorFields.output.lbl.textContent=w('输出','Output');
    editorFields.cacheWrite.lbl.textContent=w('缓存写','Cache write');
    editorResetBtn.textContent=w('恢复默认','Reset');editorResetBtn.hidden=!modelEntry?.pricing?.hasOverride;
    editorCancelBtn.textContent=w('取消','Cancel');editorSaveBtn.textContent=estPricingBusy?w('保存中…','Saving…'):w('保存','Save');
    editorSaveBtn.disabled=estPricingBusy;editorResetBtn.disabled=estPricingBusy;
  }
  async function runPricingAction(payload,{closeEditor=false,successMsg=''}={}){
    if(!onPricing||estPricingBusy||disposed)return;
    estPricingBusy=true;estPricingErr=false;estPricingMsg='';renderEstimate();
    try{
      const res=await onPricing(payload);
      if(res&&res.ok===false)throw new Error(res.error||'Pricing update failed');
      if(closeEditor)closePriceEditor();
      if(successMsg)estPricingMsg=successMsg;
      if(onRefresh)await onRefresh();
    }catch(e){
      estPricingErr=true;
      const msg=e?.message||w('操作失败，请重试','Update failed; please retry');
      if(estEditingModel){editorStatus.textContent=msg;editorStatus.className='est-pricing-msg err';}
      else estPricingMsg=msg;
    }finally{
      estPricingBusy=false;if(!disposed)renderEstimate();
    }
  }
  estFetchPricingBtn.addEventListener('click',()=>void runPricingAction({action:'refresh-live'}));
  estResetAllBtn.addEventListener('click',()=>void runPricingAction({action:'reset-all'},{closeEditor:true}));
  editorCancelBtn.addEventListener('click',closePriceEditor);
  editorResetBtn.addEventListener('click',()=>{if(estEditingModel)void runPricingAction({action:'clear-override',model:estEditingModel},{closeEditor:true});});
  editorSaveBtn.addEventListener('click',()=>{
    if(!estEditingModel)return;
    const input=Number(editorFields.input.inp.value),cacheRead=Number(editorFields.cacheRead.inp.value),output=Number(editorFields.output.inp.value),cacheWrite=Number(editorFields.cacheWrite.inp.value||0);
    if(![input,cacheRead,output,cacheWrite].every(n=>Number.isFinite(n)&&n>=0&&n<=10000)){
      editorStatus.textContent=w('请输入 0–10000 之间的有效数字','Enter valid numbers between 0 and 10000');editorStatus.className='est-pricing-msg err';return;
    }
    void runPricingAction({action:'set-override',model:estEditingModel,input,cacheRead,cacheWrite,output},{closeEditor:true});
  });
  const estPresetSeg=document.createElement('div');estPresetSeg.className='seg';
  const estPresetButtons=[
    {id:'actual'},{id:'group'},{id:'p90',pct:90},{id:'p50',pct:50},{id:'p0',pct:0},
  ].map(item=>{
    const b=document.createElement('button');b.type='button';b.dataset.simPreset=item.id;
    b.addEventListener('click',()=>{if(item.pct!==undefined){simMode='custom';simCachePct=item.pct;}else{simMode=item.id;}renderEstimate();});
    estPresetSeg.append(b);return {...item,button:b};
  });
  const estSliderWrap=document.createElement('div');estSliderWrap.className='est-slider-wrap';
  const estSlider=document.createElement('input');estSlider.type='range';estSlider.id='est-cache-slider';estSlider.className='est-slider';estSlider.min='0';estSlider.max='98';estSlider.step='1';estSlider.value=String(simCachePct);
  const estSliderValue=document.createElement('strong');estSliderValue.id='est-cache-value';estSliderValue.textContent=simCachePct+'%';
  estSliderWrap.append(estSlider,estSliderValue);
  $('est-sim-controls').append(estPresetSeg,estSliderWrap);
  let guideSaving=false,guideError=false,guideSignature=null;
  const replayGuide=window.__agPulseUsageGuidePreview===true;
  function renderGuide(){
    const signature=language.language+'|'+themeSignature();
    if(replayGuide&&signature!==guideSignature){guideDismissed=false;guideError=false;}
    guideSignature=signature;intro.hidden=guideDismissed;
    text('usage-intro-title',w('先了解你的用量统计','About your token usage'));
    text('usage-intro-history',w('自动汇总当前账号可读取的本地历史对话，再持续记录新请求；已删除或缺失的历史可能无法补齐。','Available local conversations for this account are imported automatically, then new requests are recorded. Deleted or missing history may leave gaps.'));
    text('usage-intro-scope',w('统计仅代表本机已记录的 Token 用量，不是账户账单；天、周、月均按 UTC+8 划分。','Totals cover usage recorded on this device, not account billing. Days, weeks and months use UTC+8.'));
    text('usage-intro-storage',w('只在本地保存时间、模型和用量，不保存对话正文。删除对话不会扣除已记录的用量。','Only times, models and usage counters are saved locally, never conversation text. Deleting a chat does not subtract usage already recorded.'));
    text('usage-intro-done',guideSaving?w('保存中…','Saving…'):w('知道了','Got it'));
    text('usage-intro-error',guideError?w('未能保存，请再试一次。','Could not save. Please try again.'):'' );
    $('usage-intro-done').disabled=guideSaving;$('usage-intro-done').setAttribute('aria-busy',String(guideSaving));
  }
  function dismissGuide(){
    if(disposed)return;const focused=view.activeElement===$('usage-intro-done');guideDismissed=true;renderGuide();
    if(focused&&dialog.open)$('overview-tab').focus({preventScroll:true});
  }
  $('usage-intro-done').addEventListener('click',async()=>{
    if(guideSaving||disposed)return;guideSaving=true;guideError=false;renderGuide();
    try{await onDismissGuide();dismissGuide();}catch{if(!disposed)guideError=true;}
    finally{guideSaving=false;if(!disposed)renderGuide();}
  });
  const full=n=>Number(n||0).toLocaleString(zh()?'zh-CN':'en-US');
  const compact=n=>{n=Number(n||0);const limits=[[1e9,'B'],[1e6,'M'],[1e3,'K']];for(const [base,suffix]of limits)if(n>=base)return (n/base).toFixed(1).replace(/\.0$/,'')+suffix;return full(n);};
  const add=(date,days)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  const week=date=>{const d=new Date(date+'T00:00:00Z');return add(date,-((d.getUTCDay()+6)%7));};
  const month=(date,shift)=>{const d=new Date(date.slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+shift);return d.toISOString().slice(0,10);};
  const modelName=model=>model.replace(/-n$/,'').replace(/^gemini-/i,'Gemini ').replace(/^claude-/i,'Claude ').replace(/^gpt-/i,'GPT ').replace(/-/g,' ');
  const fallbackCanonical=raw=>{
    let s=String(raw||'').trim();
    s=s.replace(/\s*\((?:low|medium|high|xhigh|max|min|minimal|thinking|orchestrator|control|trial|tiered|preview|default|fast)\)\s*$/ig,'').trim();
    s=s.replace(/(?:[\s_-]+(?:n|control|trial|tiered|preview|latest|default|low|medium|high|xhigh|thinking))+$/ig,'').trim()||s;
    return modelName(s);
  };
  const fallbackTier=raw=>{
    const s=String(raw||'').trim();
    if(/\borchestrator\b/i.test(s))return 'orchestrator';
    if(/\(\s*max\s*\)|(?:^|[\s_-])max(?=$|[\s_-])/i.test(s))return 'max';
    if(/\(\s*(?:xhigh|extra[\s_-]*high)\s*\)|(?:^|[\s_-])(?:xhigh|extra[\s_-]*high)(?=$|[\s_-])/i.test(s))return 'xhigh';
    if(/\(\s*high\s*\)|(?:^|[\s_-])high(?=$|[\s_-])/i.test(s))return 'high';
    if(/\(\s*medium\s*\)|(?:^|[\s_-])medium(?=$|[\s_-])/i.test(s))return 'medium';
    if(/\(\s*low\s*\)|(?:^|[\s_-])low(?=$|[\s_-])/i.test(s))return 'low';
    if(/\(\s*(?:min|minimal|none)\s*\)|(?:^|[\s_-])(?:min|minimal)(?=$|[\s_-])/i.test(s))return 'minimal';
    if(/\(\s*thinking\s*\)|(?:^|[\s_-])thinking(?=$|[\s_-])/i.test(s))return 'thinking';
    return 'default';
  };
  const TIER_ORDER=['max','xhigh','high','medium','low','minimal','thinking','orchestrator','default'];
  const tierLabel=tier=>({
    max:'Max',xhigh:'XHigh',high:'High',medium:'Medium',low:'Low',minimal:'Minimal',
    thinking:w('思考','Thinking'),orchestrator:'Orchestrator',default:w('默认','Default'),
  })[tier]||tier;
  const canonicalName=raw=>value?.modelAliases?.[raw]||fallbackCanonical(raw);
  const effortTier=raw=>value?.modelTiers?.[raw]||fallbackTier(raw);
  const activeModels=()=>[...new Set((value?.models||[]).map(canonicalName))].sort();
  const themeSignature=()=>{const s=getComputedStyle(root.host||dialog);return [s.getPropertyValue('--pulse-accent'),s.getPropertyValue('--pulse-background'),root.host?.dataset.pulseTheme].join('|');};
  let paletteKey='',modelColors=new Map();
  const colorCanvas=document.createElement('canvas');colorCanvas.width=colorCanvas.height=1;
  const colorContext=colorCanvas.getContext('2d',{willReadFrequently:true});
  const rgb=css=>{colorContext.clearRect(0,0,1,1);colorContext.fillStyle='#000';colorContext.fillStyle=css;colorContext.fillRect(0,0,1,1);return [...colorContext.getImageData(0,0,1,1).data].slice(0,3);};
  const luminance=a=>a.reduce((sum,v,i)=>{v/=255;return sum+(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][i];},0);
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  const hsl=a=>{const [r,g,b]=a.map(v=>v/255),hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo,l=(hi+lo)/2;return [d?((hi===r?(g-b)/d+(g<b?6:0):hi===g?(b-r)/d+2:(r-g)/d+4)*60):0,d?d/(1-Math.abs(2*l-1)):0,l];};
  const fromHsl=(h,s,l)=>{const a=s*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))));};return [f(0),f(8),f(4)];};
  function syncPalette(){
    const estModels=(value?.quotaEstimate?.groups||[]).flatMap(g=>(g.models||[]).map(m=>m.model));
    const models=[...new Set([...activeModels(),...estModels])].sort(),key=themeSignature()+'|'+models.join('|');if(key===paletteKey)return;paletteKey=key;modelColors.clear();
    const style=getComputedStyle(root.host||dialog),base=rgb(style.getPropertyValue('--pulse-accent').trim()||'#85a8ff'),background=rgb(style.getPropertyValue('--pulse-background').trim()||'#1c1d1f'),[h,s]=hsl(base);
    // An analogous scale stays harmonious as the host accent changes. Tonal
    // variation distinguishes adjacent series without provider brand colors.
    const dark=luminance(background)<.35,offsets=[0,-18,18,-36,36,-9,9,-27,27],tones=dark?[.64,.52,.73,.59,.68]:[.43,.33,.51,.38,.47];
    const end=contrast([255,255,255],background)>contrast([0,0,0],background)?1:0;
    models.forEach((model,i)=>{const hue=(h+offsets[i%offsets.length]+360)%360,saturation=s<.08?.07:Math.max(.28,Math.min(.55,s*.72));let lightness=tones[i%tones.length],c=fromHsl(hue,saturation,lightness);
      // Chart marks (including small legend dots) need contrast on the actual
      // custom background, rather than relying solely on dark/light labels.
      for(let step=0;contrast(c,background)<3&&step<100;step++){lightness+=end? .005:-.005;lightness=Math.max(0,Math.min(1,lightness));c=fromHsl(hue,saturation,lightness);}
      modelColors.set(model,'rgb('+c.join(' ')+')');
    });
  }
  const color=model=>modelColors.get(model)||'var(--pulse-accent)';
  const totals=(from,to,filter=false)=>{
    const models={};let hasCost=typeof value?.totalCostUsd==='number';
    const numKeys=['total','requests','uncached','cacheRead','cacheWrite','output','costUsd'];
    for(const day of value?.days||[])if(day.date>=from&&day.date<=to)for(const [rawModel,r]of Object.entries(day.models)){
      const model=canonicalName(rawModel);
      if(filter&&disabledModels.has(model))continue;
      if(typeof r.costUsd==='number')hasCost=true;
      const entry=models[model]||(models[model]={total:0,requests:0,uncached:0,cacheRead:0,cacheWrite:0,output:0,costUsd:0,tiers:new Map()});
      for(const key of numKeys)entry[key]+=r[key]||0;
      const tier=effortTier(rawModel);
      const tEntry=entry.tiers.get(tier)||{tier,total:0,requests:0,uncached:0,cacheRead:0,cacheWrite:0,output:0,costUsd:0,rawNames:new Set()};
      for(const key of numKeys)tEntry[key]+=r[key]||0;
      tEntry.rawNames.add(rawModel);
      entry.tiers.set(tier,tEntry);
    }
    const vals=Object.values(models);
    return {from,to,models,total:vals.reduce((n,r)=>n+r.total,0),requests:vals.reduce((n,r)=>n+r.requests,0),costUsd:hasCost?vals.reduce((n,r)=>n+(r.costUsd||0),0):null};
  };
  const node=(tag,className,content)=>{const n=document.createElement(tag);if(className)n.className=className;if(content!==undefined)n.textContent=content;return n;};
  const setMeta=(el,parts)=>{el.replaceChildren(...parts.filter(Boolean).map(p=>node('span','meta-item',p)));el.classList.add('meta-row');};
  const makePair=(a,b)=>{const span=node('span','');span.append(document.createTextNode(a),node('i','row-sep'),document.createTextNode(b));return span;};
  function tooltip(bucket,target,activeModel=null){
    if(!$('tip').hidden&&tipTarget===target&&tipModel===activeModel)return;tipTarget=target;tipModel=activeModel;
    highlightModel(activeModel);
    const tip=$('tip');
    const subLine=node('div','muted');
    const reqText=w(`${bucket.requests} 次请求`,`${bucket.requests} requests`);
    const costText=fmtCost(bucket.costUsd);
    if(costText)subLine.append(document.createTextNode(reqText),node('i','row-sep'),document.createTextNode(costText));
    else subLine.textContent=reqText;
    tip.replaceChildren(node('div','tip-title',bucket.from===bucket.to?bucket.from:bucket.from+' – '+bucket.to),node('strong','',full(bucket.total)+' Token'),subLine);
    for(const [model,r]of Object.entries(bucket.models).sort((a,b)=>b[1].total-a[1].total)){
      const row=node('div','tip-model'+(activeModel?(activeModel===model?' active':' dimmed'):'')),label=node('span',''),dot=node('i','dot'),amount=node('span','',compact(r.total));
      dot.style.setProperty('--model-color',color(model));
      label.append(dot,document.createTextNode(model));
      if(bucket.costUsd!==null)amount.append(node('span','tip-cost',fmtCost(r.costUsd)));
      amount.append(node('span','model-share',bucket.total?(r.total/bucket.total*100).toFixed(1)+'%':'0%'));
      row.append(label,amount);tip.append(row);
    }
    tip.hidden=false;const rect=target.getBoundingClientRect(),bounds=dialog.getBoundingClientRect(),r=tip.getBoundingClientRect();
    tip.style.left=Math.min(bounds.right-r.width-12,Math.max(bounds.left+12,rect.left+rect.width/2-r.width/2))+'px';
    tip.style.top=Math.max(bounds.top+12,rect.top-r.height-10)+'px';
  }
  const bindBucket=(button,bucket)=>{
    button.setAttribute('aria-label',(bucket.from===bucket.to?bucket.from:bucket.from+' – '+bucket.to)+': '+full(bucket.total)+' Token');
    button.addEventListener('pointerenter',()=>tooltip(bucket,button));button.addEventListener('pointerleave',()=>{$('tip').hidden=true;highlightModel(null);});button.addEventListener('focus',()=>tooltip(bucket,button));button.addEventListener('blur',()=>{$('tip').hidden=true;highlightModel(null);});
    button.addEventListener('pointermove',event=>{const model=event.target.closest?.('.bar-segment')?.dataset.model||null;tooltip(bucket,button,model);});
    button.addEventListener('click',()=>{selected=bucket;anchor=bucket.from;showSelection();});
  };
  function showSelection(){
    const bucket=selected||totals(value.today,value.today);
    text('selection-title',bucket.from===bucket.to?bucket.from:bucket.from+' – '+bucket.to);
    const sel=$('selection-value'),base=w(`${full(bucket.total)} Token（${bucket.requests} 次请求）`,`${full(bucket.total)} Token (${bucket.requests} requests)`),costText=fmtCost(bucket.costUsd);
    if(costText)sel.replaceChildren(document.createTextNode(base),node('i','row-sep'),node('span','metric-cost',costText));
    else sel.textContent=base;
  }
  function renderHeat(){
    if(!value)return;
    const start=week(year+'-01-01'),end=year+'-12-31',weeks=Math.floor((Date.parse(end)-Date.parse(start))/604800000)+1;
    $('heat').replaceChildren();$('months').replaceChildren();$('weekdays').replaceChildren();$('heat').className='heat'+(heatMode==='week'?' week':'');
    $('heat').style.gridTemplateColumns=`repeat(${weeks},minmax(0,1fr))`;
    if(heatMode==='week')$('heat').style.setProperty('grid-template-columns',`repeat(${Math.ceil(weeks/2)},minmax(0,1fr))`,'important');
    const buckets=[];for(let i=0;i<(heatMode==='day'?weeks*7:weeks);i++){
      const date=add(start,heatMode==='day'?i:i*7),to=heatMode==='day'?date:add(date,6);
      buckets.push(heatMode==='day'?totals(date,date):totals(date<year+'-01-01'?year+'-01-01':date,to>end?end:to));
    }
    const max=Math.max(1,...buckets.map(b=>b.total));
    for(const bucket of buckets){
      const button=node('button','');button.type='button';const future=bucket.from>value.today||bucket.to<year+'-01-01'||bucket.from>year+'-12-31';
      button.dataset.level=bucket.total===0?'0':String(Math.min(4,Math.ceil(bucket.total/max*4)));if(future){button.className='future';button.disabled=true;}
      if(!future)bindBucket(button,bucket);button.tabIndex=-1;$('heat').append(button);
    }
    const usable=[...$('heat').children].filter(b=>!b.disabled),lastActive=[...$('heat').children].reverse().find(b=>!b.disabled&&b.dataset.level!=='0');
    if(usable.length)(lastActive||usable.at(-1)).tabIndex=0;
    if(heatMode==='day'){
      $('months').style.gridTemplateColumns=`repeat(${weeks},minmax(0,1fr))`;
      for(let m=1;m<=12;m++){const date=`${year}-${String(m).padStart(2,'0')}-01`,col=Math.floor((Date.parse(date)-Date.parse(start))/604800000)+1;
        const label=node('span','',zh()?m+'月':['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]);label.style.gridColumn=col;label.style.gridRow=1;$('months').append(label);}
      for(let i=0;i<7;i++)$('weekdays').append(node('span','',i%2===0?(zh()?['一','','三','','五','','日'][i]:['M','','W','','F','','S'][i]):''));
    }
    text('heat-sub',heatMode==='week'?w('周一起','Mon–Sun'):'');
    const annual=totals(year+'-01-01',year+'-12-31'),annualText=w(`${year} 年：${full(annual.total)} Token`,`${year}: ${full(annual.total)} tokens`),annualCost=fmtCost(annual.costUsd);
    if(annualCost)$('heat-summary').replaceChildren(document.createTextNode(annualText),node('i','row-sep'),node('span','metric-cost',annualCost));
    else text('heat-summary',annualText);
    for(const b of view.querySelectorAll('[data-heat]'))b.setAttribute('aria-pressed',String(b.dataset.heat===heatMode));showSelection();
  }
  function highlightModel(model){
    if(model)$('plot').dataset.highlight=model;else delete $('plot').dataset.highlight;
    for(const bar of $('plot').querySelectorAll('.bar-segment')){if(model&&bar.dataset.model===model)bar.dataset.highlight='true';else delete bar.dataset.highlight;}
  }
  const chartSummary=node('div','chart-summary');$('detail-title').after(chartSummary);
  const chartHeading=node('div','');$('detail-title').before(chartHeading);chartHeading.append($('detail-title'),chartSummary);
  function clampMinDate(date){return value?.firstDate&&date<value.firstDate&&value.firstDate<=value.today?value.firstDate:date;}
  function ensureCustomRange(){
    if(!value)return;
    if(!customFrom||!DATE_RE.test(customFrom)||!customTo||!DATE_RE.test(customTo)){
      customTo=value.today;customFrom=clampMinDate(add(value.today,-13));
    }
    if(customTo>value.today)customTo=value.today;
    if(customFrom>customTo)customFrom=customTo;
    const minAllowed=add(customTo,-729);
    if(customFrom<minAllowed)customFrom=minAllowed;
  }
  function applyBarGeometry(count,adaptive){
    const plot=$('plot'),chart=plot.parentElement;
    if(!adaptive){
      for(const prop of ['--plot-gap','--bar-width','--bar-max-width','--bar-radius'])plot.style.removeProperty(prop);
      chart.style.removeProperty('--chart-min-width');
      return;
    }
    const n=Math.max(1,count);
    const gap=n<=7?10:n<=14?8:n<=31?5:n<=60?3:n<=100?2:1;
    const widthPct=n===1?'42%':n===2?'46%':n<=5?'54%':n<=10?'60%':n<=18?'66%':n<=31?'70%':n<=50?'78%':n<=80?'84%':n<=120?'88%':'92%';
    const maxW=n===1?'76px':n===2?'72px':n<=5?'66px':n<=10?'52px':n<=18?'40px':n<=31?'30px':n<=50?'22px':n<=80?'16px':n<=120?'12px':'10px';
    const radius=n<=5?'5px':n<=31?'4px':n<=60?'3px':n<=120?'2px':'1px';
    const minW=n>90?Math.max(650,n*7+58)+'px':'650px';
    plot.style.setProperty('--plot-gap',gap+'px');
    plot.style.setProperty('--bar-width',widthPct);
    plot.style.setProperty('--bar-max-width',maxW);
    plot.style.setProperty('--bar-radius',radius);
    chart.style.setProperty('--chart-min-width',minW);
  }
  function renderChart(){
    if(!value)return;syncPalette();$('tip').hidden=true;highlightModel(null);
    const buckets=[];let customGrouped=false,spanDays=0;
    $('custom-bar').hidden=period!=='custom';
    if(period==='day'){const start=month(anchor,0),end=add(month(anchor,1),-1);for(let date=start;date<=end;date=add(date,1))buckets.push(totals(date,date,true));text('range-label',start.slice(0,7));}
    else if(period==='week'){const start=add(week(anchor),-11*7);for(let i=0;i<12;i++){const from=add(start,i*7);buckets.push(totals(from,add(from,6),true));}text('range-label',start.slice(5)+' – '+add(week(anchor),6).slice(5));}
    else if(period==='month'){for(let i=-11;i<=0;i++){const from=month(anchor,i);buckets.push(totals(from,add(month(from,1),-1),true));}text('range-label',buckets[0].from.slice(0,7)+' – '+month(anchor,0).slice(0,7));}
    else{
      ensureCustomRange();
      customFromInput.value=customFrom;customToInput.value=customTo;
      customFromInput.max=value.today;customToInput.max=value.today;
      customFromInput.setAttribute('aria-label',w('开始日期','Start date'));
      customToInput.setAttribute('aria-label',w('结束日期','End date'));
      spanDays=Math.max(1,Math.floor((Date.parse(customTo)-Date.parse(customFrom))/86400000)+1);
      if(spanDays<=180){for(let date=customFrom;date<=customTo;date=add(date,1))buckets.push(totals(date,date,true));}
      else{customGrouped=true;for(let date=customFrom;date<=customTo;date=add(date,7)){const to=add(date,6);buckets.push(totals(date,to>customTo?customTo:to,true));}}
      text('range-label',customFrom===customTo?customFrom:customFrom+' – '+customTo);
      text('custom-span',customGrouped?w(`${spanDays} 天（按周）`,`${spanDays}d (weekly)`):w(`${spanDays} 天`,`${spanDays}d`));
      const presetMap={'7':clampMinDate(add(value.today,-6)),'14':clampMinDate(add(value.today,-13)),'30':clampMinDate(add(value.today,-29)),'90':clampMinDate(add(value.today,-89)),all:value.firstDate||value.today};
      for(const btn of $('custom-presets').children){
        const p=btn.dataset.preset;
        btn.textContent=({7:w('近7天','7D'),14:w('近14天','14D'),30:w('近30天','30D'),90:w('近90天','90D'),all:w('全部','All')})[p];
        btn.setAttribute('aria-pressed',String(customTo===value.today&&customFrom===presetMap[p]));
      }
    }
    applyBarGeometry(buckets.length,period==='custom');
    const displayModels=activeModels();
    $('next').disabled=period==='custom'?customTo>=value.today:period==='week'?week(anchor)>=week(value.today):anchor.slice(0,7)>=value.today.slice(0,7);$('legend').replaceChildren();
    for(const model of displayModels){const button=node('button',''),dot=node('i','dot');dot.style.setProperty('--model-color',color(model));button.append(dot,document.createTextNode(model));button.type='button';button.setAttribute('aria-pressed',String(!disabledModels.has(model)));button.addEventListener('click',()=>{if(disabledModels.has(model))disabledModels.delete(model);else disabledModels.add(model);renderChart();});button.addEventListener('pointerenter',()=>highlightModel(disabledModels.has(model)?null:model));button.addEventListener('pointerleave',()=>highlightModel(null));$('legend').append(button);}
    const max=Math.max(1,...buckets.map(b=>b.total)),ceiling=max>1?Math.ceil(max/(10**Math.floor(Math.log10(max))))*10**Math.floor(Math.log10(max)):1;
    $('axis').replaceChildren();$('plot').replaceChildren();
    for(let i=0;i<=4;i++){const label=node('span','',compact(ceiling*i/4));label.style.bottom=(19+(246-19)*i/4)+'px';$('axis').append(label);const line=node('i','grid-line');line.style.bottom=(19+(246-19)*i/4)+'px';$('plot').append(line);}
    const customLabelStep=period==='custom'?Math.max(1,Math.ceil(buckets.length/Math.max(6,Math.floor(Math.max(650,buckets.length*7)/76)))):1;
    const multiYear=period==='custom'&&customFrom.slice(0,4)!==customTo.slice(0,4);
    for(const [i,bucket]of buckets.entries()){
      const button=node('button','bar-column');button.type='button';const stack=node('div','stack');
      const segments=displayModels.filter(model=>bucket.models[model]?.total>0);
      // Continuous stack: rounding clips only its outer top corners. Internal
      // separators are inset, so small values and total heights remain exact.
      for(const [j,model]of segments.entries()){const r=bucket.models[model],bar=node('i','bar-segment'),height=r.total/ceiling*227;bar.dataset.model=model;bar.setAttribute('aria-hidden','true');bar.style.setProperty('--model-color',color(model));bar.style.height=height+'px';if(j&&height>=3)bar.style.boxShadow='inset 0 -1px 0 color-mix(in srgb,var(--pulse-background) 48%,transparent)';stack.append(bar);}
      if(!bucket.total)stack.append(node('i','empty-bar'));button.append(stack);
      if(period==='custom'){
        const showLabel=buckets.length<=10||i===0||i===buckets.length-1||(i%customLabelStep===0&&buckets.length-1-i>=Math.ceil(customLabelStep/2));
        if(showLabel){
          const prevYear=i>0?buckets[i-1].from.slice(0,4):null;
          const lbl=multiYear&&(i===0||bucket.from.slice(0,4)!==prevYear)?bucket.from.slice(2):bucket.from.slice(5);
          button.append(node('span','x-label',lbl));
        }
      }else if(period!=='day'||i%3===0||i===buckets.length-1){
        button.append(node('span','x-label',period==='day'?String(i+1):period==='week'?bucket.from.slice(5):bucket.from.slice(0,7)));
      }
      bindBucket(button,bucket);$('plot').append(button);
    }
    if(!buckets.some(b=>b.total))$('plot').append(node('div','chart-empty',w('暂无记录','No data')));
    $('table-head').replaceChildren(...[w('模型','Model'),w('总计','Total'),w('等效额度','API equiv.'),w('未缓存','Uncached'),w('缓存读','Cache read'),w('缓存写','Cache write'),w('输出','Output')].map(label=>node('th','',label)));
    $('table-body').replaceChildren();tableFoot.replaceChildren();
    const rangeTotals=totals(buckets[0].from,buckets.at(-1).to,true);
    const rangeCost=fmtCost(rangeTotals.costUsd);
    const summaryNodes=[node('strong','',compact(rangeTotals.total)+' Token'),node('i','row-sep'),node('span','',w(`${full(rangeTotals.requests)} 次请求`,`${full(rangeTotals.requests)} requests`))];
    if(rangeCost)summaryNodes.push(node('i','row-sep'),node('strong','',rangeCost));
    chartSummary.replaceChildren(...summaryNodes);
    const sortedModels=Object.entries(rangeTotals.models).sort((a,b)=>b[1].total-a[1].total);
    lastExpandableModels=sortedModels.filter(([,r])=>r.tiers&&r.tiers.size>1).map(([m])=>m);
    const allExpanded=lastExpandableModels.length>0&&lastExpandableModels.every(m=>expandedModels.has(m));
    expandAllBtn.hidden=!lastExpandableModels.length;
    expandAllBtn.setAttribute('aria-pressed',String(allExpanded));
    expandAllBtn.textContent=allExpanded?w('折叠强度','Collapse tiers'):w('展开强度','Expand tiers');
    const sumRow={total:0,costUsd:0,uncached:0,cacheRead:0,cacheWrite:0,output:0};
    for(const [model,r]of sortedModels){
      const tiers=[...(r.tiers?.values()||[])].sort((a,b)=>TIER_ORDER.indexOf(a.tier)-TIER_ORDER.indexOf(b.tier));
      const expandable=tiers.length>1;
      const expanded=expandable&&expandedModels.has(model);
      const row=node('tr',expandable?'model-parent':''),label=node('td',''),dot=node('span','dot');
      dot.style.setProperty('--model-color',color(model));
      if(expandable){
        row.dataset.expanded=String(expanded);
        row.dataset.model=model;
        row.tabIndex=0;
        row.setAttribute('aria-expanded',String(expanded));
        const toggle=()=>{if(expandedModels.has(model))expandedModels.delete(model);else expandedModels.add(model);renderChart();};
        row.addEventListener('click',toggle);
        row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
        label.append(node('span','fold-caret','▸'));
      }else if(lastExpandableModels.length){
        label.append(node('span','fold-spacer',''));
      }
      label.append(dot,document.createTextNode(model));
      if(expandable)label.append(node('span','variant-tag',String(tiers.length)));
      else if(tiers.length===1&&tiers[0].tier!=='default')label.append(node('span','variant-tag',tierLabel(tiers[0].tier)));
      const costCell=node('td','',rangeTotals.costUsd!==null?fmtCost(r.costUsd):'—');
      if(rangeTotals.costUsd>0&&typeof r.costUsd==='number')costCell.title=`${fmtCost(r.costUsd)} (${(r.costUsd/rangeTotals.costUsd*100).toFixed(1)}%)`;
      row.append(label,node('td','',full(r.total)),costCell,...[r.uncached,r.cacheRead,r.cacheWrite,r.output].map(n=>node('td','',full(n))));
      $('table-body').append(row);
      if(expanded){
        for(const t of tiers){
          const trow=node('tr','model-tier-row');
          trow.dataset.parentModel=model;trow.dataset.tier=t.tier;
          const tLabel=node('td','');
          const pill=node('span','tier-pill',tierLabel(t.tier));
          tLabel.append(pill);
          if(t.rawNames.size>1)tLabel.title=[...t.rawNames].join('\n');
          const tCost=node('td','',rangeTotals.costUsd!==null?fmtCost(t.costUsd):'—');
          if(r.costUsd>0&&typeof t.costUsd==='number')tCost.title=`${fmtCost(t.costUsd)} (${(t.costUsd/r.costUsd*100).toFixed(1)}%)`;
          trow.append(tLabel,node('td','',full(t.total)),tCost,...[t.uncached,t.cacheRead,t.cacheWrite,t.output].map(n=>node('td','',full(n))));
          $('table-body').append(trow);
        }
      }
      for(const k of Object.keys(sumRow))sumRow[k]+=r[k]||0;
    }
    if(sortedModels.length){
      const frow=node('tr','');
      frow.append(node('td','',w('合计','Total')),node('td','',full(sumRow.total)),node('td','',rangeTotals.costUsd!==null?fmtCost(sumRow.costUsd):'—'),...[sumRow.uncached,sumRow.cacheRead,sumRow.cacheWrite,sumRow.output].map(n=>node('td','',full(n))));
      tableFoot.append(frow);
    }
    for(const b of view.querySelectorAll('[data-period]'))b.setAttribute('aria-pressed',String(b.dataset.period===period));
  }
  function simulatedRate(pricing,shares,cacheHit){
    if(!pricing)return null;
    const outShare=Math.min(0.5,Math.max(0.005,shares?.output??0.015));
    const inShare=1-outShare;
    const h=Math.max(0,Math.min(0.99,cacheHit));
    const cost=inShare*(1-h)*pricing.input+inShare*h*pricing.cacheRead+outShare*pricing.output;
    return Number.isFinite(cost)&&cost>0?cost:null;
  }
  function renderEstimate(){
    if(!value)return;
    text('est-title',w('剩余额度测算','Remaining tokens'));
    const est=value.quotaEstimate;
    const groups=est?.groups||[];
    if(!groups.length){
      text('est-sub','');$('est-groups').replaceChildren();$('est-content').hidden=true;$('est-empty').hidden=false;
      text('est-empty',w('暂无额度数据','No quota data'));
      return;
    }
    $('est-empty').hidden=true;$('est-content').hidden=false;
    const group=groups.find(g=>g.id===estGroupId)||groups.find(g=>g.activeModel)||groups[0];
    estGroupId=group.id;
    $('est-groups').replaceChildren(...groups.map(g=>{
      const btn=node('button','',groupShortName(g));btn.type='button';btn.setAttribute('aria-pressed',String(g.id===group.id));
      btn.addEventListener('click',()=>{estGroupId=g.id;renderEstimate();});return btn;
    }));
    if(group.recentRequests>0){
      const spanText=group.recentWindowDays?w(`近 ${group.recentWindowDays} 天`,`${group.recentWindowDays}d`):w('全部','All');
      const hitPct=((group.recentCacheHitRate??0)*100).toFixed(1)+'%';
      setMeta($('est-sub'),[spanText,w(`${full(group.recentRequests)} 次`,`${full(group.recentRequests)} req`),w(`${hitPct} 缓存`,`${hitPct} cache`),`~${fmtUsd(group.recentCostUsd)}`]);
    }else{
      $('est-sub').classList.remove('meta-row');
      text('est-sub',w('暂无近期记录','No recent usage'));
    }
    // Compute estimation basis: recent model mix vs single selected model
    const groupHit=group.recentCacheHitRate??0.9;
    const activeEntry=group.models.find(m=>m.active)||group.models[0]||null;
    const chosenModel=group.models.find(m=>m.model===estSelectedModel)||activeEntry||null;
    if(chosenModel)estSelectedModel=chosenModel.model;

    text('est-basis-label',w('口径','Basis'));
    const basisLabels={mix:w('当前比例','Mix'),single:w('单模型','Single')};
    for(const item of estBasisButtons){
      if(item.button.textContent!==basisLabels[item.id])item.button.textContent=basisLabels[item.id];
      item.button.setAttribute('aria-pressed',String(estBasis===item.id));
    }
    text('est-cal-label',w('校准','Mode'));
    const calLabels={window:w('全窗口','Window'),delta:w('增量','Delta')};
    for(const item of estCalButtons){
      if(item.button.textContent!==calLabels[item.id])item.button.textContent=calLabels[item.id];
      item.button.setAttribute('aria-pressed',String(estCalMode===item.id));
    }
    const modelOptKey=language.language+'|'+group.models.map(m=>m.model+':'+m.active+':'+m.recentTokens).join('|');
    const recentTotalTok=group.models.reduce((s,m)=>s+(m.recentTokens||0),0);
    if(estModelSelect.dataset.key!==modelOptKey){
      estModelSelect.replaceChildren(...group.models.map(m=>{
        const opt=document.createElement('option');opt.value=m.model;
        const meta=[];if(m.active)meta.push(w('当前','Active'));if(recentTotalTok>0&&m.recentTokens>0)meta.push(`${(m.recentTokens/recentTotalTok*100).toFixed(0)}%`);
        opt.textContent=m.model+(meta.length?w(`（${meta.join('，')}）`,` (${meta.join(', ')})`):'');
        return opt;
      }));
      estModelSelect.dataset.key=modelOptKey;
    }
    if(chosenModel&&estModelSelect.value!==chosenModel.model)estModelSelect.value=chosenModel.model;
    estModelSelect.setAttribute('aria-label',w('选择测算模型','Select model'));
    estModelSelect.hidden=estBasis!=='single'||!group.models.length;
    const mixParts=recentTotalTok>0
      ?group.models.filter(m=>m.recentTokens>0).sort((a,b)=>b.recentTokens-a.recentTokens).slice(0,3).map(m=>`${m.model.replace(/^Gemini 4 |^Claude /,'')} ${(m.recentTokens/recentTotalTok*100).toFixed(0)}%`)
      :[];
    estMixHint.hidden=estBasis!=='mix'||!mixParts.length;
    if(mixParts.length){estMixHint.replaceChildren(...mixParts.map(p=>node('span','mix-chip',p)));estMixHint.title=group.models.filter(m=>m.recentTokens>0).sort((a,b)=>b.recentTokens-a.recentTokens).map(m=>`${m.model}: ${(m.recentTokens/recentTotalTok*100).toFixed(1)}%`).join('\n');}

    const groupAvgPricing=(()=>{
      const priced=group.models.filter(m=>m.recentTokens>0&&m.pricing);
      if(!priced.length)return activeEntry?.pricing||null;
      const tot=priced.reduce((s,m)=>s+m.recentTokens,0);
      return {
        input:priced.reduce((s,m)=>s+m.pricing.input*m.recentTokens,0)/tot,
        cacheRead:priced.reduce((s,m)=>s+m.pricing.cacheRead*m.recentTokens,0)/tot,
        output:priced.reduce((s,m)=>s+m.pricing.output*m.recentTokens,0)/tot,
      };
    })();
    const customHit=simCachePct/100;
    const mixHit=simMode==='custom'?customHit:groupHit;
    const mixRate=simMode==='actual'?group.recentBlendedCostPer1M:(groupAvgPricing?simulatedRate(groupAvgPricing,group.recentShares,mixHit):null);
    const singleHit=chosenModel?(simMode==='custom'?customHit:simMode==='group'?groupHit:(chosenModel.cacheHitRate??groupHit)):groupHit;
    const singleRate=chosenModel?(simMode==='actual'?chosenModel.blendedCostPer1M:simulatedRate(chosenModel.pricing,chosenModel.shares,singleHit)):null;
    const badgeInfo=(wd,useDelta)=>{
      if(!wd?.available)return [w('不可用','N/A'),''];
      if(useDelta){
        const c=wd.delta.confidence;
        return [w('增量','Delta'),c==='high'?'high':c==='low'?'low':''];
      }
      if(estCalMode==='delta'&&wd.calibrated)return [w('待增量','Pending Δ'),'low'];
      if(!wd.calibrated)return [w('待校准','Pending'),'low'];
      if(wd.calibrationSource==='exhausted')return [w('耗尽','Exhausted'),'low'];
      if(wd.confidence==='low')return [w('低样本','Low'),'low'];
      if(wd.calibrationSource==='prior-window')return [w('上周期','Prior'),''];
      if(wd.calibrationSource==='blended')return [w('混合','Blended'),'high'];
      return [w('当前','Window'),wd.confidence==='high'?'high':''];
    };
    const buildBreakdown=(estTokens,shares,hit,useActualShares)=>{
      if(estTokens===null)return null;
      if(estTokens===0)return {uncached:0,cacheRead:0,cacheWrite:0,output:0};
      if(useActualShares&&shares){
        return {
          uncached:Math.round(estTokens*(shares.uncached||0)),
          cacheRead:Math.round(estTokens*(shares.cacheRead||0)),
          cacheWrite:Math.round(estTokens*(shares.cacheWrite||0)),
          output:Math.round(estTokens*(shares.output||0)),
        };
      }
      const outS=Math.min(0.5,Math.max(0.005,shares?.output??0.015)),inS=1-outS;
      return {uncached:Math.round(estTokens*inS*(1-hit)),cacheRead:Math.round(estTokens*inS*hit),cacheWrite:0,output:Math.round(estTokens*outS)};
    };
    const resolveWindowQuota=wd=>{
      if(!wd?.available)return {calibrated:false,useDelta:false,totalUsd:null,remUsd:null};
      const useDelta=estCalMode==='delta'&&wd.delta?.available===true;
      if(useDelta)return {calibrated:true,useDelta:true,totalUsd:wd.delta.totalQuotaUsd,remUsd:wd.delta.remainingQuotaUsd};
      return {calibrated:Boolean(wd.calibrated),useDelta:false,totalUsd:wd.totalQuotaUsd,remUsd:wd.remainingQuotaUsd};
    };
    $('est-windows').replaceChildren();
    for(const [wKey,wTitle]of [['5h','5h'],['weekly',w('周额度','Weekly')]]){
      const wd=group.windows?.[wKey];
      const q=resolveWindowQuota(wd);
      const card=node('div','est-card');
      const head=node('div','est-card-head');
      head.append(node('span','est-card-title',wTitle));
      const meta=node('div','est-card-meta');
      if(wd?.available&&typeof wd.remaining==='number')meta.append(node('span','est-badge',(wd.remaining*100).toFixed(1)+'%'));
      const [bLabel,bClass]=badgeInfo(wd,q.useDelta);
      meta.append(node('span','est-badge'+(bClass?' '+bClass:''),bLabel));
      head.append(meta);card.append(head);

      const primary=node('div','est-primary');
      const sub=node('div','est-sub');
      let breakdown=null;
      if(q.calibrated){
        let estTokens=null;
        if(estBasis==='single'&&chosenModel){
          if(wd.remaining===0){estTokens=0;}
          else if(q.remUsd!=null&&singleRate){estTokens=Math.round((q.remUsd/singleRate)*1e6);}
          breakdown=buildBreakdown(estTokens,chosenModel.shares,singleHit,simMode==='actual');
          if(singleRate)setMeta(sub,[chosenModel.model,`$${singleRate.toFixed(3)}/1M`,`${(singleHit*100).toFixed(1)}%`]);
          else sub.textContent=chosenModel.model;
        }else{
          const effectiveRate=q.useDelta&&simMode==='actual'?(wd.delta.blendedCostPer1M??mixRate):(mixRate??wd.blendedCostPer1M);
          if(wd.remaining===0){estTokens=0;}
          else if(simMode==='actual'&&q.useDelta){estTokens=wd.delta.estimatedRemainingTokens;}
          else if(simMode==='actual'&&!q.useDelta){estTokens=wd.estimatedRemainingTokens;}
          else if(q.remUsd!=null&&effectiveRate){estTokens=Math.round((q.remUsd/effectiveRate)*1e6);}
          breakdown=simMode==='actual'?(q.useDelta?wd.delta.breakdown:wd.breakdown):buildBreakdown(estTokens,group.recentShares,mixHit,false);
          if(effectiveRate)setMeta(sub,[`$${effectiveRate.toFixed(3)}/1M`,w(`${(mixHit*100).toFixed(1)}% 缓存`,`${(mixHit*100).toFixed(1)}% cache`)]);
          else sub.textContent='';
        }
        primary.append(document.createTextNode(estTokens===null?'—':estTokens===0?'0':'~'+compact(estTokens)),node('span','unit','Token'));
        if(estTokens!==null)primary.title=full(estTokens)+' Token';
        sub.title=[...sub.children].map(n=>n.textContent).join(' | ')||sub.textContent;
      }else{
        primary.textContent='—';
        sub.textContent=w('暂无窗口消耗','No usage in window');
      }
      card.append(primary,sub);

      const rows=node('div','est-rows');
      const addRow=(k,v,tip)=>{const r=node('div','est-row');r.append(node('span','',k),typeof v==='string'?node('span','',v):v);if(tip)r.title=tip;rows.append(r);};
      const spanRange=wd?.windowStartAt&&wd?.resetAt?`${fmtStamp(wd.windowStartAt)} – ${fmtStamp(wd.resetAt)}`:'—';
      if(q.useDelta){
        addRow(w('起点','Since'),`${fmtStamp(wd.delta.sinceAt)} (+${(wd.delta.deltaFraction*100).toFixed(1)}%)`,spanRange);
      }else{
        addRow(w('区间','Window'),spanRange,spanRange);
      }
      addRow(w('等效额度','API quota'),q.calibrated&&q.totalUsd!=null?`~${fmtUsd(q.remUsd)} / ~${fmtUsd(q.totalUsd)}`:'—');
      if(q.useDelta){
        addRow(w('增量','Delta'),makePair(`~${fmtUsd(wd.delta.deltaCostUsd)}`,`${compact(wd.delta.deltaTokens)} (${full(wd.delta.deltaRequests)})`));
      }else{
        addRow(w('已消耗','Used'),wd?.windowRequests>0?makePair(`~${fmtUsd(wd.usedCostUsd)}`,`${compact(wd.usedTokens)} (${full(wd.windowRequests)})`):'—');
      }
      addRow(w('输入 / 缓存 / 输出','In / Cache / Out'),breakdown?`~${compact(breakdown.uncached)} / ~${compact(breakdown.cacheRead)} / ~${compact(breakdown.output)}`:'—');
      card.append(rows);
      $('est-windows').append(card);
    }

    text('est-sim-label',w('缓存命中','Cache hit'));
    const presetLabels={
      actual:w('实际','Actual'),
      group:w(`均值 ${(groupHit*100).toFixed(0)}%`,`Avg ${(groupHit*100).toFixed(0)}%`),
      p90:'90%',p50:'50%',p0:'0%',
    };
    for(const p of estPresetButtons){
      const label=presetLabels[p.id];
      if(p.button.textContent!==label)p.button.textContent=label;
      const active=p.pct!==undefined?(simMode==='custom'&&simCachePct===p.pct):simMode===p.id;
      p.button.setAttribute('aria-pressed',String(active));
    }
    const sliderDisplayPct=simMode==='custom'?simCachePct:Math.round((estBasis==='single'&&simMode==='actual'&&chosenModel?(chosenModel.cacheHitRate??groupHit):groupHit)*100);
    if(!estDragging&&estSlider.value!==String(sliderDisplayPct))estSlider.value=String(sliderDisplayPct);
    estSliderValue.textContent=sliderDisplayPct+'%';
    estSlider.setAttribute('aria-label',w('缓存命中率','Cache hit rate'));

    // Live Google pricing status bar & custom price editor
    const pMeta=est.pricingMeta;
    const statusParts=[];
    if(pMeta?.liveFetchedAt&&pMeta.liveModelCount>0){
      statusParts.push(w('Google 定价','Google pricing'),fmtStamp(pMeta.liveFetchedAt));
    }else{
      statusParts.push(w('内置定价','Built-in pricing'));
    }
    if(pMeta?.overrideCount>0)statusParts.push(w(`${pMeta.overrideCount} 自定义`,`${pMeta.overrideCount} custom`));
    if(estPricingMsg)statusParts.push(estPricingMsg);
    const pStatus=$('est-pricing-status');
    pStatus.className=estPricingErr?'est-pricing-msg err':'';
    setMeta(pStatus,statusParts);
    pStatus.title=pMeta?.liveModelCount>0?w(`已同步 ${pMeta.liveModelCount} 个模型`,`${pMeta.liveModelCount} models synced`):'';
    estFetchPricingBtn.hidden=!onPricing;
    estFetchPricingBtn.disabled=estPricingBusy;
    estFetchPricingBtn.textContent=estPricingBusy?w('同步中…','Syncing…'):w('同步定价','Sync pricing');
    estResetAllBtn.hidden=!onPricing||!(pMeta?.overrideCount>0);
    estResetAllBtn.disabled=estPricingBusy;
    estResetAllBtn.textContent=w('重置自定义','Reset custom');
    if(estEditingModel){
      const editEntry=group.models.find(m=>m.model===estEditingModel);
      if(editEntry)syncPriceEditor(editEntry);
      else closePriceEditor();
    }

    $('est-table-head').replaceChildren(...[w('模型','Model'),w('$/1M (入/缓/出)','$/1M (In/Cache/Out)'),w('缓存','Cache'),w('均价','Avg'),w('5h 剩余','5h left'),w('周剩余','Weekly left')].map(label=>node('th','',label)));
    $('est-table-body').replaceChildren();
    const q5=resolveWindowQuota(group.windows?.['5h']);
    const qw=resolveWindowQuota(group.windows?.weekly);
    const rem5hUsd=q5.calibrated?q5.remUsd:null;
    const remWUsd=qw.calibrated?qw.remUsd:null;
    for(const m of group.models){
      const row=node('tr','est-model-row'),nameCell=node('td',''),dot=node('span','dot');
      if(estBasis==='single'&&chosenModel?.model===m.model)row.dataset.selected='true';
      row.addEventListener('click',()=>{estSelectedModel=m.model;estBasis='single';renderEstimate();});
      dot.style.setProperty('--model-color',color(m.model));
      nameCell.append(dot,document.createTextNode(m.model));
      if(m.active)nameCell.append(node('span','est-active-tag',w('当前','Active')));
      const hit=simMode==='custom'?customHit:simMode==='group'?groupHit:(m.cacheHitRate??groupHit);
      const rate=simMode==='actual'?m.blendedCostPer1M:simulatedRate(m.pricing,m.shares,hit);
      const t5=rem5hUsd===0?0:(rem5hUsd!==null&&rate?Math.round((rem5hUsd/rate)*1e6):null);
      const tw=remWUsd===0?0:(remWUsd!==null&&rate?Math.round((remWUsd/rate)*1e6):null);
      const priceTd=node('td','');
      const priceWrap=node('span','est-price-cell');
      priceWrap.append(document.createTextNode(`$${m.pricing.input} / $${m.pricing.cacheRead} / $${m.pricing.output}`));
      if(m.pricing.source==='custom')priceWrap.append(node('span','est-src-tag custom',w('自定义','Custom')));
      else if(m.pricing.source==='live-google')priceWrap.append(node('span','est-src-tag live',w('实时','Live')));
      if(onPricing){
        const editBtn=node('button','est-edit-btn',w('编辑','Edit'));editBtn.type='button';
        editBtn.setAttribute('aria-label',w(`编辑 ${m.model} 定价`,`Edit ${m.model} pricing`));
        editBtn.addEventListener('click',event=>{event.stopPropagation();openPriceEditor(m);});
        priceWrap.append(editBtn);
      }
      priceTd.append(priceWrap);
      if(m.pricing.cacheWrite>0)priceTd.title=w(`缓存写 $${m.pricing.cacheWrite}/1M`,`Cache write: $${m.pricing.cacheWrite}/1M`);
      const c5=node('td','',t5===null?'—':t5===0?'0':'~'+compact(t5));if(t5!==null)c5.title=full(t5)+' Token';
      const cw=node('td','',tw===null?'—':tw===0?'0':'~'+compact(tw));if(tw!==null)cw.title=full(tw)+' Token';
      row.append(nameCell,priceTd,node('td','',(hit*100).toFixed(1)+'%'),node('td','',rate?`$${rate.toFixed(3)}/1M`:'—'),c5,cw);
      $('est-table-body').append(row);
    }
    text('est-note','');
  }
  function sinceLastResetMetric(data){
    const groups=data?.quotaEstimate?.groups||[];
    const pick=key=>groups.filter(g=>g?.windows?.[key]?.available&&typeof g.windows[key].usedTokens==='number');
    let key='weekly',active=pick('weekly');
    if(!active.length){key='5h';active=pick('5h');}
    if(!active.length)return {total:null,costUsd:null,stamp:null,title:''};
    const total=active.reduce((sum,g)=>sum+(g.windows[key].usedTokens||0),0);
    const hasCost=active.some(g=>typeof g.windows[key].usedCostUsd==='number');
    const costUsd=hasCost?active.reduce((sum,g)=>sum+(g.windows[key].usedCostUsd||0),0):null;
    const entries=active.map(g=>({name:groupShortName(g),startAt:g.windows[key].windowStartAt,ms:Date.parse(g.windows[key].windowStartAt||''),tokens:g.windows[key].usedTokens||0,cost:g.windows[key].usedCostUsd}));
    const valid=entries.filter(e=>Number.isFinite(e.ms)).sort((a,b)=>a.ms-b.ms);
    const earliest=valid[0]||entries[0];
    const stamp=earliest?.startAt?fmtStamp(earliest.startAt):null;
    const detail=entries.length===1
      ?(earliest?.startAt?fmtStamp(earliest.startAt):'')
      :entries.map(e=>`${e.name}${e.startAt?' ('+fmtStamp(e.startAt)+')':''}: ${compact(e.tokens)}${typeof e.cost==='number'?' ('+fmtCost(e.cost)+')':''}`).join('\n');
    const head=full(total)+' Token'+(costUsd!==null?' ('+fmtCost(costUsd)+')':'');
    return {total,costUsd,stamp,title:head+(detail?'\n'+detail:'')};
  }
  function render(){
    renderGuide();
    if(!value){
      closeYear(false);$('tip').hidden=true;$('overview').hidden=true;$('details').hidden=true;$('estimate').hidden=true;$('usage-waiting').hidden=false;
      text('usage-waiting',w('重新连接中…','Reconnecting…'));text('subtitle',w('重新连接中','Reconnecting'));text('coverage','');text('timezone','');$('alert').hidden=true;
      for(const metric of $('totals').children){metric.title='';metric.querySelector('.value')?.replaceChildren(node('span','','—'));metric.querySelector('.metric-sub')?.remove();}
      return;
    }
    $('usage-waiting').hidden=true;
    syncPalette();
    text('title',w('用量统计','Token usage'));text('subtitle',hostLabel);
    text('overview-tab',w('概览','Activity'));text('details-tab',w('详情','Details'));text('estimate-tab',w('额度测算','Estimate'));text('activity-title',w('Token 活动','Activity'));text('detail-title',w('按模型统计','By model'));
    text('locale-label',zh()?'EN':'中');for(const [id,label]of [['locale',w('切换到英文','Switch to Chinese')],['refresh',w('刷新','Refresh')],['close',w('关闭','Close')]]){$(id).setAttribute('aria-label',label);$(id).title=label;}text('less',w('少','Less'));text('more',w('多','More'));text('selection-details',w('详情 →','Details →'));
    for(const b of view.querySelectorAll('[data-heat]'))b.textContent=b.dataset.heat==='day'?w('天','Daily'):w('周','Weekly');
    for(const b of view.querySelectorAll('[data-period]'))b.textContent=({day:w('天','Day'),week:w('周','Week'),month:w('月','Month'),custom:w('自定义','Custom')})[b.dataset.period];
    $('overview-tab').setAttribute('aria-selected',String(tab==='overview'));$('details-tab').setAttribute('aria-selected',String(tab==='details'));$('estimate-tab').setAttribute('aria-selected',String(tab==='estimate'));
    $('overview').hidden=tab!=='overview';$('details').hidden=tab!=='details';$('estimate').hidden=tab!=='estimate';
    const sinceReset=sinceLastResetMetric(value);
    const cardTitle=(tok,cost)=>full(tok)+' Token'+(fmtCost(cost)?' ('+fmtCost(cost)+')':'');
    const totalCards=[
      {label:w('今日','Today'),total:value.todayTokens,costUsd:value.todayCostUsd,title:cardTitle(value.todayTokens,value.todayCostUsd)},
      {label:w('本周','This week'),total:value.weekTokens,costUsd:value.weekCostUsd,title:cardTitle(value.weekTokens,value.weekCostUsd)},
      {label:w('上次重置以来','Since last reset'),total:sinceReset.total,costUsd:sinceReset.costUsd,stamp:sinceReset.stamp,title:sinceReset.title},
      {label:w('本月','This month'),total:value.monthTokens,costUsd:value.monthCostUsd,title:cardTitle(value.monthTokens,value.monthCostUsd)},
      {label:w('累计','All time'),total:value.totalTokens,costUsd:value.totalCostUsd,title:cardTitle(value.totalTokens,value.totalCostUsd)},
    ];
    $('totals').replaceChildren();for(const item of totalCards){
      const metric=node('div','metric');
      const n=node('div','value',item.total===null?'—':compact(item.total));
      if(item.total!==null)n.append(node('span','unit','Token'));
      metric.append(node('label','',item.label),n);
      const costText=fmtCost(item.costUsd);
      if(costText||item.stamp){
        const sub=node('div','metric-sub');
        if(costText)sub.append(node('span','metric-cost',costText));
        if(costText&&item.stamp)sub.append(node('i','row-sep'));
        if(item.stamp)sub.append(node('span','',item.stamp));
        metric.append(sub);
      }
      metric.title=item.title;$('totals').append(metric);
    }
    const years=[];const first=Number(value.firstDate?.slice(0,4)||value.today.slice(0,4)),currentYear=Number(value.today.slice(0,4)),minimum=Math.max(first,currentYear-10);for(let y=currentYear;y>=minimum;y--)years.push(y);
    if($('year').dataset.years!==years.join(',')){
      $('year-menu').replaceChildren(...years.map(y=>{const option=node('button','year-option');option.type='button';option.dataset.year=String(y);option.setAttribute('role','option');option.tabIndex=-1;
        setMarkup(option,'<span></span><svg class="year-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>');option.firstElementChild.textContent=String(y);
        option.addEventListener('click',()=>{year=String(y);syncYear();closeYear();renderHeat();});return option;}));$('year').dataset.years=years.join(',');
    }
    syncYear();
    text('coverage',w(`${full(value.requests)} 次请求${value.firstDate?'（'+value.firstDate+' 起）':''}`,`${full(value.requests)} req${value.firstDate?' (since '+value.firstDate+')':''}`));
    text('timezone',value.timeZone+(value.syncing?w('（同步中…）',' (Syncing…)'):''));
    const alerts=[];if(value.unknownRequests)alerts.push(w(`${value.unknownRequests} 次无日期 (${compact(value.unknownTokens)})`,`${value.unknownRequests} undated (${compact(value.unknownTokens)})`));
    if(value.partialRequests||value.unreadableFiles||value.missingConversations||value.persistenceError)alerts.push(w('部分记录缺失','Partial records'));
    $('alert').hidden=!alerts.length;text('alert',alerts.join(w('；','; ')));
    if(tab==='overview')renderHeat();else if(tab==='details')renderChart();else renderEstimate();
  }
  function changeTab(next){closeYear(false);tab=next;$('tip').hidden=true;render();}
  $('overview-tab').addEventListener('click',()=>changeTab('overview'));$('details-tab').addEventListener('click',()=>changeTab('details'));$('estimate-tab').addEventListener('click',()=>changeTab('estimate'));
  for(const b of view.querySelectorAll('[data-heat]'))b.addEventListener('click',()=>{heatMode=b.dataset.heat;renderHeat();});
  for(const b of view.querySelectorAll('[data-period]'))b.addEventListener('click',()=>{period=b.dataset.period;if(period==='custom')ensureCustomRange();renderChart();});
  const onCustomDateChange=which=>{
    if(!value)return;
    const fromVal=customFromInput.value,toVal=customToInput.value;
    if(DATE_RE.test(fromVal))customFrom=fromVal;
    if(DATE_RE.test(toVal))customTo=toVal;
    if(customFrom>customTo){if(which==='from')customTo=customFrom;else customFrom=customTo;}
    ensureCustomRange();renderChart();
  };
  customFromInput.addEventListener('change',()=>onCustomDateChange('from'));
  customToInput.addEventListener('change',()=>onCustomDateChange('to'));
  for(const btn of $('custom-presets').children)btn.addEventListener('click',()=>{
    if(!value)return;const p=btn.dataset.preset;
    customTo=value.today;
    customFrom=p==='all'?(value.firstDate||value.today):clampMinDate(add(value.today,-(Number(p)-1)));
    ensureCustomRange();renderChart();
  });
  const startSliderDrag=()=>{estDragging=true;page.classList.add('dragging-slider');};
  const endSliderDrag=()=>{
    if(!estDragging)return;
    estDragging=false;page.classList.remove('dragging-slider');
    if(pendingDeferredRender&&!disposed&&dialog.open){pendingDeferredRender=false;render();}
  };
  estSlider.addEventListener('pointerdown',startSliderDrag);
  estSlider.addEventListener('mousedown',startSliderDrag);
  window.addEventListener('pointerup',endSliderDrag);
  window.addEventListener('pointercancel',endSliderDrag);
  window.addEventListener('mouseup',endSliderDrag);
  window.addEventListener('blur',endSliderDrag);
  estSlider.addEventListener('input',()=>{simMode='custom';simCachePct=Number(estSlider.value);renderEstimate();});
  function syncYear(){
    text('year-label',String(year));$('year').setAttribute('aria-label',w('选择年份 ','Select year ')+year);$('year-menu').setAttribute('aria-label',w('年份','Year'));
    for(const option of $('year-menu').children)option.setAttribute('aria-selected',String(option.dataset.year===String(year)));
  }
  function closeYear(restore=true){if(!$('year-menu').matches(':popover-open'))return;$('year-menu').hidePopover();$('year').setAttribute('aria-expanded','false');if(restore)$('year').focus({preventScroll:true});}
  function positionYear(){
    if(!$('year-menu').matches(':popover-open'))return;const menu=$('year-menu'),r=$('year').getBoundingClientRect(),bounds=dialog.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
    menu.style.left=Math.max(bounds.left+12,Math.min(r.right-width,bounds.right-width-12))+'px';const below=r.bottom+7;
    menu.style.top=(below+height<=bounds.bottom-12?below:Math.max(bounds.top+12,r.top-height-7))+'px';
  }
  function openYear(){
    $('tip').hidden=true;$('year-menu').showPopover();$('year').setAttribute('aria-expanded','true');positionYear();
    ($('year-menu').querySelector('[aria-selected=true]')||$('year-menu').firstElementChild)?.focus({preventScroll:true});
  }
  $('year').addEventListener('click',()=>{$('year-menu').matches(':popover-open')?closeYear():openYear();});
  $('year').addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();openYear();if(event.key==='Home')$('year-menu').firstElementChild?.focus();if(event.key==='End')$('year-menu').lastElementChild?.focus();}});
  $('year-menu').addEventListener('keydown',event=>{
    const options=[...$('year-menu').children],current=options.indexOf(view.activeElement);let next=null;
    if(event.key==='ArrowDown')next=Math.min(options.length-1,current+1);else if(event.key==='ArrowUp')next=Math.max(0,current-1);else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;
    if(next!==null){event.preventDefault();options[next]?.focus({preventScroll:true});}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeYear();}else if(event.key==='Tab')closeYear();
  });
  view.addEventListener('pointerdown',event=>{const path=event.composedPath();if(!path.includes($('year'))&&!path.includes($('year-menu')))closeYear(false);});
  page.addEventListener('scroll',closeYearOnScroll,{passive:true});function closeYearOnScroll(){closeYear(false);}
  window.addEventListener('resize',positionYear);
  $('heat').addEventListener('keydown',event=>{
    const buttons=[...$('heat').children],index=buttons.indexOf(event.target);if(index<0)return;
    const delta=heatMode==='day'?{ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}:{ArrowLeft:-1,ArrowRight:1,ArrowUp:-Math.ceil(buttons.length/2),ArrowDown:Math.ceil(buttons.length/2)};
    let next=event.key==='Home'?buttons.findIndex(b=>!b.disabled):event.key==='End'?buttons.findLastIndex(b=>!b.disabled):index+(delta[event.key]??NaN);
    if(!Number.isFinite(next)||next<0||next>=buttons.length||buttons[next].disabled)return;event.preventDefault();event.target.tabIndex=-1;buttons[next].tabIndex=0;buttons[next].focus();
  });
  $('selection-details').addEventListener('click',()=>{anchor=(selected?.from||value.today);period=heatMode;changeTab('details');});
  for(const [id,step]of [['previous',-1],['next',1]])$(id).addEventListener('click',()=>{
    if(period==='custom'){
      ensureCustomRange();
      const span=Math.max(1,Math.floor((Date.parse(customTo)-Date.parse(customFrom))/86400000)+1);
      if(step<0){customFrom=add(customFrom,-span);customTo=add(customTo,-span);}
      else{const nextTo=add(customTo,span);customTo=nextTo>value.today?value.today:nextTo;customFrom=add(customTo,-(span-1));}
      ensureCustomRange();
    }else{
      anchor=period==='day'?month(anchor,step):period==='week'?add(anchor,step*84):month(anchor,step*12);
    }
    renderChart();
  });
  $('locale').addEventListener('click',()=>void onLanguage(zh()?'en':'zh-CN'));
  $('refresh').addEventListener('click',async()=>{
    if(busy||disposed)return;busy=true;const button=$('refresh'),turn=600,started=performance.now();button.disabled=true;button.setAttribute('aria-busy','true');
    refreshMotion=button.querySelector('svg').animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:turn,iterations:Infinity});
    try{await onRefresh();}
    catch{if(!disposed){text('alert',w('暂时无法刷新，请稍后重试','Refresh unavailable. Try again shortly.'));$('alert').hidden=false;}}
    finally{
      // Fast requests still paint one whole turn. Slow requests finish their
      // current turn, so cancel never snaps a half-rotated icon back to zero.
      if(!disposed){const elapsed=performance.now()-started,remaining=Math.max(turn,Math.ceil(elapsed/turn)*turn)-elapsed;
        await new Promise(resolve=>{finishRefresh=resolve;refreshDelay=setTimeout(resolve,Math.max(0,remaining));});}
      clearTimeout(refreshDelay);refreshDelay=null;finishRefresh=null;refreshMotion?.cancel();refreshMotion=null;busy=false;
      if(!disposed){button.disabled=false;button.setAttribute('aria-busy','false');}
    }
  });
  function close(){endSliderDrag();closePriceEditor();closeYear(false);dialog.close();$('tip').hidden=true;opener?.focus({preventScroll:true});}
  $('close').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
  const contentKey=data=>JSON.stringify([{...data,updatedAt:undefined},language.language,themeSignature()]);
  // CSS surfaces update immediately; JS model colors must follow in the same
  // theme change, rather than waiting for the next metrics poll.
  const themeObserver=new MutationObserver(()=>{if(!disposed&&value&&dialog.open){const key=contentKey(value);if(key!==lastKey){lastKey=key;render();}}});
  if(root.host)themeObserver.observe(root.host,{attributes:true,attributeFilter:['data-pulse-theme','style']});
  return {open(data,trigger,initialTab=null){if(!data||disposed)return;accountKey=data.accountKey;value=data;opener=trigger;year||=data.today.slice(0,4);anchor||=data.today;if(initialTab&&['overview','details','estimate'].includes(initialTab))tab=initialTab;lastKey=contentKey(data);render();if(!dialog.open)dialog.showModal();},
    update(data){if(disposed)return;if(!data){if(!value)return;value=null;lastKey='';if(dialog.open){if(estDragging){pendingDeferredRender=true;return;}render();}return;}if(accountKey&&accountKey!==data.accountKey){selected=null;disabledModels.clear();expandedModels.clear();customFrom=null;customTo=null;estGroupId=null;estSelectedModel=null;year=data.today.slice(0,4);anchor=data.today;}accountKey=data.accountKey;value=data;if(!dialog.open)return;const key=contentKey(data);if(key===lastKey)return;lastKey=key;if(estDragging){pendingDeferredRender=true;return;}render();},
    restoreModal(){if(!disposed&&dialog.open&&dialog.isConnected&&!dialog.matches(':modal')){closeYear(false);dialog.close();dialog.showModal();}},
    close,syncGuideDismissed(){if(!replayGuide)dismissGuide();},dispose(){disposed=true;endSliderDrag();themeObserver.disconnect();clearTimeout(refreshDelay);finishRefresh?.();refreshMotion?.cancel();closeYear(false);window.removeEventListener('resize',positionYear);window.removeEventListener('pointerup',endSliderDrag);window.removeEventListener('pointercancel',endSliderDrag);window.removeEventListener('mouseup',endSliderDrag);window.removeEventListener('blur',endSliderDrag);dialog.close();dialog.remove();backdrop.remove();},get isOpen(){return dialog.open;}};
};
