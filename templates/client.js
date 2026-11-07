// Editable browser entry. Build with node scripts/build-client.mjs.
window.__ModuleLoader__.load({ id: "dsh-calendar-pro", factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        "use strict";
        const React = require("react");
        const W = createWorkbenchUI(React);
let calendarHostContext;
        const { useState, useEffect, useMemo, useRef, useCallback, useId } = React;
        const h = React.createElement;
        // Resolve against the Harness document base, including any reverse-proxy prefix.
        const ROUTE = "_dsh/dsh-calendar-pro/settings";
        const IMPORT_ROUTE = "api/dsh-calendar-pro/import";
        /** 三视图；order 决定 tab 顺序。 */
        const VIEWS = ["month", "week", "agenda"];
        const WEEKDAYS_ZH = ["一", "二", "三", "四", "五", "六", "日"];
        /** 上次用的视图：用户下次打开面板不该又跳回「月」。localStorage 不可用（隐私模式）就退回 default。 */
        const VIEW_STORAGE_KEY = "dsh-calendar-pro:view";
        function loadStoredView() {
            try {
                const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
                return VIEWS.indexOf(stored) === -1 ? "month" : stored;
            }
            catch (error) {
                return "month";
            }
        }
        function storeView(view) {
            try {
                window.localStorage.setItem(VIEW_STORAGE_KEY, view);
            }
            catch (error) { /* 写不进去就算了 */ }
        }
        /* @ui-css-start */
        const CSS = [
            ".dshc-root{color:var(--dsw-alias-label-primary,#111);font-size:13px;line-height:1.5}",
            // 面板可能出现在两个宽度差很大的容器里（对话页浮层 ~760px、设置页更窄）。
            // 用容器查询按「面板自己的宽度」适配：窄的时候藏掉时间前缀与重复的标题，
            // 让芯片至少能把日程标题露出来。
            ".dshc-shell{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:14px;padding:14px 16px 16px;container-type:inline-size}",
            "@container (max-width: 620px){.dshc-title{display:none}.dshc-chip .t{display:none}.dshc-toolbar{gap:6px}.dshc-monthhead{min-width:0}}",
            ".dshc-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}",
            ".dshc-title{font-size:15px;font-weight:600;margin:0}",
            ".dshc-sub{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px}",
            ".dshc-spacer{flex:1}",
            ".dshc-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border-radius:9px;padding:5px 11px;font-size:12px;cursor:pointer;transition:background .12s,border-color .12s}",
            ".dshc-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary,#111) 6%,transparent)}",
            ".dshc-btn:disabled{opacity:.5;cursor:not-allowed}",
            ".dshc-btn.primary{background:var(--dsw-alias-button-primary-fill,#2563eb);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}",
            ".dshc-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#1d4ed8)}",
            ".dshc-btn.danger{color:var(--dsw-alias-state-error-primary,#dc2626);border-color:var(--dsw-alias-state-error-primary,#dc2626)}",
            ".dshc-btn.ghost{border-color:transparent;background:transparent}",
            ".dshc-tabs{display:inline-flex;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));border-radius:10px;padding:2px;gap:2px}",
            ".dshc-tab{border:0;background:transparent;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-tertiary,#6b7280)}",
            ".dshc-tab.on{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-elevation-prominent,0 1px 2px rgba(0,0,0,.12))}",
            ".dshc-monthhead{text-align:center;font-size:13px;font-weight:600;min-width:104px}",
            ".dshc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}",
            ".dshc-dow{text-align:center;font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);padding:2px 0 4px}",
            ".dshc-cell{display:block;width:100%;min-height:88px;position:relative;box-sizing:border-box;border-radius:10px;padding:5px 5px 6px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));border:1px solid transparent;cursor:pointer;text-align:left;font:inherit;color:inherit;transition:background .12s,border-color .12s;overflow:hidden}",
            ".dshc-cell:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#111) 7%,transparent)}",
            ".dshc-cell.out{opacity:.45}",
            ".dshc-cell.today{border-color:var(--dsw-alias-state-business-primary,#2563eb)}",
            ".dshc-daynum{font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);margin:0 0 3px;display:flex;align-items:center;justify-content:space-between;gap:4px}",
            // 农历副文本与「休 / 班」角标：副文本挤在日号行里，不额外占高度（月视图行高实测算过）。
            // 日号 + 角标成一组靠左、农历靠右，避免角标绝对定位压住农历。
            ".dshc-daylead{position:relative;display:inline-flex;align-items:center;gap:4px;min-width:0;flex:0 0 auto}",
            ".dshc-lunar{font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary,#9ca3af);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:62%;font-weight:400;flex:0 1 auto}",
            // 周表头 / 议程日期行里，农历与「今天」是并排的同类文本，字号必须一致。
            ".dshc-dayhead .dshc-lunar{font-size:11px;line-height:inherit;color:inherit;max-width:none}",
            ".dshc-daylabel .dshc-lunar{font-size:12px;line-height:inherit;color:var(--dsw-alias-label-tertiary,#9ca3af);max-width:none}",
            ".dshc-lunar.festival{color:var(--dsw-alias-state-business-primary,#2563eb);font-weight:600}",
            ".dshc-hbadge{position:absolute;top:2px;right:3px;z-index:1;box-sizing:border-box;min-width:14px;height:14px;line-height:14px;text-align:center;border-radius:3px;font-size:10px;font-weight:600}",
            ".dshc-hbadge.off{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 14%,transparent);color:var(--dsw-alias-state-error-primary,#dc2626)}",
            ".dshc-hbadge.work{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 20%,transparent);color:var(--dsw-alias-state-warn-primary,#b45309)}",
            // 角标一律走行内：月视图不能压住农历，议程的 sticky 行也不能压住「新建」按钮。
            ".dshc-hbadge.dshc-inline{position:static;display:inline-block;vertical-align:middle;flex:0 0 auto}",
            ".dshc-cell.today .dshc-daynum b{background:var(--dsw-alias-state-business-primary,#2563eb);color:var(--dsw-alias-label-primary-foreground,#fff);border-radius:999px;padding:0 6px}",
            ".dshc-cell.today .dshc-daynum b{font-weight:600}",
            ".dshc-chip{display:block;width:100%;text-align:left;border:0;border-left:3px solid var(--dsw-alias-state-business-primary,#2563eb);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border-radius:7px;padding:3px 6px;margin-bottom:3px;font-size:12px;line-height:1.35;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
            ".dshc-chip:hover{background:var(--dsw-alias-button-elevated-fill,rgba(0,0,0,.06))}",
            ".dshc-chip.allday{border-left-color:var(--dsw-alias-state-success-primary,#16a34a)}",
            ".dshc-chip.recurring{border-left-color:var(--dsw-alias-state-warn-primary,#f59e0b)}",
            ".dshc-chip .t{color:var(--dsw-alias-label-tertiary,#9ca3af);margin-right:4px}",
            ".dshc-more{font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);padding-left:3px}",
            // 周视图不再铺满 24 小时：时间轴高度由 --timeline-h 给定（JS 按窗口实测算出），
            // 列内定时段线性映射，所以「一天多长」由日程决定，不由小时数决定。
            ".dshc-view{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}",
            ".dshc-week{display:grid;grid-template-columns:44px repeat(7,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:0;min-width:0;max-height:520px;overflow:auto}",
            ".dshc-weekcol{display:flex;flex-direction:column;min-width:0;min-height:0}",
            ".dshc-hourrail{position:relative;flex:0 0 auto;height:var(--timeline-h,320px);overflow:hidden;border-right:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.07))}",
            ".dshc-hourlabel{position:absolute;right:5px;font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary,#9ca3af);font-variant-numeric:tabular-nums;white-space:nowrap}",
            ".dshc-daycol{position:relative;flex:0 0 auto;height:var(--timeline-h,320px);overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.07))}",
            ".dshc-daycol.today{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 6%,transparent)}",
            ".dshc-dayhead{position:relative;flex:0 0 26px;height:26px;line-height:26px;overflow:hidden;white-space:nowrap;text-align:center;font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);background:var(--dsw-alias-bg-layer-1,#fff);display:flex;align-items:center;justify-content:center;gap:4px}",
            ".dshc-dayhead b{color:var(--dsw-alias-label-primary,#111);font-weight:600;font-size:13px}",
            ".dshc-allday{display:flex;flex-wrap:wrap;gap:4px;padding:0 0 6px;max-height:56px;overflow:hidden}",
            ".dshc-allday-pill{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;border-left:3px solid var(--dsw-alias-state-success-primary,#16a34a);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04));color:inherit;border-radius:6px;padding:2px 7px;font-size:11px;line-height:1.5;cursor:pointer}",
            ".dshc-allday-pill.recurring{border-left-color:var(--dsw-alias-state-warn-primary,#f59e0b)}",
            ".dshc-allday-more{font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);padding:2px}",
            ".dshc-slot{position:absolute;left:2px;right:2px;border-radius:7px;padding:3px 5px;font-size:11px;line-height:1.3;overflow:hidden;cursor:grab;background:var(--dsw-alias-state-business-primary,#2563eb);color:var(--dsw-alias-label-primary-foreground,#fff);border:0;text-align:left;touch-action:none;user-select:none}",
            ".dshc-slot:active{cursor:grabbing}",
            ".dshc-slot.dragging{opacity:.35}",
            ".dshc-slot-title{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
            ".dshc-slot-time{opacity:.78;white-space:nowrap}",
            ".dshc-resize{position:absolute;left:0;right:0;bottom:0;height:6px;cursor:ns-resize;border-bottom-left-radius:7px;border-bottom-right-radius:7px}",
            ".dshc-resize:hover{background:rgba(255,255,255,.35)}",
            ".dshc-ghost{background:transparent !important;border:1px dashed var(--dsw-alias-state-business-primary,#2563eb);color:var(--dsw-alias-label-primary,#111);z-index:3;pointer-events:none;display:flex;flex-direction:column;justify-content:center}",
            ".dshc-ghost.conflict{border-color:var(--dsw-alias-state-warn-primary,#f59e0b);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 18%,transparent) !important}",
            ".dshc-undo{display:flex;align-items:center;gap:10px;background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-label-primary-foreground,#fff);border-radius:10px;padding:8px 12px;font-size:12px;margin-bottom:10px}",
            ".dshc-undo-btn{border:1px solid currentColor;background:transparent;color:inherit;border-radius:7px;padding:2px 8px;font-size:12px;cursor:pointer}",
            ".dshc-slot.allday{background:var(--dsw-alias-state-success-primary,#16a34a)}",
            ".dshc-slot.recurring{background:var(--dsw-alias-state-warn-primary,#f59e0b);color:#1f2937}",
            ".dshc-agenda{display:flex;flex-direction:column;gap:14px;max-height:560px;overflow:auto;padding-right:4px}",
            ".dshc-daygroup{display:flex;flex-direction:column;gap:6px}",
            ".dshc-daylabel{display:flex;align-items:baseline;gap:8px;position:sticky;top:0;background:var(--dsw-alias-bg-layer-1,#fff);padding:2px 0}",
            ".dshc-daylabel b{font-size:13px}",
            ".dshc-row{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));cursor:pointer;border-left:3px solid var(--dsw-alias-state-business-primary,#2563eb)}",
            ".dshc-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#111) 7%,transparent)}",
            ".dshc-row.allday{border-left-color:var(--dsw-alias-state-success-primary,#16a34a)}",
            ".dshc-row.recurring{border-left-color:var(--dsw-alias-state-warn-primary,#f59e0b)}",
            ".dshc-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#6b7280);min-width:96px;font-size:12px;padding-top:1px}",
            ".dshc-main{flex:1;min-width:0}",
            ".dshc-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
            ".dshc-meta{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
            ".dshc-tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#111) 7%,transparent);color:var(--dsw-alias-label-tertiary,#6b7280);margin-left:6px}",
            ".dshc-empty{padding:26px 18px;text-align:center;color:var(--dsw-alias-label-tertiary,#6b7280);flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center}",
            ".dshc-empty h3{color:var(--dsw-alias-label-primary,#111);margin:0 0 6px;font-size:14px}",
            ".dshc-empty code{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));padding:1px 5px;border-radius:5px;font-size:12px}",
            ".dshc-alert{display:flex;gap:8px;align-items:flex-start;border-radius:10px;padding:8px 10px;font-size:12px;margin-bottom:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#111) 5%,transparent)}",
            ".dshc-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 12%,transparent);color:var(--dsw-alias-state-error-primary,#dc2626)}",
            ".dshc-alert.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 16%,transparent)}",
            ".dshc-alert.ok{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 12%,transparent)}",
            // 加载态也要吃掉剩余高度：否则页脚会先跳到 240px 下面、数据回来又落到底部。
            ".dshc-loading{min-height:240px;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;letter-spacing:.03em}",
            ".dshc-loading-orbit{position:relative;width:42px;height:42px;animation:dshc-orbit 1.6s linear infinite}",
            ".dshc-loading-orbit i{position:absolute;top:50%;left:50%;width:8px;height:8px;margin:-4px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#2563eb)}",
            ".dshc-loading-orbit i:nth-child(1){transform:rotate(0deg) translateY(-15px);opacity:.9}",
            ".dshc-loading-orbit i:nth-child(2){transform:rotate(120deg) translateY(-15px);opacity:.55}",
            ".dshc-loading-orbit i:nth-child(3){transform:rotate(240deg) translateY(-15px);opacity:.3}",
            "@keyframes dshc-orbit{to{transform:rotate(360deg)}}",
            ".dshc-refresh{position:relative;height:0;z-index:2;pointer-events:none}",
            ".dshc-refresh span{position:absolute;left:0;top:0;display:block;height:2px;width:35%;border-radius:2px;background:var(--dsw-alias-state-business-primary,#2563eb);opacity:.7;animation:dshc-refresh-slide 1.2s ease-in-out infinite}",
            "@keyframes dshc-refresh-slide{0%{transform:translateX(-110%)}100%{transform:translateX(390%)}}",
            "@media(prefers-reduced-motion:reduce){.dshc-loading-orbit{animation-duration:4s}.dshc-refresh span{animation:none;width:100%;opacity:.35}}",
            ".dshc-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.42));display:flex;justify-content:flex-end;z-index:60}",
            ".dshc-drawer{width:min(420px,92vw);height:100%;background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));padding:18px;overflow:auto;box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.2))}",
            ".dshc-modalwrap{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.42));display:flex;align-items:center;justify-content:center;z-index:70;padding:20px}",
            ".dshc-modal{width:min(460px,94vw);max-height:88vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);border-radius:14px;padding:18px;box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.25))}",
            ".dshc-field{margin-bottom:9px}",
            ".dshc-field label{display:block;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);margin-bottom:4px}",
            ".dshc-input,select.dshc-input,textarea.dshc-input{width:100%;box-sizing:border-box;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06)));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.38));border-radius:9px;padding:7px 9px;font:inherit;color:inherit}",
            "select.dshc-input{appearance:auto;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.38));background-color:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06)));padding-right:26px;cursor:pointer}",
            ".dshc-input:focus,select.dshc-input:focus,textarea.dshc-input:focus{outline:none;border-color:var(--dsw-alias-state-focus-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-focus-primary,#3b82f6) 22%,transparent)}",
            "textarea.dshc-input{min-height:72px;resize:vertical}",
            ".dshc-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
            ".dshc-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-primary,#111)}",
            ".dshc-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}",
            ".dshc-kv{display:grid;grid-template-columns:72px 1fr;gap:6px 10px;font-size:12px;margin:12px 0 0}",
            ".dshc-kv dt{color:var(--dsw-alias-label-tertiary,#6b7280)}",
            ".dshc-kv dd{margin:0;word-break:break-all}",
            ".dshc-drawertitle{font-size:16px;font-weight:600;margin:0 0 4px}",
            ".dshc-mono{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);word-break:break-all}",
            ".dshc-close{position:absolute;top:10px;right:12px}",
            // 统计 / 来源 / 拖拽提示固定在最下面一行，不随加载或切视图上下移动。
            ".dshc-footer{margin-top:12px;flex:0 0 auto;min-height:16px;display:flex;align-items:center;gap:8px;justify-content:space-between;color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:11px}",
            // 页脚左侧的提示（周视图拖拽改期）：推到最左，剩下的统计与账号自然靠右。
            ".dshc-footer-hint{margin-right:auto;text-align:left;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
            // 设置页：经期记录 + ICS 导入（页脚由构建脚本追加在这两块之后）。
            ".dshc-subtitle{margin:14px 0 2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#4b5563)}",
            ".dshc-export{margin-top:16px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));display:flex;flex-direction:column;gap:8px;align-items:flex-start}",
            ".dshc-export h4{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#4b5563)}",
            ".dshc-export .dshc-sub{margin:0}",
            ".dshc-source{margin:0;padding:18px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff)}",
            ".dshc-source h3{margin:0 0 8px;font-size:15px;font-weight:600}",
            ".dshc-source-current{margin:0;font-size:13px;font-weight:500}",
            ".dshc-source-done{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-success-primary,#16a34a)}",
            // 首启页：两选一，卡片本身是按钮。
            ".dshc-start{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:240px;flex:1;padding:24px 18px;text-align:center}",
            ".dshc-start h3{margin:0;font-size:16px;font-weight:600}",
            ".dshc-start-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;width:100%;max-width:520px}",
            ".dshc-start-card{display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;padding:14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.38));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;cursor:pointer;font:inherit}",
            ".dshc-start-card:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary,#2563eb);background:var(--dsw-alias-button-elevated-fill,rgba(0,0,0,.04))}",
            ".dshc-start-card:disabled{opacity:.6;cursor:default}",
            ".dshc-start-card strong{font-size:13px;font-weight:600}",
            ".dshc-start-error{margin:0;max-width:520px;font-size:12px;line-height:1.6;text-align:left;color:var(--dsw-alias-state-error-primary,#dc2626)}.dshc-start-note{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#6b7280);max-width:520px}",
            // 设置页外层 W.Page 会渲染成 .dshw.w-page.calendar-settings，而 .dshw 自带
            // `background:var(--w-bg)`（= layer-1）。深色下它比宿主设置页底色更深 ——
            // 只改内部卡片没用，必须把这个根节点也改成继承页面。侧栏页不带 calendar-settings，不受影响。
            ".calendar-settings.dshw,.calendar-settings{background:transparent}",
            ".calendar-settings .w-body{background:transparent}",
            ".dshc-settings{display:flex;flex-direction:column;gap:18px;max-width:760px;min-width:0;padding-bottom:18px}",
            // 设置页的三块卡片不铺底色：深色模式下 --dsw-alias-bg-layer-1 比宿主设置页底色更深，
            // 硬写背景会出现「插件区域明显发暗」的方块。只保留描边，底色完全继承页面。
            ".dshc-settings .dshc-source,.dshc-settings .dshc-cycle,.dshc-settings .dshc-import{background:transparent}",
            ".dshc-cycle{margin:0;padding:18px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:12px;min-width:0;background:var(--dsw-alias-bg-layer-1,#fff)}",
            ".dshc-cycle h3{margin:0 0 8px;font-size:15px;font-weight:600}",
            ".dshc-cycle-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px 14px;margin:12px 0 10px}",
            ".dshc-settings .dshc-import{margin:0}",
            // ICS 文件选择：原生 input[type=file] 的「浏览…/未选择文件」跟随浏览器语言，
            // 中文界面下会冒出英文，所以藏起原生控件、自己画按钮与文件名。
            ".dshc-file{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 10px}",
            ".dshc-file-name{font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
            ".dshc-file-native{display:none}",
            // 预计经期：日期下一条粉红短线，不占行高（月视图行高实测常数不变）。
            ".dshc-period-mark{display:block;position:absolute;left:0;bottom:-3px;width:16px;height:2px;border-radius:2px;background:var(--dshc-period-color,#ec4899);pointer-events:none}.dshc-period-tip{display:none;position:absolute;top:2px;right:2px;z-index:6;padding:1px 5px;border-radius:4px;font-size:10px;line-height:16px;white-space:nowrap;pointer-events:none;color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-label-primary,#111)}.dshc-cell:hover .dshc-period-tip,.dshc-cell:focus-visible .dshc-period-tip{display:block}",,
            ".dshc-dayhead .dshc-period-mark{left:50%;transform:translateX(-50%);bottom:1px;width:20px}",
            "@media(prefers-color-scheme:dark){.dshc-root{--dshc-period-color:#f472b6}}"
        ].join("");
        /* @ui-css-end */
        const UI = {
            zh: {
                "nav.title": "日历",
                "section.title": "日历",
                "section.intro": "在设置页直接查看和编辑 CalDAV 上的日程：月/周/议程三种视图，点一下就能改时间、换标题、加重复规则。",
                "view.month": "月", "view.week": "周", "view.agenda": "议程",
                "action.today": "今天", "action.prev": "上", "action.next": "下", "action.new": "新建日程",
                "action.refresh": "刷新", "action.retry": "重试", "action.edit": "编辑", "action.delete": "删除",
                "action.save": "保存", "action.cancel": "取消", "action.confirmDelete": "确认删除",
                "action.open": "打开", "action.copy": "复制 uid", "action.copied": "已复制",
                "state.loading": "正在读取日历…", "state.refreshing": "正在更新日程…", "state.empty": "这段时间没有日程。",
                "state.notConfigured": "还没配置 CalDAV 账号",
                "state.notConfiguredHint": "点击“连接设置”，选择日历服务并填写账号信息，测试连接后保存即可。也可以先查看示例，了解日历的用法。",
                "panel.compactHint": "日历还没设置好。到侧栏的「日历」里完成配置。",
                "state.readonly": "只读",
                "field.summary": "标题", "field.date": "日期", "field.start": "开始", "field.end": "结束",
                "field.allDay": "全天", "field.location": "地点", "field.description": "备注",
                "field.repeat": "重复", "field.uid": "事件 uid", "field.when": "时间", "field.duration": "时长",
                "repeat.none": "不重复", "repeat.daily": "每天", "repeat.weekly": "每周", "repeat.monthly": "每月", "repeat.yearly": "每年", "repeat.custom": "自定义 RRULE",
                "repeat.weeklyEvery": "每周（{n} 次）", "repeat.recurring": "重复", "repeat.occurrence": "系列中的一次",
                "conflict.title": "这个时段已有 {n} 个日程，会重叠：", "conflict.hint": "仍然保存？",
                "error.title": "操作失败", "error.load": "读取日历失败",
                "confirm.delete": "删除「{name}」？这个操作会同步到你的日历服务器。",
                "confirm.deleteSeries": "将删除「{name}」整个重复系列的所有场次，包含当前视图外的场次。无法撤销。",
                "form.series": "正在编辑整个重复系列，所有场次都会受影响。含取消或单独改期场次时，请到原日历客户端调整时间和规则。",
                "form.newTitle": "新建日程", "form.editTitle": "编辑日程",
                "form.required": "标题和时间都要填。",
                "day.today": "今天", "day.tomorrow": "明天", "day.yesterday": "昨天",
                "count.events": "{n} 个日程", "count.occurrences": "含 {n} 次重复展开",
                "format.duration.hm": "{h} 小时 {m} 分", "format.duration.h": "{h} 小时", "format.duration.m": "{m} 分钟", "format.duration.zero": "0 分钟",
                "format.allday": "全天",
                "drag.hint": "提示：周视图里可以直接拖动日程改期",
                "drag.drop": "松手即改到这里",
                "drag.conflict": "与 {n} 个日程重叠",
                "drag.keep": "仍可松手",
                "drag.moveTitle": "可拖动改期",
                "drag.resizeTitle": "拖动改时长",
                "move.recurringUnsupported": "重复日程暂不支持拖动改期：请在详情里用「编辑」（拖动会重锚系列起点，早于该次的实例会消失）。",
                "move.tooLong": "超过 24 小时的日程暂不支持拖动改期。",
                "move.saved": "已改期",
                "move.undo": "撤销",
                "move.failed": "改期失败：{message}",
                "conn.button": "连接设置",
                "conn.title": "CalDAV 连接设置",
                "conn.intro": "先测试连接，通过后再保存。",
                "conn.provider": "服务商",
                "provider.custom": "自建 CalDAV",
                "conn.caldavUrl": "日历集合 URL",
                "conn.username": "账号",
                "conn.password": "密码 / 应用专用密码",
                "conn.host": "服务器地址",
                "conn.user": "用户名",
                "conn.calendar": "日历名（如 personal）",
                "conn.calendarId": "日历 ID（通常是你的邮箱）",
                "conn.clientId": "clientId",
                "conn.clientSecret": "clientSecret",
                "conn.refreshToken": "refreshToken",
                "conn.tokenUrl": "令牌地址（可留空）",
                "conn.proxyUrl": "代理地址（可留空）",
                "conn.keep": "已配置，留空不改",
                "conn.test": "测试连接",
                "conn.testing": "正在连接…",
                "conn.save": "保存并启用",
                "conn.saving": "保存中…",
                "conn.ok": "连接成功：未来 30 天读到 {n} 个日程",
                "conn.okSample": "（例如：{sample}）",
                "conn.fail": "连接失败",
                "conn.savedToast": "连接已保存，工具下一次调用就用它",
                "conn.noSettings": "当前无法保存连接设置。请检查 DSH 与日历插件是否已更新，再重新打开此页面。",
                "conn.storageFallback": "连接信息保存在运行 DSH 的设备上，保存后立即生效。",
                "conn.needProvider": "先选一个服务商",
                "conn.current": "当前：{summary}",
                "conn.discover": "自动发现日历", "conn.discovering": "正在查找…",
                "conn.discoverHint": "填好账号和 App 专用密码后点这里，会列出你的日历",
                "conn.discoverStale": "服务端还是旧版本：请完全退出 DSH 后重新打开，再点一次",
                "conn.discoverFound": "已找到 {n} 本日历：「日历集合 URL」已填好第一本，点开可切换",
                "conn.manualUrl": "改为手动填写",
                "conn.steps": "怎么拿到这些值？（点开看步骤）",
                "link.googleConsole": "打开 Google Cloud 凭据页 ↗",
                "link.googlePlayground": "打开 OAuth Playground ↗",
                "link.appleId": "打开 Apple ID 设置 ↗",
                "hint.calendarId.google": "通常就是你的 Gmail 地址",
                "hint.clientId.google": "类型选「桌面应用」",
                "hint.refreshToken.google": "用下面的步骤换取，长期有效",
                "hint.tokenUrl": "留空即用 Google 默认地址",
                "hint.caldavUrl.icloud": "网页设置里没有，需通过 CalDAV 发现获取",
                "hint.username.icloud": "你的 Apple ID 邮箱",
                "hint.password.icloud": "App 专用密码，不是登录密码",
                "hint.host.nextcloud": "含 https://，结尾不要带 /",
                "hint.user.nextcloud": "通常与登录名相同",
                "hint.username.nextcloud": "用于认证的账号名；与上一栏不同时才需要分别填",
                "hint.calendar.nextcloud": "日历名，个人日历默认是 personal",
                "hint.caldavUrl.custom": "结尾的 / 不能丢",
                "hint.username.custom": "登录账号 / 邮箱",
                "steps.google": ["Google Cloud 控制台新建项目，启用 Google Calendar API", "创建 OAuth 客户端 ID，类型选「桌面应用」，拿到 clientId 与 clientSecret", "在 OAuth Playground 勾选 Use your own OAuth credentials 并填上面两项，授权 calendar 权限，换 refreshToken", "日历 ID 一般就是 Gmail 地址，填完点「测试连接」"],
                "steps.icloud": ["appleid.apple.com → 登录与安全 → App 专用密码，生成一个", "账号填 Apple ID 邮箱，密码填刚生成的专用密码", "在下面的「自动发现日历」里选一本；手动方法见使用手册"],
                "steps.nextcloud": ["服务器地址填 https://你的域名，结尾不要带 /", "用户名与日历名：个人日历默认是 personal", "密码用 App 密码或登录密码"],
                "steps.custom": ["填完整的日历集合 URL，形如 https://cloud.example.com/remote.php/dav/calendars/用户名/日历名/", "填账号与密码，点「测试连接」"],
                "conn.googleHint": "Google 只接受 OAuth，不接受应用专用密码。",
                "conn.icloudHint": "iCloud 必须用 App 专用密码。",
                "conn.nextcloudHint": "填服务器地址、用户名和日历名即可。",
                "conn.customHint": "填完整的日历集合 URL，结尾的 / 不能丢。"
            },
            en: {
                "nav.title": "Calendar",
                "section.title": "Calendar",
                "section.intro": "View and edit your CalDAV calendar right here: month, week and agenda views; click any event to retitle it, move it, or add a recurrence rule.",
                "view.month": "Month", "view.week": "Week", "view.agenda": "Agenda",
                "action.today": "Today", "action.prev": "Prev", "action.next": "Next", "action.new": "New event",
                "action.refresh": "Refresh", "action.retry": "Retry", "action.edit": "Edit", "action.delete": "Delete",
                "action.save": "Save", "action.cancel": "Cancel", "action.confirmDelete": "Delete anyway",
                "action.open": "Open", "action.copy": "Copy uid", "action.copied": "Copied",
                "state.loading": "Loading your calendar…", "state.refreshing": "Refreshing events…", "state.empty": "Nothing scheduled in this range.",
                "state.notConfigured": "No CalDAV account configured yet",
                "panel.compactHint": "Calendar is not set up yet. Finish setup in the sidebar calendar.",
                "state.notConfiguredHint": "Open Connection settings, choose your calendar service and enter your account details, then test and save the connection. You can also explore the sample calendar first.",
                "state.readonly": "read-only",
                "field.summary": "Title", "field.date": "Date", "field.start": "Start", "field.end": "End",
                "field.allDay": "All day", "field.location": "Location", "field.description": "Notes",
                "field.repeat": "Repeats", "field.uid": "Event uid", "field.when": "When", "field.duration": "Duration",
                "repeat.none": "Does not repeat", "repeat.daily": "Daily", "repeat.weekly": "Weekly", "repeat.monthly": "Monthly", "repeat.yearly": "Yearly", "repeat.custom": "Custom RRULE",
                "repeat.weeklyEvery": "Weekly ({n} times)", "repeat.recurring": "Recurring", "repeat.occurrence": "One occurrence of a series",
                "conflict.title": "This slot already has {n} event(s); they overlap:", "conflict.hint": "Save anyway?",
                "error.title": "Something failed", "error.load": "Could not load the calendar",
                "confirm.delete": "Delete「{name}」? This is pushed to your calendar server.",
                "confirm.deleteSeries": "Delete every occurrence of {name}, including dates outside this view? This cannot be undone.",
                "form.series": "Editing the entire recurring series. All occurrences are affected. If it has cancelled or rescheduled occurrences, change times and rules in your original calendar app.",
                "form.newTitle": "New event", "form.editTitle": "Edit event",
                "form.required": "A title and a time range are required.",
                "day.today": "Today", "day.tomorrow": "Tomorrow", "day.yesterday": "Yesterday",
                "count.events": "{n} events", "count.occurrences": "{n} expanded occurrences",
                "format.duration.hm": "{h}h {m}m", "format.duration.h": "{h}h", "format.duration.m": "{m}m", "format.duration.zero": "0m",
                "format.allday": "All day",
                "drag.hint": "Tip: drag events in the week view to reschedule.",
                "drag.drop": "release to drop here",
                "drag.conflict": "overlaps {n} event(s)",
                "drag.keep": "you can still drop it",
                "drag.moveTitle": "drag to reschedule",
                "drag.resizeTitle": "drag to resize",
                "move.recurringUnsupported": "Recurring events cannot be dragged yet — use Edit in the details drawer (dragging would re-anchor the series and drop earlier occurrences).",
                "move.tooLong": "Events longer than 24 hours cannot be dragged yet.",
                "move.saved": "Rescheduled",
                "move.undo": "Undo",
                "move.failed": "Could not reschedule: {message}",
                "conn.button": "Connection",
                "conn.title": "CalDAV connection",
                "conn.intro": "Test the connection first, then save.",
                "conn.provider": "Provider",
                "provider.custom": "Custom CalDAV",
                "conn.caldavUrl": "Calendar collection URL",
                "conn.username": "Account",
                "conn.password": "Password / app-specific password",
                "conn.host": "Server",
                "conn.user": "Username",
                "conn.calendar": "Calendar name (e.g. personal)",
                "conn.calendarId": "Calendar ID (usually your email)",
                "conn.clientId": "clientId",
                "conn.clientSecret": "clientSecret",
                "conn.refreshToken": "refreshToken",
                "conn.tokenUrl": "Token URL (optional)",
                "conn.proxyUrl": "Proxy URL (optional)",
                "conn.keep": "configured — leave blank to keep",
                "conn.test": "Test connection",
                "conn.testing": "Connecting…",
                "conn.save": "Save and enable",
                "conn.saving": "Saving…",
                "conn.ok": "Connected: {n} events in the next 30 days",
                "conn.okSample": " (e.g. {sample})",
                "conn.fail": "Connection failed",
                "conn.savedToast": "Saved — the tools pick it up on their next call",
                "conn.noSettings": "Connection settings cannot be saved right now. Check that DSH and the calendar plugin are up to date, then reopen this page.",
                "conn.storageFallback": "Connection details are stored on the device running DSH. Saved changes take effect immediately.",
                "conn.needProvider": "Pick a provider first",
                "conn.current": "Now: {summary}",
                "conn.discover": "Find my calendars", "conn.discovering": "Finding…",
                "conn.discoverHint": "Enter your account and app-specific password, then pick a calendar",
                "conn.discoverStale": "The server still runs an older build. Fully quit and reopen DSH, then try again.",
                "conn.discoverFound": "Found {n} calendars. The first is selected in Calendar collection URL; open the dropdown to switch.",
                "conn.manualUrl": "Enter URL manually",
                "conn.steps": "Where do these values come from?",
                "link.googleConsole": "Open Google Cloud credentials ↗",
                "link.googlePlayground": "Open OAuth Playground ↗",
                "link.appleId": "Open Apple ID settings ↗",
                "hint.calendarId.google": "usually your Gmail address",
                "hint.clientId.google": "Pick 'Desktop app'",
                "hint.refreshToken.google": "Exchange it once below; it lasts",
                "hint.tokenUrl": "leave empty to use Google's default",
                "hint.caldavUrl.icloud": "Not shown on icloud.com; get it via CalDAV discovery",
                "hint.username.icloud": "your Apple ID email",
                "hint.password.icloud": "App-specific password, not your login password",
                "hint.host.nextcloud": "include https:// and drop any trailing /",
                "hint.user.nextcloud": "Usually the same as your login",
                "hint.username.nextcloud": "the account used to authenticate; fill it separately only when it differs",
                "hint.calendar.nextcloud": "calendar name; the personal one is usually called personal",
                "hint.caldavUrl.custom": "Keep the trailing slash",
                "hint.username.custom": "login account / email",
                "steps.google": ["New project in Google Cloud console, enable Google Calendar API", "Create an OAuth client ID of type 'Desktop app'; copy clientId and clientSecret", "In OAuth Playground, tick 'Use your own OAuth credentials', authorize the calendar scope, exchange a refreshToken", "The calendar ID is usually your Gmail address; then hit Test connection"],
                "steps.icloud": ["appleid.apple.com → Sign-In and Security → App-Specific Passwords, create one", "Account: your Apple ID email. Password: the app-specific password", "Pick a calendar with Find my calendars below; the manual has manual commands"],
                "steps.nextcloud": ["Server: https://your-domain (no trailing slash)", "Username and calendar name; the default personal calendar is 'personal'", "Password: an app password or your login password"],
                "steps.custom": ["Paste the full collection URL, e.g. https://cloud.example.com/remote.php/dav/calendars/user/calendar/", "Fill in account and password, then Test connection"],
                "conn.googleHint": "Google only accepts OAuth, not app passwords.",
                "conn.icloudHint": "iCloud requires an app-specific password.",
                "conn.nextcloudHint": "Server, username and calendar name are enough.",
                "conn.customHint": "Paste the full collection URL; keep the trailing slash."
            }
        };
        var UI_LANG = "zh";
        var relocalize = null;
        var activeLocaleService = null;
        // Backend guidance is localized separately from event titles and source content.
        const BACKEND_EN = {
            '系列含已取消、额外或单独改期的场次，不能整体改开始时间、全天类型或重复规则；请在原日历客户端编辑，现有日程未改动。': 'This series has cancelled, extra or rescheduled occurrences. Change its start time, all-day type or recurrence rule in the original calendar app. No event was changed.',
            '这是整个重复系列。请先向用户说明影响，确认后显式传 scope="series"；当前不支持只改某一次。': 'This action changes the entire recurring series. Explain its impact, then use scope="series" after confirmation. Editing just one occurrence is unsupported.',
            '这是整个重复系列。请先向用户说明影响，确认后显式传 scope="series"；当前不支持只删某一次。': 'This action deletes the entire recurring series. Explain its impact, then use scope="series" after confirmation. Deleting just one occurrence is unsupported.',
            '找不到或无法解析日程，请刷日历后重试。': 'The event is missing or could not be parsed. Refresh the calendar and try again.',
            '无法解析原日程，更新已取消；请在原日历客户端检查。': 'The original event could not be parsed. No update was made. Check it in the original calendar app.',
            "日期格式不合法": "Invalid date format.",
            "日程包含不存在的日期或时间": "This event contains an invalid date or time.",
            "请先选择或粘贴 ICS 文件内容": "Choose an ICS file or paste its content first.",
            "ICS 文件超过 256 KiB，请分批导出": "The ICS file exceeds 256 KiB. Export smaller batches.",
            "ICS 结构不合法或嵌套过深": "The ICS structure is invalid or nested too deeply.",
            "ICS 文件不完整": "The ICS file is incomplete.",
            "无法读取 ICS，请从日历应用重新导出": "Could not read the ICS file. Export it again from your calendar app.",
            "暂不支持 PERIOD 类型的 RDATE，请改用日期列表后导入": "PERIOD RDATE values are unsupported. Export a list of dates instead.",
            "全天日期不能含 TZID": "All-day dates must not contain TZID.",
            "文件含未标注时区的时间，请选择解释时区后重新预览": "This file contains times without a timezone. Choose an interpretation timezone and preview again.",
            "UTC 时间不能同时标注 TZID": "UTC timestamps must not also contain TZID.",
            "原文件缺少 DTSTAMP，导入时补齐": "DTSTAMP is missing and will be added during import.",
            "作为私人日程复制，不导入参与者或发送邀请": "Imported as a private copy. Attendees are omitted and no invitations are sent.",
            "仅保留屏幕提醒，已移除其他提醒动作": "Only display reminders are retained; other alarm actions were removed.",
            "开始与结束必须同时为全天日期或具体时间": "Start and end must both be all-day dates or both be timestamps.",
            "日程或重复例外的结束时间早于开始时间": "The event or recurring exception ends before it starts.",
            "日程无法解析": "Could not parse this event.",
            "结束时间早于开始时间": "End time precedes start time.",
            "重复规则 UNTIL 需要 UTC 时间，请重新导出": "The recurrence UNTIL must use UTC. Export the event again.",
            "日程格式不合法": "Invalid event format.",
            "日历连接已改变，请重新预览": "The calendar connection changed. Preview again.",
            "请先核对预览，再确认导入": "Review the preview before confirming import.",
            "预览已过期或插件已重启，请重新预览": "The preview expired or the plugin restarted. Preview again.",
            "每次请选择 1–20 个日程系列，其余可分批导入": "Select 1–20 event series per batch.",
            "选择包含不可导入的日程，请重新预览": "Some selected events cannot be imported. Preview again.",
            "另一批日程正在导入，请稍后重试": "Another batch is importing. Try again after it finishes.",
            "不支持此导入操作": "Unsupported import operation.",
            "请求必须是对象": "The request must be an object."
        };
        function backendMessage(error) {
            const message = typeof error === 'string' ? error : error?.message || String(error || '');
            if (UI_LANG !== 'en')
                return message;
            if (error?.status === 401)
                return 'Your DSH session expired. Reopen DSH and try again.';
            if (BACKEND_EN[message])
                return BACKEND_EN[message];
            if (!/[\u3400-\u9fff]/.test(message))
                return message;
            const timezone = message.match(/^(文件重复定义时区|时区定义不完整|时区规则的 DTSTART 必须是本地时间|时区偏移不合法|缺少时区定义)：(.+)$/);
            if (timezone)
                return ({ '文件重复定义时区': 'Duplicate timezone definition', '时区定义不完整': 'Incomplete timezone definition', '时区规则的 DTSTART 必须是本地时间': 'Timezone DTSTART must use local time', '时区偏移不合法': 'Invalid timezone offset', '缺少时区定义': 'Missing timezone definition' })[timezone[1]] + ': ' + timezone[2];
            const floating = message.match(/^原文件未标注时区，按 (.+) 解释$/);
            if (floating)
                return 'No timezone in the source; interpreted as ' + floating[1] + '.';
            if (/OAuth|Google|凭据|未配置|尚未配置|没有配置|连接设置/.test(message))
                return 'Calendar credentials are incomplete. Open Connection settings and configure the calendar account; the DSH model API key cannot be used here.';
            if (/时区/.test(message))
                return 'Invalid or missing timezone. Choose an interpretation timezone or export a file with VTIMEZONE.';
            if (/VCALENDAR|VERSION|VEVENT/.test(message))
                return 'Use a valid iCalendar 2.0 file containing VEVENT entries.';
            if (/UID|重复/.test(message))
                return 'Check event UIDs and recurrence definitions, then export the file again.';
            if (/冲突|修改|改变/.test(message))
                return 'The calendar or event changed. Reload it and review your input before retrying.';
            return 'The calendar operation failed. Check the connection and source file, then try again.';
        }
        const languageListeners = new Set();
        function useUILanguage() {
            const [, render] = useState(UI_LANG);
            useEffect(() => { const update = () => render(UI_LANG); languageListeners.add(update); update(); return () => languageListeners.delete(update); }, []);
        }
        /** 宿主 locale 服务：get('locale') 是正规读法，ctx.locale 兜旧宿主，都没有就是没有。 */
        function localeServiceOf(ctx) {
            try {
                if (typeof ctx.get === "function") {
                    const viaGet = ctx.get("locale");
                    if (viaGet !== undefined && viaGet !== null)
                        return viaGet;
                }
            }
            catch (e) { /* 落到下面那条路 */ }
            const direct = ctx.locale;
            return direct === undefined || direct === null ? null : direct;
        }
        function localeToLang(active) {
            const text = typeof active === "string" ? active.toLowerCase() : "";
            return text.indexOf("en") === 0 ? "en" : "zh";
        }
        /** 订阅语言切换；服务缺失或形状不同都只是留在 zh，绝不把面板拖垮。 */
        function subscribeLocale(ctx) {
            const service = localeServiceOf(ctx);
            activeLocaleService = service;
            if (service === null)
                return () => { };
            const apply = () => {
                try {
                    if (typeof service.getSnapshot === "function") {
                        UI_LANG = localeToLang(service.getSnapshot().active);
                    }
                }
                catch (e) {
                    UI_LANG = "zh";
                }
                if (typeof relocalize === "function") {
                    try {
                        relocalize();
                    }
                    catch (e) { /* 重绘失败不该断订阅链 */ }
                }
            };
            apply();
            try {
                if (typeof service.subscribe !== "function")
                    return () => { };
                const off = service.subscribe(apply);
                return typeof off === "function" ? off : () => { };
            }
            catch (e) {
                return () => { };
            }
        }
        /** 文案：{name} 形式的占位符按 params 替换，缺参时保留原样（宁可露出花括号也不吞字）。 */
        function t(key, params) {
            const dict = UI[UI_LANG] || UI.zh;
            let text = dict[key];
            if (text === undefined)
                text = (UI.zh[key] !== undefined ? UI.zh[key] : key);
            if (params === undefined)
                return text;
            return text.replace(/\{(\w+)\}/g, (whole, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
        }
        /** 调插件自己的路由；错误码原样带出，方便上层区分「没配置」与「服务器拒绝」。 */
        const API_TIMEOUT_MS = 15000;
        async function api(action, payload, signal) {
            const init = { credentials: "same-origin", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action }, payload)) };
            // 请求必须有上限：挂起的 Promise 会让乐观覆盖一直盖着、撤销条永不出现，
            // 表现就是「界面改了、服务器没改」而用户以为成功。超时按失败处理（调用方会回滚并对账）。
            if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
                if (action === 'availability') init.signal = AbortSignal.timeout(25000);
                else if (action === 'exportIcs' || action === 'switchBackend') init.signal = AbortSignal.timeout(120000);
                else init.signal = AbortSignal.timeout(API_TIMEOUT_MS);
            }
            if (signal) init.signal = init.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, signal]) : signal;
            const res = await fetch(ROUTE, init);
            let body = null;
            try {
                body = await res.json();
            }
            catch (e) {
                body = null;
            }
            if (!res.ok || !body || body.ok !== true) {
                const message = body && body.error && body.error.message ? body.error.message : ("HTTP " + res.status);
                const error = new Error(message);
                error.status = res.status;
                error.code = body && body.error ? body.error.code : undefined;
                error.message = backendMessage(error);
                throw error;
            }
            return body.value;
        }
        // ───────────────────────────── 时间与格式 ─────────────────────────────
        /** 事件时间是「全天 = YYYY-MM-DD」或「定时 = UTC ISO」，两种都要能解析。 */
        function isDateOnly(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
        function startDate(event) { return isDateOnly(event.start) ? new Date(event.start + "T00:00:00") : new Date(event.start); }
        function endDate(event) { return isDateOnly(event.end) ? new Date(event.end + "T00:00:00") : new Date(event.end); }
        function dayKey(date) {
            return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
        }
        function pad2(n) { return n < 10 ? "0" + n : String(n); }
        function hhmm(date) { return pad2(date.getHours()) + ":" + pad2(date.getMinutes()); }
        function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
        function addDays(date, n) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n); }
        /** 周一为一周之首：JS 的 getDay() 里周日是 0，先掰成 1..7。 */
        function isoWeekday(date) { const d = date.getDay(); return d === 0 ? 7 : d; }
        function startOfWeek(date) { return addDays(startOfDay(date), -(isoWeekday(date) - 1)); }
        function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
        function formatDay(date, opts) {
            const withYear = opts && opts.withYear;
            if (UI_LANG === "en")
                return date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
            return date.getFullYear() + " 年 " + (date.getMonth() + 1) + " 月 " + date.getDate() + " 日" + (withYear ? "" : "");
        }
        function formatMonthTitle(date) { return UI_LANG === "en" ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long" }) : date.getFullYear() + " 年 " + (date.getMonth() + 1) + " 月"; }
        function formatWeekTitle(date) {
            const from = startOfWeek(date), to = addDays(from, 6);
            if (UI_LANG === "en")
                return formatDay(from) + " – " + formatDay(to);
            return formatMonthTitle(from) + " " + from.getDate() + "–" + (to.getMonth() === from.getMonth() ? "" : (to.getMonth() + 1) + " 月 ") + to.getDate() + " 日";
        }
        function relativeDay(date) {
            const diff = daysBetween(new Date(), date);
            if (diff === 0)
                return t("day.today");
            if (diff === 1)
                return t("day.tomorrow");
            if (diff === -1)
                return t("day.yesterday");
            return UI_LANG === "en" ? date.toLocaleDateString("en-GB", { weekday: "short" }) : "周" + WEEKDAYS_ZH[isoWeekday(date) - 1];
        }
        function formatWhen(event) {
            if (event.allDay)
                return t("format.allday") + " · " + formatDay(startDate(event));
            const s = startDate(event), e = endDate(event);
            const sameDay = dayKey(s) === dayKey(e);
            return formatDay(s) + " " + hhmm(s) + "–" + (sameDay ? "" : formatDay(e) + " ") + hhmm(e);
        }
        function formatDuration(event) {
            if (event.allDay) {
                const days = Math.max(1, daysBetween(startDate(event), endDate(event)));
                return days === 1 ? t("format.allday") : days + (UI_LANG === "en" ? " days" : " 天");
            }
            const minutes = Math.max(0, Math.round((endDate(event) - startDate(event)) / 60000));
            const hours = Math.floor(minutes / 60), rest = minutes % 60;
            if (hours > 0 && rest > 0)
                return t("format.duration.hm", { h: hours, m: rest });
            if (hours > 0)
                return t("format.duration.h", { h: hours });
            if (rest > 0)
                return t("format.duration.m", { m: rest });
            return t("format.duration.zero");
        }
        /** RRULE 说人话：只翻译常见的 FREQ/INTERVAL/COUNT/UNTIL，认不出就原样返回。 */
        function humanRepeat(rrule) {
            if (!rrule)
                return "";
            const parts = {};
            String(rrule).split(";").forEach((piece) => {
                const i = piece.indexOf("=");
                if (i > 0)
                    parts[piece.slice(0, i).toUpperCase()] = piece.slice(i + 1);
            });
            const freq = parts.FREQ;
            if (UI_LANG === "en") {
                const units = { DAILY: ["Daily", "days"], WEEKLY: ["Weekly", "weeks"], MONTHLY: ["Monthly", "months"], YEARLY: ["Yearly", "years"] };
                if (!units[freq])
                    return rrule;
                const interval = Number(parts.INTERVAL || "1");
                const every = interval > 1 ? "Every " + interval + " " + units[freq][1] : units[freq][0];
                if (parts.COUNT)
                    return every + " (" + parts.COUNT + " occurrences)";
                if (parts.UNTIL) {
                    const raw = String(parts.UNTIL), date = raw.length >= 8 ? raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8) : raw;
                    return every + ", until " + date;
                }
                return every;
            }
            const base = freq === "DAILY" ? "每天" : freq === "WEEKLY" ? "每周" : freq === "MONTHLY" ? "每月" : freq === "YEARLY" ? "每年" : "";
            if (base === "")
                return rrule;
            const interval = Number(parts.INTERVAL || "1");
            const every = interval > 1 ? "每 " + interval + (freq === "DAILY" ? " 天" : freq === "WEEKLY" ? " 周" : freq === "MONTHLY" ? " 个月" : " 年") : base;
            if (parts.COUNT)
                return every + "（共 " + parts.COUNT + " 次）";
            if (parts.UNTIL) {
                const raw = String(parts.UNTIL);
                const iso = raw.length >= 8 ? raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8) : raw;
                return every + "，到 " + iso + " 为止";
            }
            return every;
        }
        /** 两个事件是否真的重叠（全天事件按当天整天算）。 */
        function overlaps(a, b) {
            if ([a,b].some(event=>event.status?.toUpperCase()==='CANCELLED'||event.transparency?.toUpperCase()==='TRANSPARENT')) return false;
            const as = startDate(a).getTime(), ae = endDate(a).getTime() || as;
            const bs = startDate(b).getTime(), be = endDate(b).getTime() || bs;
            return as < be && bs < ae;
        }
        /** 月视图的 6×7 网格起点：所在周的周一，往前补到整周。 */
        function monthGridDays(anchor) {
            const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
            const start = startOfWeek(first);
            const days = [];
            for (let i = 0; i < 42; i++)
                days.push(addDays(start, i));
            return days;
        }
        /** 一个事件落在哪几天（跨天事件在月视图里逐天显示）。 */
        function daysOfEvent(event) {
            const days = [];
            if (event.allDay) {
                const from = startDate(event);
                // 全天事件的 DTEND 是「次日零点」（iCal 语义），显示上要退一天。
                const to = addDays(endDate(event), -1);
                for (let d = startOfDay(from); d <= to; d = addDays(d, 1))
                    days.push(d);
                return days.length > 0 ? days : [from];
            }
            const from = startOfDay(startDate(event)), to = startOfDay(endDate(event));
            for (let d = from; d <= to; d = addDays(d, 1))
                days.push(d);
            return days;
        }
        /** 事件排序：全天在前，然后按开始时间。 */
        function sortForDisplay(events) {
            return events.slice().sort((a, b) => {
                if (a.allDay !== b.allDay)
                    return a.allDay ? -1 : 1;
                return startDate(a) - startDate(b);
            });
        }
        // ───────────────────────────── 宿主 UI 组件（可选） ─────────────────────────────
        // 平台的 seed 模块表里有 ui-primitives；老宿主没有时退回同名自绘控件，
        // 面板不会因为「组件库不在」整块消失。
        var PRIM = null;
        try {
            PRIM = require("@deepseek-ai/dsh-client-ui-primitives");
        }
        catch (e) {
            PRIM = null;
        }
        /** Button：有官方组件就用官方（variant/tokens 一致），否则退回 .dshc-btn。 */
        function Btn(props) {
            const { variant, size, icon, className, children, ...rest } = props || {};
            if (PRIM && typeof PRIM.Button === "function") {
                return h(PRIM.Button, Object.assign({ variant: variant || "ghost", size: size || "sm" }, rest, { className }), children);
            }
            const cls = ["dshc-btn", variant === "primary" ? "primary" : "", variant === "danger" ? "danger" : "", variant === "ghost" ? "ghost" : "", className || ""].join(" ").trim();
            return h("button", Object.assign({ type: "button" }, rest, { className: cls }), children);
        }
        /** Input：官方版是「带图标的 span 包 input」，属性透传，这里只用其属性面。 */
        function Txt(props) {
            const { className, ...rest } = props || {};
            if (PRIM && typeof PRIM.Input === "function")
                return h(PRIM.Input, Object.assign({}, rest, { className }));
            return h("input", Object.assign({ type: "text" }, rest, { className: ["dshc-input", className || ""].join(" ").trim() }));
        }
        /** Checkbox：回到原生勾选框 + 文案，语义与官方一致（label 既是可见名也是无障碍名）。 */
        function Chk(props) {
            if (PRIM && typeof PRIM.Checkbox === "function")
                return h(PRIM.Checkbox, props);
            return h("label", { className: "dshc-check" }, [
                h("input", { type: "checkbox", checked: props.checked === true, disabled: props.disabled === true, onChange: (e) => props.onChange(e.target.checked) }),
                h("span", null, props.label)
            ]);
        }
        /** Modal：官方版是 portal + 遮罩 + Esc 语义；没有它时用同一套 class 自绘。 */
        function Dlg(props) {
            if (PRIM && typeof PRIM.Modal === "function") {
                return h(PRIM.Modal, {
                    open: props.open,
                    onClose: props.onClose,
                    title: props.title,
                    closeLabel: props.closeLabel || props.title,
                    children: h("div", { "data-dshc-scope": "1" }, props.children),
                    footer: props.footer
                });
            }
            if (!props.open)
                return null;
            return h("div", { className: "dshc-modalwrap", onMouseDown: (e) => { if (e.target === e.currentTarget)
                    props.onClose(); } }, [
                h("div", { className: "dshc-modal" }, [
                    h("div", { style: { position: "relative" } }, [
                        h("div", { className: "dshc-drawertitle" }, props.title),
                        h("button", { type: "button", className: "dshc-btn ghost dshc-close", onClick: props.onClose, "aria-label": props.closeLabel || props.title }, "\u2715")
                    ]),
                    props.children,
                    props.footer
                ])
            ]);
        }
        /** 复制 uid：优先官方 writeClipboard（它处理了非 https 的降级），否则走 navigator。 */
        async function copyText(text) {
            try {
                if (PRIM && typeof PRIM.writeClipboard === "function") {
                    await PRIM.writeClipboard(text);
                    return true;
                }
            }
            catch (e) { /* 落到下面 */ }
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                    return true;
                }
            }
            catch (e) { /* 忽略 */ }
            return false;
        }
        // ───────────────────────────── 拖拽/键盘改期的几何 ─────────────────────────────
        // 这一组是本轮唯一的「算法」：拖动、缩放手柄、键盘微调都走它们。它们不碰 DOM、不认 React，
        // 所以跨天/跨月/DST/吸附边界这些真正容易错的地方能被单测直接盯住（见 test/schedule.test.mjs）。
        /** 全天事件与定时事件共用一个「槽位」概念：某天 + 当天第几分钟 + 时长。 */
        const SNAP_MINUTES = 15;
        const RESIZE_MIN_MINUTES = 15;
        function snapMinutes(value, step) {
            const unit = typeof step === "number" && step > 0 ? step : SNAP_MINUTES;
            return Math.round(value / unit) * unit;
        }
        /** 事件 → 槽位（按浏览器本地墙钟，显示与拖拽都以用户看到的为准）。 */
        function slotFromEvent(event) {
            const start = startDate(event);
            const end = endDate(event);
            const minutes = start.getHours() * 60 + start.getMinutes();
            const durationMinutes = Math.max(RESIZE_MIN_MINUTES, Math.round((end - start) / 60000));
            return { dayKey: dayKey(start), minutes, durationMinutes, allDay: event.allDay === true };
        }
        /**
         * 槽位 + 位移 → 新槽位。
         * 位移以「天 + 分钟」给（拖动时由像素换算），跨天/跨月/跨年都靠时间戳自然进位，
         * 最后把开始时间吸附到 15 分钟并钳在当天 00:00 与「当天结束前还放得下整个时长」之间。
         */
        function moveSlot(slot, deltaDays, deltaMinutes, step) {
            // 分钟先合成「当天内 + 跨几天」，再用日历日相加 —— 不能用「天 × 1440 毫秒」当瞬时位移：
            // DST 切换日一天是 23 或 25 小时，按毫秒加会整体偏一小时（评审查出来的，中国时区看不见）。
            const total = slot.minutes + (deltaMinutes || 0);
            const dayShift = Math.floor(total / 1440);
            const minutes = total - dayShift * 1440;
            const base = new Date(slot.dayKey + "T00:00:00");
            const target = addDays(base, (deltaDays || 0) + dayShift);
            const unit = typeof step === "number" && step > 0 ? step : SNAP_MINUTES;
            // 日末钳制也要落在网格上：1440 − 时长不保证是 15 的倍数（50 分钟 → 23:10 这种脏值）。
            const latestStart = Math.max(0, Math.floor((24 * 60 - slot.durationMinutes) / unit) * unit);
            const snapped = Math.max(0, Math.min(snapMinutes(minutes, unit), latestStart));
            return { dayKey: dayKey(target), minutes: snapped, durationMinutes: slot.durationMinutes, allDay: slot.allDay };
        }
        /** 拖拽像素位移 → 槽位位移（横向一格 = 一天，纵向按小时像素换算成分钟）。 */
        function slotFromDrag(slot, drag, step) {
            const hourPx = typeof drag.hourPx === "number" && drag.hourPx > 0 ? drag.hourPx : 44;
            const columns = Math.round(drag.columns || 0);
            const unit = typeof step === "number" && step > 0 ? step : SNAP_MINUTES;
            const rawMinutes = ((drag.pixelsY || 0) / hourPx) * 60;
            const deltaMinutes = Math.round(rawMinutes / unit) * unit;
            return moveSlot(slot, columns, deltaMinutes, unit);
        }
        /** 缩放手柄：只改时长，不改开始时间（最短 15 分钟，最长到当天结束）。 */
        function resizeSlot(slot, deltaMinutes, step) {
            const unit = typeof step === "number" && step > 0 ? step : SNAP_MINUTES;
            // 只吸附**位移量**：50 分钟的日程碰一下手柄（位移 0）不该被吸成 45。
            // 上限就是 24 小时 —— 允许拖过午夜（此前按「当天还剩多少」压缩，23:30–00:30 一碰就变 30 分钟）。
            const next = slot.durationMinutes + snapMinutes(deltaMinutes || 0, unit);
            return { dayKey: slot.dayKey, minutes: slot.minutes, durationMinutes: Math.max(RESIZE_MIN_MINUTES, Math.min(next, 24 * 60)), allDay: slot.allDay };
        }
        /** 槽位 → 提交给服务器的 start/end（本地墙钟换算成 UTC 秒级 ISO）。 */
        function rangeOfSlot(slot) {
            const start = new Date(slot.dayKey + "T00:00:00");
            start.setMinutes(slot.minutes);
            const end = new Date(start.getTime() + slot.durationMinutes * 60000);
            return { start: isoOf(start), end: isoOf(end) };
        }
        /**
         * 这一周的日程实际占用的时段 → 时间轴窗口（分钟，0–1440）。
         *
         * 周视图不再画满 24 小时：满屏 24 小时等于每小时只有十几像素，半小时的会议挤成一条线。
         * 这里按「最早开始 → 最晚结束」算窗口，前后各留 30 分钟余量、至少 6 小时、对齐到整点。
         * 窗口内是线性刻度，拖拽换算才有意义；窗口外的时段不画也不提示，直接不占高度。
         * 跨夜的日程按「到当天结束」计，避免 end < start 把窗口算成负数。
         */
        function timeWindowOf(events, padMinutes = 30, minHours = 6) {
            let from = Infinity;
            let to = -Infinity;
            for (const event of events) {
                if (event.allDay === true)
                    continue;
                const start = startDate(event);
                const minutes = start.getHours() * 60 + start.getMinutes();
                const span = Math.max(15, Math.round((endDate(event) - start) / 60000));
                from = Math.min(from, minutes);
                to = Math.max(to, Math.min(24 * 60, minutes + span));
            }
            if (Number.isFinite(from) !== true || Number.isFinite(to) !== true) {
                from = 8 * 60;
                to = 20 * 60;
            }
            let startMin = Math.max(0, Math.floor((from - padMinutes) / 60) * 60);
            let endMin = Math.min(24 * 60, Math.ceil((to + padMinutes) / 60) * 60);
            const span = minHours * 60;
            if (endMin - startMin < span) {
                endMin = Math.min(24 * 60, startMin + span);
                startMin = Math.max(0, Math.min(startMin, endMin - span));
            }
            return { start: startMin, end: endMin };
        }
        /** 落点与哪些已有日程重叠（拖动中用来把幽灵块描成黄色）。 */
        function conflictsForSlot(events, slot, uid) {
            const range = rangeOfSlot(slot);
            const pseudo = { uid: "__drag", summary: "", start: range.start, end: range.end, allDay: slot.allDay === true };
            return events.filter((event) => event.uid !== uid && overlaps(event, pseudo));
        }
        /**
         * 指针 x（视口坐标）→ 列号。坐标必须来自 getBoundingClientRect ——
         * offsetLeft 是相对 offsetParent 的，浮层面板里与 clientX 不是一个坐标系（评审抓到的坑）。
         * 找不到列就返回 undefined，调用方按「不换天」处理。
         */
        function columnIndexFromRects(clientX, rects) {
            for (const rect of rects) {
                if (clientX >= rect.left && clientX < rect.left + rect.width)
                    return rect.index;
            }
            return undefined;
        }
        /** 重复日程（系列本身 or 某次实例）：CalDAV 里整个系列是一个对象，拖动会改整条。 */
        function isRecurring(event) {
            return event.rrule !== undefined || event.isOccurrence === true || event.seriesStart !== undefined;
        }
        // ───────────────────────────── 小部件 ─────────────────────────────
        /** 事件属于哪一类：影响左侧色条（全天绿 / 重复黄 / 普通蓝）。 */
        function eventClass(event) {
            return event.allDay ? "allday" : (event.rrule || event.isOccurrence ? "recurring" : "");
        }
        function Chip(props) {
            const { event, onClick } = props;
            return h("button", {
                type: "button",
                className: "dshc-chip " + eventClass(event),
                title: event.summary,
                onClick: (e) => { e.stopPropagation(); onClick(event); }
            }, [
                event.allDay ? null : h("span", { className: "t" }, hhmm(startDate(event))),
                h("span", null, event.summary)
            ]);
        }
        /** 议程里的一行：时间列 + 标题/地点 + 重复角标。 */
        function Row(props) {
            const { event, onClick } = props;
            const meta = [];
            if (event.location)
                meta.push(event.location);
            if (event.rrule)
                meta.push(humanRepeat(event.rrule));
            else if (event.isOccurrence)
                meta.push(t("repeat.occurrence"));
            return h("div", { className: "dshc-row " + eventClass(event), onClick: () => onClick(event), role: "button", tabIndex: 0,
                onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ")
                    onClick(event); } }, [
                h("div", { className: "dshc-time" }, event.allDay ? t("format.allday") : (hhmm(startDate(event)) + "–" + hhmm(endDate(event)))),
                h("div", { className: "dshc-main" }, [
                    h("div", { className: "dshc-name" }, event.summary),
                    meta.length > 0 ? h("div", { className: "dshc-meta" }, meta.join(" · ")) : null
                ])
            ]);
        }
        /**
         * 月视图：6×7 网格铺满可用高度。
         *
         * 每格显示几条不是写死的：先量网格的实测高度，算出「一格能放几行芯片」，
         * 放不下的收成「+N」。窗口矮就自动少显示一条，绝不让格子撑高页面、也不出现滚动条。
         */
        /** 月视图一格：芯片占多高（芯片 15 + 间距 2），以及日号行 + 内边距占多少。 */
        const MONTH_CHIP_STEP = 17;
        const MONTH_CELL_CHROME = 34;
        function MonthView(props) {
            const { anchor, events, onPick, onCreateAt, cycle } = props;
            const days = monthGridDays(anchor);
            const today = dayKey(new Date());
            const gridRef = useRef(null);
            const gridHeight = useElementHeight(gridRef, 0, "month-grid");
            // 一格能塞几条：行高 = 网格高 / 6，扣掉日号行与内边距，再除以「芯片 + 间距」。
            // 多出来的不硬塞，改成「+N」——塞进去也是被裁掉，用户以为那天就这些事。
            const rowsFit = gridHeight <= 0 ? 3 : Math.max(1, Math.floor((gridHeight / 6 - MONTH_CELL_CHROME) / MONTH_CHIP_STEP));
            const byDay = {};
            for (const event of events) {
                for (const day of daysOfEvent(event)) {
                    const key = dayKey(day);
                    if (!byDay[key])
                        byDay[key] = [];
                    byDay[key].push(event);
                }
            }
            const cells = [];
            for (const day of days) {
                const key = dayKey(day);
                const decor = dayDecorOf(day);
                const lunarLabel = lunarLabelOf(decor, UI_LANG !== "en");
                const badge = holidayBadgeOf(decor);
                const period = cycleInfoOf(cycle, key);
                const list = sortForDisplay(byDay[key] || []);
                // 放不下就少显示一条，把位置让给「+N」（它本身也占一行）。
                const room = list.length > rowsFit ? Math.max(0, rowsFit - 1) : rowsFit;
                const shown = list.slice(0, Math.max(0, room));
                const rest = list.length - shown.length;
                // 格子必须是 div 而不是 button：里面的日程芯片本身是按钮，而按钮不能嵌套按钮 ——
                // 嵌套时浏览器会把外层按钮提前闭合，芯片就被挤到网格外面去了（真被用户抓到过）。
                cells.push(h("div", {
                    key: key,
                    role: "button",
                    tabIndex: 0,
                    className: "dshc-cell" + (day.getMonth() !== anchor.getMonth() ? " out" : "") + (key === today ? " today" : "") + (badge !== null ? " dshc-" + badge.type : ""),
                    onClick: () => onCreateAt(day),
                    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onCreateAt(day);
                    } },
                    title: t("action.new")
                }, [
                    h("div", { className: "dshc-daynum" }, [
                        // 日号与休/班角标成一组靠左，农历靠右：三者同一 flex 行，
                        // 不再让绝对定位的角标压在农历上（用户抓到过重叠）。
                        h("span", { className: "dshc-daylead" }, [
                            key === today ? h("b", null, String(day.getDate())) : h("span", null, String(day.getDate())),
                            badge !== null ? h("span", { className: "dshc-hbadge dshc-inline " + badge.type, title: badge.title }, badge.label) : null,
                            period !== null ? h("i", { key: "period", className: "dshc-period-mark", "aria-hidden": "true" }) : null
                        ]),
                        lunarLabel !== null
                            ? h("span", { className: "dshc-lunar" + (decor.lunar.festival !== null ? " festival" : ""), title: decor.lunar.full }, lunarLabel)
                            : null
                    ]),
                    shown.map((event) => h(Chip, { key: event.uid + "@" + key, event, onClick: onPick })),
                    rest > 0 ? h("div", { className: "dshc-more" }, "+" + rest) : null,
                    period !== null ? h("span", { key: "period-tip", className: "dshc-period-tip" }, t("cycle.mark", { n: period.day })) : null
                ]));
            }
            return h("div", { className: "dshc-view" }, [
                h("div", { className: "dshc-grid dshc-dowgrid", key: "__dow" }, WEEKDAYS_ZH.map((d, i) => h("div", { className: "dshc-dow", key: d }, UI_LANG === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i] : "周" + d))),
                h("div", { className: "dshc-grid dshc-monthgrid", key: "__cells", ref: gridRef }, cells)
            ]);
        }
        /**
         * 周视图：7 列 × 「本周日程实际占用时段」的时间轴。除了画日程，它还负责改期：
         *   · 拖动事件块：上下改时间、左右换天（15 分钟吸附）；
         *   · 拖块底部 6px 的缩放手柄：只改时长；
         *   · 拖动中画幽灵落点，与已有日程重叠时描成黄色（允许重叠，只是提醒）；
         *   · 拖到容器上下边缘自动滚动（浮层面板那种会滚的容器才有用，一屏布局里是空转）；
         *   · 键盘：Tab 聚焦后 ↑/↓ 挪 15 分钟、Shift+↑/↓ 挪 1 小时、←/→ 挪一天、Enter 打开详情、拖动中 Esc 取消。
         * 几何计算全在纯函数里（slotFromDrag / resizeSlot / moveSlot / columnIndexFromRects），这里只做指针与 DOM 的事。
         *
         * 时间轴不开满 24 小时：窗口取 timeWindowOf() 的结果，高度 = 周网格实测 - DAY_HEAD_H，
         * 窗口外不再挂提示带（用户明确要求去掉，省下来的高度全给日程）。
         *
         * 两个坑写在这里免得后人再踩：
         *   1. 列判定必须用 getBoundingClientRect：offsetLeft 是相对 offsetParent 的，浮层面板里与 clientX 不同坐标系；
         *   2. window 监听器只在挂载时注册一次，通过 impl ref 调用「最新实现」；
         *      按渲染闭包挂/摘会出现「摘不掉 → 卸载后 pointerup 替用户提交一次改期」。
         */
        /**
         * 周视图表头高度：JS 与 CSS 共用（.dshc-dayhead 也是 26px）。
         * 时间轴高度 = 周网格实测高度 - 它，两个地方写死同一个数才不会差出一根滚动条。
         */
        const DAY_HEAD_H = 26;
        const FALLBACK_TIMELINE_H = 320;
        function WeekView(props) {
            const { anchor, events, onPick, onCreateAt, onReschedule, cycle } = props;
            /** 示例模式下没有 onReschedule：不做改期，也不显示拖拽提示。 */
            const canEdit = typeof onReschedule === "function";
            const start = startOfWeek(anchor);
            const days = [];
            for (let i = 0; i < 7; i++)
                days.push(addDays(start, i));
            const today = dayKey(new Date());
            const allDay = sortForDisplay(events.filter((e) => e.allDay));
            const timed = events.filter((e) => !e.allDay);
            /**
             * 时间轴 = 这一周日程实际占用的时段（见 timeWindowOf），高度取容器的实测值。
             * 于是「24 小时铺满一屏、不等高压缩、不滚动」三件事同时成立。
             */
            const scroller = useRef(null);
            const window_ = timeWindowOf(timed);
            // 量周网格的整体高度，再减去固定表头 —— 时间轴必须**恰好**填满剩下的空间，
            // 差一个像素就是一根滚动条。没有 ResizeObserver 时按 320px 画。
            const weekHeight = useElementHeight(scroller, 0, "week-grid");
            const timelineHeight = weekHeight > 0 ? Math.max(80, weekHeight - DAY_HEAD_H) : FALLBACK_TIMELINE_H;
            const hourPx = Math.max(4, timelineHeight / ((window_.end - window_.start) / 60));
            /** 刻度密度：每小时像素不够就隔几小时标一个，免得字叠字。 */
            const labelStep = hourPx >= 22 ? 1 : hourPx >= 14 ? 2 : hourPx >= 9 ? 3 : 6;
            const offsetOf = (minutes) => Math.max(0, ((minutes - window_.start) / 60) * hourPx);
            /** 拖拽位置放 ref：每帧 setState 会让整棵树重渲染，拖动会顿。 */
            const dragRef = useRef(null);
            const suppressClick = useRef(false);
            const [ghost, setGhost] = useState(null);
            /** 每列的**视口**矩形（见文件头注释第 1 条）。 */
            const columnRects = () => {
                const node = scroller.current;
                if (node === null || node === undefined)
                    return [];
                return days.map((day, index) => {
                    const column = node.querySelector('[data-day="' + dayKey(day) + '"]');
                    if (column === null)
                        return { dayKey: dayKey(day), index, left: 0, width: 0 };
                    const rect = column.getBoundingClientRect();
                    return { dayKey: dayKey(day), index, left: rect.left, width: rect.width };
                });
            };
            const scrollTopNow = () => {
                const node = scroller.current;
                return node === null || node === undefined ? 0 : node.scrollTop;
            };
            const isOwnPointer = (pointerEvent) => {
                const drag = dragRef.current;
                if (drag === null)
                    return false;
                return pointerEvent.pointerId === undefined || drag.pointerId === undefined || pointerEvent.pointerId === drag.pointerId;
            };
            const stopDrag = (commit) => {
                stopAutoScroll();
                const drag = dragRef.current;
                dragRef.current = null;
                setGhost(null);
                if (drag === null)
                    return;
                const moved = drag.moved === true;
                if (moved === true) {
                    // 拖动之后浏览器通常会补一个 click，用它把「抑制」消费掉；
                    // 但如果松手在空白处（没有 click），下个事件循环必须清掉 —— 否则会吞掉将来某次正常点击。
                    suppressClick.current = true;
                    setTimeout(() => { suppressClick.current = false; }, 0);
                }
                if (commit !== false && moved === true && canEdit === true) {
                    const slot = drag.previewSlot === undefined ? drag.slot : drag.previewSlot;
                    // 没有落点就不提交：比如纵向拖出本周（跨到下周）时幽灵没地方画，这时盲提交会让事件从视图消失。
                    // 用 dragRef 上的同步标记，而不是 React state（见 applyPreviewAt 的注释）。
                    if (drag.previewVisible === true)
                        onReschedule(drag.event, rangeOfSlot(slot), drag.mode);
                }
            };
            /** 由指针位置算落点、画幽灵（只管几何，不碰边缘滚动的调度）。 */
            const applyPreviewAt = (clientX, clientY, drag) => {
                // 容器自己滚动过的话，指针下方的**内容**坐标变了：不补这一项，幽灵块会落后于指针，
                // 松手落点也跟着偏（误差 = 滚动量，可达数小时）。
                const scrolled = scrollTopNow() - drag.startScrollTop;
                const dx = clientX - drag.startX;
                const dy = clientY - drag.startY + scrolled;
                if (drag.moved !== true && Math.abs(dx) < 5 && Math.abs(dy) < 5)
                    return;
                drag.moved = true;
                const ownIndex = drag.columns.findIndex((column) => column.dayKey === drag.slot.dayKey);
                const targetIndex = columnIndexFromRects(clientX, drag.columns);
                // 横向只允许在本周 7 天内换天：跨到下周会让幽灵无处渲染、事件从当前视图消失。
                const rawColumns = targetIndex === undefined || ownIndex === -1 ? 0 : targetIndex - ownIndex;
                const columns = ownIndex === -1 ? 0 : Math.max(-ownIndex, Math.min(6 - ownIndex, rawColumns));
                // 时间轴不再是固定 44px/小时，像素 → 分钟一律按实测的 hourPx 换算。
                const slot = drag.mode === "resize"
                    ? resizeSlot(drag.slot, (dy / hourPx) * 60, SNAP_MINUTES)
                    : slotFromDrag(drag.slot, { columns, pixelsY: dy, hourPx }, SNAP_MINUTES);
                drag.previewSlot = slot;
                // 可见性判断必须同步落在 dragRef 上：pointermove 与 pointerup 可能在同一批次里，
                // 此时读 React state（ghost）拿到的是旧值，会导致「拖了却不提交」。
                drag.previewVisible = days.some((day) => dayKey(day) === slot.dayKey);
                setGhost({ uid: drag.uid, slot, conflicts: conflictsForSlot(events, slot, drag.uid).length });
            };
            /**
             * 边缘自动滚动：用 rAF 持续滚，而不是「每次 pointermove 滚一小步」。
             * 前者指针停在边缘不动也会继续滚（这才是「长会议不用先滚再拖」），
             * 后者只在指针移动时滚，用户会觉得网格在滚、事件却不跟手。
             */
            const autoScroll = useRef({ raf: 0, x: 0, y: 0 });
            const stopAutoScroll = () => {
                if (autoScroll.current.raf !== 0) {
                    window.cancelAnimationFrame(autoScroll.current.raf);
                    autoScroll.current.raf = 0;
                }
            };
            const stepAutoScroll = () => {
                autoScroll.current.raf = 0;
                const drag = dragRef.current;
                const node = scroller.current;
                if (drag === null || node === null || node === undefined)
                    return;
                // 一屏布局下时间轴不滚动（scrollHeight === clientHeight），边缘滚动自然失效；
                // 这段保留，是为了浮层面板那种更小的容器仍能按老方式滚。
                // 只在「量得到高度且确实没得滚」时短路：jsdom 里 clientHeight 恒为 0，不能当成不可滚。
                if (node.clientHeight > 0 && node.scrollHeight <= node.clientHeight + 1)
                    return;
                const rect = node.getBoundingClientRect();
                const y = autoScroll.current.y;
                let delta = 0;
                if (y < rect.top + 40)
                    delta = -Math.min(24, (rect.top + 40 - y) / 3);
                else if (y > rect.bottom - 40)
                    delta = Math.min(24, (y - (rect.bottom - 40)) / 3);
                if (delta === 0)
                    return; // 指针离开边缘：循环自然停下，下次移动会再起
                node.scrollTop += delta;
                applyPreviewAt(autoScroll.current.x, y, drag); // 滚动后重算落点（含滚动补偿）
                autoScroll.current.raf = window.requestAnimationFrame(stepAutoScroll);
            };
            const ensureAutoScroll = (pointerEvent) => {
                autoScroll.current.x = pointerEvent.clientX;
                autoScroll.current.y = pointerEvent.clientY;
                const node = scroller.current;
                if (node === null || node === undefined)
                    return;
                const rect = node.getBoundingClientRect();
                const nearEdge = pointerEvent.clientY < rect.top + 40 || pointerEvent.clientY > rect.bottom - 40;
                if (nearEdge === true && autoScroll.current.raf === 0)
                    autoScroll.current.raf = window.requestAnimationFrame(stepAutoScroll);
            };
            const updatePreview = (pointerEvent) => {
                const drag = dragRef.current;
                if (drag === null)
                    return;
                // 鼠标在窗口外松开时浏览器可能不派发 pointerup：按键已经松了就当作取消，
                // 免得「卡住的拖拽」在回到窗口后被下一次移动继续更新、下一次松开就替用户提交。
                if (drag.moved === true && pointerEvent.buttons === 0) {
                    stopDrag(false);
                    return;
                }
                applyPreviewAt(pointerEvent.clientX, pointerEvent.clientY, drag);
                ensureAutoScroll(pointerEvent);
            };
            /**
             * window 监听器只在挂载时注册一次，通过 impl ref 调「最新实现」。
             * 这样既不会因为渲染闭包更换而摘不掉（那会导致卸载后 pointerup 真的发一次 update），
             * 也不会读到过期的 state。
             */
            const impl = useRef({});
            impl.current = { stopDrag, updatePreview, isOwnPointer };
            useEffect(() => {
                const onMove = (pointerEvent) => { if (dragRef.current !== null && impl.current.isOwnPointer(pointerEvent) === true)
                    impl.current.updatePreview(pointerEvent); };
                const onUp = (pointerEvent) => { if (dragRef.current !== null && impl.current.isOwnPointer(pointerEvent) === true)
                    impl.current.stopDrag(true); };
                const onCancel = () => { if (dragRef.current !== null)
                    impl.current.stopDrag(false); };
                const onKey = (keyEvent) => { if (keyEvent.key === "Escape" && dragRef.current !== null) {
                    keyEvent.preventDefault();
                    keyEvent.stopPropagation();
                    impl.current.stopDrag(false);
                } };
                const onBlur = () => { if (dragRef.current !== null)
                    impl.current.stopDrag(false); };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
                window.addEventListener("pointercancel", onCancel);
                // 捕获阶段：保证「取消拖动」先于浮层面板的 document Esc（否则会顺手把面板也关了）。
                window.addEventListener("keydown", onKey, true);
                window.addEventListener("blur", onBlur);
                return () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    window.removeEventListener("pointercancel", onCancel);
                    window.removeEventListener("keydown", onKey, true);
                    if (autoScroll.current.raf !== 0) {
                        window.cancelAnimationFrame(autoScroll.current.raf);
                        autoScroll.current.raf = 0;
                    }
                    window.removeEventListener("blur", onBlur);
                    dragRef.current = null; // 卸载时不能留着半截拖拽状态
                };
            }, []);
            const beginDrag = (event, pointerEvent, mode) => {
                if (canEdit !== true)
                    return; // 示例模式：不落盘就不给拖
                if (pointerEvent.button !== undefined && pointerEvent.button !== 0)
                    return;
                if (dragRef.current !== null)
                    return; // 已经有一根指针在拖，忽略第二根
                suppressClick.current = false;
                try {
                    if (typeof pointerEvent.currentTarget.setPointerCapture === "function")
                        pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
                }
                catch (error) { /* 不支持就算了，window 监听器兜底 */ }
                dragRef.current = {
                    uid: event.uid,
                    event,
                    pointerId: pointerEvent.pointerId,
                    mode: mode === "resize" ? "resize" : "move",
                    slot: slotFromEvent(event),
                    startX: pointerEvent.clientX,
                    startY: pointerEvent.clientY,
                    startScrollTop: scrollTopNow(),
                    moved: false,
                    columns: columnRects(),
                };
            };
            /** 键盘改期：与拖拽走同一套纯函数，所以行为一致（且不用鼠标也能用）。 */
            const onKeyDown = (event, keyEvent) => {
                if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                    keyEvent.preventDefault();
                    onPick(event);
                    return;
                }
                if (canEdit !== true)
                    return;
                const slot = slotFromEvent(event);
                let deltaDays = 0;
                let deltaMinutes = 0;
                if (keyEvent.key === "ArrowUp")
                    deltaMinutes = keyEvent.shiftKey ? -60 : -SNAP_MINUTES;
                else if (keyEvent.key === "ArrowDown")
                    deltaMinutes = keyEvent.shiftKey ? 60 : SNAP_MINUTES;
                else if (keyEvent.key === "ArrowLeft")
                    deltaDays = -1;
                else if (keyEvent.key === "ArrowRight")
                    deltaDays = 1;
                else
                    return;
                keyEvent.preventDefault();
                onReschedule(event, rangeOfSlot(moveSlot(slot, deltaDays, deltaMinutes, SNAP_MINUTES)), "move");
            };
            // 刻度只画窗口内的整点，密度不够就隔几小时一个（labelStep）；标签绝对定位，不占高度。
            const hourMarks = [];
            for (let minutes = window_.start; minutes < window_.end; minutes += 60) {
                if ((minutes - window_.start) % (labelStep * 60) !== 0)
                    continue;
                hourMarks.push(minutes);
            }
            const hoursColumn = h("div", { key: "__hours", className: "dshc-weekcol" }, [
                h("div", { className: "dshc-dayhead", key: "h" }, "\u00a0"),
                h("div", { className: "dshc-hourrail", key: "r" }, hourMarks.map((minutes) => h("div", {
                    className: "dshc-hourlabel",
                    key: "h" + minutes,
                    style: { top: offsetOf(minutes) + "px" }
                }, pad2(Math.floor(minutes / 60)) + ":00")))
            ]);
            const dayColumns = days.map((day) => {
                const key = dayKey(day);
                const dayTimed = timed.filter((event) => daysOfEvent(event).some((d) => dayKey(d) === key));
                const laneEnds = [];
                const placed = dayTimed.slice().sort((a, b) => startDate(a) - startDate(b)).map((event) => {
                    const from = startDate(event), to = endDate(event);
                    let lane = laneEnds.findIndex((endMs) => endMs <= from.getTime());
                    if (lane === -1) {
                        lane = laneEnds.length;
                        laneEnds.push(0);
                    }
                    laneEnds[lane] = to.getTime();
                    return { event, lane };
                });
                const laneCount = Math.max(1, laneEnds.length);
                const laneStyle = (lane) => ({ left: "calc(" + (lane * (100 / laneCount)) + "% + 2px)", width: "calc(" + (100 / laneCount) + "% - 4px)" });
                const blocks = placed.map(({ event, lane }) => {
                    const from = startDate(event), to = endDate(event);
                    const top = offsetOf(from.getHours() * 60 + from.getMinutes());
                    // 最小 14px：再矮也看得见一条，文字由 CSS 容器查询分级收起。
                    const height = Math.max(14, ((to - from) / 60000) * (hourPx / 60));
                    const dragging = ghost !== null && ghost.uid === event.uid;
                    return h("div", {
                        key: event.uid,
                        role: "button",
                        tabIndex: 0,
                        "data-uid": event.uid,
                        className: "dshc-slot " + eventClass(event) + (dragging ? " dragging" : ""),
                        style: Object.assign({ top: top + "px", height: height + "px" }, laneStyle(lane)),
                        title: event.summary + " " + hhmm(from) + "\u2013" + hhmm(to) + (canEdit === true ? " · " + t("drag.moveTitle") : ""),
                        onPointerDown: (e) => beginDrag(event, e, "move"),
                        onKeyDown: (e) => onKeyDown(event, e),
                        onClick: (clickEvent) => {
                            // slot 是 daycol 的子节点：不挡住冒泡的话，点事件会同时触发 daycol 的「新建」。
                            clickEvent.stopPropagation();
                            if (suppressClick.current === true) {
                                suppressClick.current = false;
                                return;
                            }
                            onPick(event);
                        }
                    }, h("div", { className: "dshc-slot-title" }, event.summary), h("div", { className: "dshc-slot-time" }, hhmm(from) + "\u2013" + hhmm(to)), canEdit === true ? h("div", { className: "dshc-resize", title: t("drag.resizeTitle"), onPointerDown: (e) => { e.stopPropagation(); beginDrag(event, e, "resize"); } }) : null);
                });
                const ghostBlock = ghost !== null && ghost.slot.dayKey === key
                    ? h("div", {
                        className: "dshc-slot dshc-ghost" + (ghost.conflicts > 0 ? " conflict" : ""),
                        style: Object.assign({ top: offsetOf(ghost.slot.minutes) + "px", height: Math.max(14, ghost.slot.durationMinutes * (hourPx / 60)) + "px" }, laneStyle(0)),
                        key: "__ghost"
                    }, h("div", { className: "dshc-slot-title" }, ghost.conflicts > 0 ? t("drag.conflict", { n: ghost.conflicts }) + " · " + t("drag.keep") : t("drag.drop")), h("div", { className: "dshc-slot-time" }, pad2(Math.floor(ghost.slot.minutes / 60)) + ":" + pad2(ghost.slot.minutes % 60) + " \u2192 " + pad2(Math.floor((ghost.slot.minutes + ghost.slot.durationMinutes) / 60)) + ":" + pad2((ghost.slot.minutes + ghost.slot.durationMinutes) % 60)))
                    : null;
                // 表头 + 时间轴两段：表头固定高度，时间轴 flex:1（高度由容器实测，见 timelineHeight）。
                const decor = dayDecorOf(day);
                const lunarLabel = lunarLabelOf(decor, UI_LANG !== "en");
                const badge = holidayBadgeOf(decor);
                const period = cycleInfoOf(cycle, key);
                return h("div", { key, className: "dshc-weekcol" }, [
                    h("div", { className: "dshc-dayhead" + (badge !== null ? " dshc-" + badge.type : "") }, [
                        h("b", null, String(day.getDate())),
                        " ", relativeDay(day),
                        lunarLabel !== null ? h("span", { className: "dshc-lunar", title: decor.lunar.full }, lunarLabel) : null,
                        badge !== null ? h("span", { className: "dshc-hbadge dshc-inline " + badge.type, title: badge.title }, badge.label) : null,
                        period !== null ? h("i", { key: "period", className: "dshc-period-mark", title: t("cycle.mark", { n: period.day }), "aria-hidden": "true" }) : null
                    ]),
                    h("div", {
                        className: "dshc-daycol" + (key === today ? " today" : ""),
                        "data-day": key,
                        onClick: (clickEvent) => {
                            // 只有点在格子空白处才新建：拖拽结束后的 click 可能落在 daycol 上，靠 suppressClick 兜住。
                            if (clickEvent.target !== clickEvent.currentTarget)
                                return;
                            if (suppressClick.current === true)
                                return;
                            onCreateAt(day);
                        },
                        title: t("action.new")
                    }, blocks.concat(ghostBlock === null ? [] : [ghostBlock]))
                ]);
            });
            // 全天日程压成一行小药丸：原来是整块 Row，多几条就把时间轴挤没了。
            const allDayStrip = allDay.length === 0 ? null : h("div", { className: "dshc-allday", key: "__allday" }, allDay.slice(0, 8).map((event) => h("button", {
                key: event.uid,
                type: "button",
                className: "dshc-allday-pill " + eventClass(event),
                title: event.summary,
                onClick: () => onPick(event)
            }, event.summary)).concat(allDay.length > 8 ? [h("span", { className: "dshc-allday-more", key: "__more" }, "+" + (allDay.length - 8))] : []));
            // 窗口外的时段不再额外标注：时间轴是按本周日程开的窗，用户看到的第一格就是当天第一件事，
            // 再挂一条「00:00 – 09:00 已压缩」只会占掉本来就紧张的高度（用户明确要求去掉）。
            return h("div", { className: "dshc-view" }, [
                allDayStrip,
                h("div", { className: "dshc-week", key: "__week", ref: scroller, style: { "--hour-h": hourPx + "px", "--line-h": hourPx * labelStep + "px", "--timeline-h": timelineHeight + "px" } }, [hoursColumn].concat(dayColumns))
            ]);
        }
        /** 议程视图：从今天起按天分组，最像「接下来要干什么」。这里不画经期横线（用户要求只在日期网格里提示）。 */
        function AgendaView(props) {
            const { events, onPick, onCreateAt } = props;
            const groups = [];
            const index = {};
            for (const event of sortForDisplay(events)) {
                const day = startOfDay(startDate(event));
                const key = dayKey(day);
                if (index[key] === undefined) {
                    index[key] = groups.length;
                    groups.push({ day, key, items: [] });
                }
                groups[index[key]].items.push(event);
            }
            if (groups.length === 0)
                return h("div", { className: "dshc-empty" }, t("state.empty"));
            return h("div", { className: "dshc-agenda" }, groups.map((group) => {
                const decor = dayDecorOf(group.day);
                const lunarLabel = lunarLabelOf(decor, UI_LANG !== "en");
                const badge = holidayBadgeOf(decor);
                return h("div", { className: "dshc-daygroup", key: group.key }, [
                    h("div", { className: "dshc-daylabel" }, [
                        h("b", null, formatDay(group.day)),
                        h("span", { className: "dshc-sub" }, relativeDay(group.day)),
                        lunarLabel !== null ? h("span", { className: "dshc-lunar" + (decor.lunar.festival !== null ? " festival" : ""), title: decor.lunar.full }, lunarLabel) : null,
                        badge !== null ? h("span", { className: "dshc-hbadge dshc-inline " + badge.type, title: badge.title }, badge.label) : null,
                        h("span", { className: "dshc-spacer" }),
                        h("button", { type: "button", className: "dshc-btn ghost", onClick: () => onCreateAt(group.day) }, t("action.new"))
                    ]),
                    group.items.map((event) => h(Row, { key: event.uid, event, onClick: onPick }))
                ]);
            }));
        }
        // ───────────────────────────── 悬浮面板的样式补充 ─────────────────────────────
        const CSS_EXTRA = [
            ".dshc-fab{position:fixed;right:18px;bottom:88px;z-index:55;width:38px;height:38px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-elevation-prominent,0 6px 18px rgba(0,0,0,.18));cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:.62;transition:opacity .15s,transform .15s}",
            ".dshc-fab:hover{opacity:1;transform:translateY(-1px)}",
            ".dshc-fab.on{opacity:1;background:var(--dsw-alias-button-primary-fill,#2563eb);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}",
            ".dshc-float{position:fixed;right:18px;bottom:136px;z-index:56;box-sizing:border-box;width:min(760px,calc(100vw - 36px));height:640px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:16px;box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.28));padding:14px}",
            ".dshc-float .dshc-root{height:100%;display:flex;flex-direction:column;min-height:0}.dshc-float .dshc-shell{border:0;padding:0;background:transparent;display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}.dshc-float .dshc-toolbar,.dshc-float .dshc-footer,.dshc-float .dshc-alert,.dshc-float .dshc-undo,.dshc-float .dshc-refresh{flex:0 0 auto}.dshc-float .dshc-view{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}.dshc-float .dshc-dowgrid{flex:0 0 auto}.dshc-float .dshc-monthgrid{flex:1;min-height:0;grid-template-rows:repeat(6,minmax(0,1fr))}.dshc-float .dshc-cell{min-height:0;overflow:hidden;padding:4px 5px}.dshc-float .dshc-chip{display:block;width:100%;height:15px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 0 2px;font-size:11px}.dshc-float .dshc-more{font-size:10px;line-height:15px}.dshc-float .dshc-week{flex:1;min-height:0;max-height:none;overflow:hidden}.dshc-float .dshc-agenda{flex:1;min-height:0;max-height:none;overflow:auto}",
            ".dshc-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 12px;align-items:start}.dshc-fields .dshc-field.wide{grid-column:1/-1}@media (max-width:520px){.dshc-fields{grid-template-columns:1fr}}.dshc-steps{margin:2px 0 10px;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280)}.dshc-discover{display:flex;flex-direction:column;gap:6px;margin:8px 0 2px;padding:8px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.38));border-radius:9px}.dshc-linkbtn{display:inline-block;margin-top:4px;padding:0;border:0;background:none;color:var(--dsw-alias-state-business-primary,#2563eb);font:inherit;font-size:11px;cursor:pointer;text-decoration:underline}",,
            ".dshc-steps summary{cursor:pointer;color:var(--dsw-alias-state-business-primary,#2563eb)}",
            ".dshc-steps ol{margin:6px 0 0;padding-left:18px;line-height:1.55}",
            ".dshc-link{color:var(--dsw-alias-state-business-primary,#2563eb);text-decoration:none}",
        ].join("");
        // ───────────────────────────── 数据 ─────────────────────────────
        /** 去掉毫秒：后端的 assertIsoTime 只认秒级 ISO，浏览器 toISOString 带 .000Z。 */
        function isoOf(date) { return date.toISOString().replace(/\.\d{3}Z$/, "Z"); }
        function rangeOf(view, anchor) {
            if (view === "week") {
                const from = startOfWeek(anchor);
                return { start: isoOf(from), end: isoOf(addDays(from, 7)) };
            }
            if (view === "agenda") {
                const from = startOfDay(new Date());
                return { start: isoOf(from), end: isoOf(addDays(from, 30)) };
            }
            const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
            const from = startOfWeek(first);
            return { start: isoOf(from), end: isoOf(addDays(from, 42)) };
        }
        /**
         * 跨会话缓存。从别的会话点回日历页，React 会把整棵树卸载再重建，
         * 组件内的 ref / state 跟着一起没 —— 所以「上次拿到的数据」必须放在模块作用域，
         * 否则每次回来都是一次空白 → 骨架屏 → 内容的三段闪（用户明确说体验割裂）。
         *
         * 规则：
         *   · 有缓存就先拿它渲染 —— 第一帧就是完整内容，不出骨架；
         *   · 缓存新鲜（TTL 内）就不再发请求，进出页面、切视图都算命中；
         *   · 缓存过期：先显示旧的，再在后台悄悄刷新，成功后原地替换，全程不出骨架；
         *   · 点「刷新」（reloadToken 变）一定重新拉，不受 TTL 限制。
         */
        const DATA_CACHE = new Map();
        const DATA_TTL_MS = 60000;
        const DATA_CACHE_LIMIT = 8;
        /**
         * 数据版本戳：设置页导入 ICS 成功后调用 invalidateCalendarData()，
         * 侧栏下次进来（或切视图）会跳过缓存命中、在后台拉一次新的；
         * 首帧仍然显示缓存内容，所以不会闪回骨架屏。
         */
        let DATA_VERSION = 0;
        function invalidateCalendarData() { DATA_VERSION += 1; }
        /** 连接信息同理：它是另一个请求，回来时 `configured === null` 也会走骨架屏。 */
        const CONN_CACHE = { value: null, at: 0 };
        /**
         * 拉一个时间窗的事件。
         *
         * 曾经「没命中就退到最近一次拿到的窗口」，结果切视图时先把上一个视图的日程画出来，
         * 等请求回来再整片替换 —— 用户看到的就是「旧日程一闪」。现在只认精确命中。
         * 关键约束：**切视图的第一帧就必须是那个窗口的数据**，不能先用上一份顶着。
         * 做法是把 cache 读取放进 render（同步），而不是等 useEffect 再 setState。
         *   · 精确缓存命中 → 首帧直接画缓存；过期也只是「后台刷新」，同一窗口数据不整片闪；
         *   · 没有缓存       → 显示加载动画，不拿别的窗口的数据冒充；
         *   · 点刷新         → 保留当前窗口数据，只显示一条细进度线，回来后原地替换。
         */
        function useCalendarData(range, reloadToken) {
            const key = range.start + "|" + range.end;
            const lastToken = useRef(reloadToken);
            const isFresh = (entry) => entry !== undefined && entry.version === DATA_VERSION && Date.now() - entry.at < DATA_TTL_MS;
            const fromCache = (k) => {
                const entry = DATA_CACHE.get(k);
                if (entry === undefined)
                    return { key: k, events: null, loading: true, refreshing: false, error: null, configured: true };
                return { key: k, events: entry.events, loading: false, refreshing: !isFresh(entry), error: null, configured: true };
            };
            const [state, setState] = useState(() => fromCache(key));
            // key 变了而 effect 还没跑：同步用当前窗口的缓存渲染，避免跨窗口串数据。
            const display = state.key === key ? state : fromCache(key);
            useEffect(() => {
                const bumped = reloadToken !== lastToken.current;
                lastToken.current = reloadToken;
                const cached = DATA_CACHE.get(key);
                if (bumped !== true && isFresh(cached)) {
                    setState((prev) => ({ key, events: cached.events, loading: false, refreshing: false, error: null, configured: prev.key === key ? prev.configured : true }));
                    return () => { };
                }
                let alive = true;
                // 有同窗口缓存就只标记 refreshing；没有缓存才出加载动画。
                setState((prev) => ({
                    key,
                    events: cached !== undefined ? cached.events : null,
                    loading: cached === undefined,
                    refreshing: cached !== undefined,
                    error: null,
                    configured: prev.key === key ? prev.configured : true,
                }));
                api("list", { start: range.start, end: range.end, expand: true, maxOccurrences: 300 })
                    .then((value) => {
                        if (!alive) return;
                        const events = (value && value.events) || [];
                        DATA_CACHE.set(key, { events, at: Date.now(), version: DATA_VERSION });
                        while (DATA_CACHE.size > DATA_CACHE_LIMIT) DATA_CACHE.delete(DATA_CACHE.keys().next().value);
                        setState({ key, loading: false, refreshing: false, error: null, events, configured: true });
                    })
                    .catch((error) => { if (alive) setState((prev) => ({
                        key,
                        events: prev.key === key ? prev.events : (cached !== undefined ? cached.events : null),
                        loading: false, refreshing: false, error,
                        configured: error && error.code !== "not-configured",
                    })); });
                return () => { alive = false; };
            }, [key, reloadToken]);
            return display;
        }
        /**
         * 量一个元素的高度（ResizeObserver）。
         *
         * 周视图的时间轴是从「可用高度」反算的，不能再用 100dvh 猜 —— 猜出来永远差一点，
         * 差一点就是一个滚动条。没有 ResizeObserver（老宿主 / 冒烟测试）时返回 0，
         * 调用方用 fallback 顶上。
         */
        function useElementHeight(ref, fallback, cacheKey) {
            // 切视图会重建 DOM：先拿上一次的实测值垫着，第一帧就不会「先缩一下再弹回来」。
            const [height, setHeight] = useState(() => (cacheKey !== undefined && HEIGHT_CACHE.has(cacheKey) ? HEIGHT_CACHE.get(cacheKey) : 0));
            useEffect(() => {
                const node = ref.current;
                if (node === null || node === undefined)
                    return () => { };
                const read = () => {
                    const next = Math.round(node.getBoundingClientRect().height);
                    if (next > 0) {
                        if (cacheKey !== undefined)
                            HEIGHT_CACHE.set(cacheKey, next);
                        setHeight(next);
                    }
                };
                read();
                if (typeof ResizeObserver !== "function")
                    return () => { };
                const observer = new ResizeObserver(read);
                observer.observe(node);
                return () => observer.disconnect();
            }, []);
            return height > 0 ? height : fallback;
        }
        /** 量过的高度按 key 记住（见 useElementHeight 的 cacheKey）。 */
        const HEIGHT_CACHE = new Map();
        // ───────────────────────────── 表单 ─────────────────────────────
        /** 事件 → 表单草稿（日期与时间都按浏览器本地时区拆开给 datetime-local 用）。 */
        function draftOfEvent(event) {
            const allDay = event.allDay === true;
            const s = startDate(event);
            const rawEnd = endDate(event);
            // 全天事件的 DTEND 是「次日零点」：编辑时退一天，否则用户会看到莫名多一天。
            const e = allDay ? addDays(rawEnd, -1) : rawEnd;
            const draft = {
                uid: event.uid,
                isSeries: isRecurring(event),
                summary: event.summary || "",
                date: dayKey(s),
                startTime: pad2(s.getHours()) + ":" + pad2(s.getMinutes()),
                endTime: pad2(e.getHours()) + ":" + pad2(e.getMinutes()),
                allDay,
                location: event.location || "",
                description: event.description || "",
                repeat: repeatKeyOf(event.rrule),
                rrule: event.rrule || ""
            };
            if (!allDay) draft.sourceRange = { date: draft.date, startTime: draft.startTime, endTime: draft.endTime, start: isoOf(s), end: isoOf(rawEnd) };
            return draft;
        }
        /** 新建表单：默认落在被点的那一天，上午 10:00–11:00（日历产品的惯例）。 */
        function draftAt(date, hour) {
            const d = date || new Date();
            const startHour = typeof hour === "number" ? hour : 10;
            return {
                uid: undefined,
                summary: "",
                date: dayKey(d),
                startTime: pad2(startHour) + ":00",
                endTime: pad2(Math.min(23, startHour + 1)) + ":00",
                allDay: false,
                location: "",
                description: "",
                repeat: "",
                rrule: ""
            };
        }
        function repeatKeyOf(rrule) {
            if (!rrule)
                return "";
            const freq = /FREQ=([A-Z]+)/i.exec(rrule);
            if (!freq)
                return "custom";
            const value = freq[1].toUpperCase();
            const simple = rrule.replace(/FREQ=[A-Z]+;?/i, "").replace(/^;|;$/g, "");
            if (simple !== "")
                return "custom";
            if (value === "DAILY")
                return "daily";
            if (value === "WEEKLY")
                return "weekly";
            if (value === "MONTHLY")
                return "monthly";
            if (value === "YEARLY")
                return "yearly";
            return "custom";
        }
        function rruleForRepeat(repeat) {
            if (repeat === "daily")
                return "FREQ=DAILY";
            if (repeat === "weekly")
                return "FREQ=WEEKLY";
            if (repeat === "monthly")
                return "FREQ=MONTHLY";
            if (repeat === "yearly")
                return "FREQ=YEARLY";
            return "";
        }
        /** 草稿 → 后端字段（全天走 DATE，定时走本地时间换算出的 UTC 秒级 ISO）。 */
        function fieldsOfDraft(draft) {
            const fields = { summary: draft.summary.trim(), location: draft.location.trim(), description: draft.description.trim(), ...(draft.isSeries ? { scope: "series" } : {}) };
            if (draft.allDay === true) {
                fields.start = draft.date;
                fields.end = dayKey(addDays(new Date(draft.date + "T00:00:00"), 1));
                fields.allDay = true;
            }
            else {
                if (!/^\d{2}:\d{2}$/.test(draft.startTime || '') || !/^\d{2}:\d{2}$/.test(draft.endTime || '')) throw new Error(calendarText('请补全起止时间','Complete the start and end times'));
                const start = new Date(draft.date + "T" + (draft.startTime || "00:00") + ":00");
                const end = new Date(draft.date + "T" + (draft.endTime || "00:00") + ":00");
                const source = draft.sourceRange, sameDate = source && source.date === draft.date;
                fields.start = sameDate && source.startTime === draft.startTime ? source.start : isoOf(start);
                fields.end = sameDate && source.endTime === draft.endTime ? source.end : isoOf(end);
                fields.allDay = false;
            }
            const rrule = draft.repeat === "custom" ? (draft.rrule || "").trim() : rruleForRepeat(draft.repeat);
            if (rrule !== "")
                fields.rrule = rrule;
            else if (draft.uid !== undefined)
                fields.rrule = "";
            return fields;
        }
        /** 草稿算出来的临时事件，用来做冲突检测（不落盘）。 */
        function asPseudoEvent(draft) {
            try {
                const fields = fieldsOfDraft(draft);
                return { uid: "__draft", summary: fields.summary || "(未命名)", start: fields.start, end: fields.end, allDay: draft.allDay === true };
            } catch { return null; }
        }
        function EventForm(props) {
            const { draft, events, onCancel, onSubmit, busy, error } = props;
            const formId = useId();
            const [form, setForm] = useState(draft);
            useEffect(() => { setForm(draft); }, [draft.uid, draft.date, draft.startTime, draft.summary]);
            const patch = (fields) => setForm((prev) => Object.assign({}, prev, fields));
            const isEdit = draft.uid !== undefined;
            const pseudo = asPseudoEvent(form);
            const conflicts = form.summary.trim() === "" || !pseudo ? [] : events.filter((event) => overlaps(event, pseudo) && event.uid !== form.uid);
            const canSave = form.summary.trim() !== "" && !!pseudo && Date.parse(pseudo.end) >= Date.parse(pseudo.start);
            const body = h("div", null, [
                form.sourceRange && !form.allDay && pseudo ? h('p',{className:'dshe-hint',role:'note'},calendarText('实际时段：','Resolved time: ')+[pseudo.start,pseudo.end].map(iso=>new Intl.DateTimeFormat(UI_LANG==='en'?'en-US':'zh-CN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'}).format(new Date(iso))).join(' — ')+calendarText('。未修改的钟点保留原 UTC 偏移。',' · Unchanged times preserve their original UTC offsets.')) : null,
                draft.isSeries ? h("div", { className: "dshc-alert" }, t("form.series")) : null,
                error ? h("div", { className: "dshc-alert error" }, error) : null,
                h("div", { className: "dshc-field" }, [
                    h("label", { htmlFor: formId + "-summary" }, t("field.summary")),
                    h(Txt, { id: formId + "-summary", value: form.summary, autoFocus: true, onChange: (e) => patch({ summary: e.target.value }), placeholder: t("form.newTitle") })
                ]),
                h("div", { className: "dshc-field" }, [
                    h("label", { htmlFor: formId + "-date" }, t("field.date")),
                    h(Txt, { id: formId + "-date", type: "date", value: form.date, onChange: (e) => patch({ date: e.target.value }) })
                ]),
                form.allDay === true ? null : h("div", { className: "dshc-two" }, [
                    h("div", { className: "dshc-field" }, [h("label", { htmlFor: formId + "-start" }, t("field.start")), h(Txt, { id: formId + "-start", type: "time", value: form.startTime, onChange: (e) => patch({ startTime: e.target.value }) })]),
                    h("div", { className: "dshc-field" }, [h("label", { htmlFor: formId + "-end" }, t("field.end")), h(Txt, { id: formId + "-end", type: "time", value: form.endTime, onChange: (e) => patch({ endTime: e.target.value }) })])
                ]),
                h("div", { className: "dshc-field" }, [h(Chk, { checked: form.allDay === true, label: t("field.allDay"), onChange: (next) => patch({ allDay: next }) })]),
                h("div", { className: "dshc-field" }, [
                    h("label", { htmlFor: formId + "-repeat" }, t("field.repeat")),
                    h("select", { id: formId + "-repeat", className: "dshc-input", value: form.repeat, onChange: (e) => patch({ repeat: e.target.value }) }, [
                        h("option", { value: "", key: "none" }, t("repeat.none")),
                        h("option", { value: "daily", key: "d" }, t("repeat.daily")),
                        h("option", { value: "weekly", key: "w" }, t("repeat.weekly")),
                        h("option", { value: "monthly", key: "m" }, t("repeat.monthly")),
                        h("option", { value: "yearly", key: "y" }, t("repeat.yearly")),
                        h("option", { value: "custom", key: "c" }, t("repeat.custom"))
                    ])
                ]),
                form.repeat === "custom" ? h("div", { className: "dshc-field" }, [
                    h("label", { htmlFor: formId + "-rrule" }, "RRULE"),
                    h(Txt, { id: formId + "-rrule", value: form.rrule, placeholder: "FREQ=WEEKLY;COUNT=10", onChange: (e) => patch({ rrule: e.target.value }) })
                ]) : null,
                h("div", { className: "dshc-field" }, [h("label", { htmlFor: formId + "-location" }, t("field.location")), h(Txt, { id: formId + "-location", value: form.location, onChange: (e) => patch({ location: e.target.value }) })]),
                h("div", { className: "dshc-field" }, [
                    h("label", { htmlFor: formId + "-description" }, t("field.description")),
                    h("textarea", { id: formId + "-description", className: "dshc-input", value: form.description, onChange: (e) => patch({ description: e.target.value }) })
                ]),
                conflicts.length > 0 ? h("div", { className: "dshc-alert warn" }, [
                    h("div", null, [
                        h("div", null, t("conflict.title", { n: conflicts.length })),
                        conflicts.slice(0, 3).map((event) => h("div", { key: event.uid }, "\u2022 " + formatWhen(event) + " " + event.summary)),
                        h("div", { className: "dshc-sub" }, t("conflict.hint"))
                    ])
                ]) : null
            ]);
            const footer = h("div", { className: "dshc-actions" }, [
                h(Btn, { key: "cancel", variant: "ghost", onClick: onCancel, disabled: busy === true }, t("action.cancel")),
                h(Btn, { key: "save", variant: "primary", onClick: () => onSubmit(form), disabled: busy === true || canSave !== true }, busy === true ? "\u2026" : t("action.save"))
            ]);
            return h(Dlg, {
                open: true,
                onClose: onCancel,
                title: isEdit ? t("form.editTitle") : t("form.newTitle"),
                children: body,
                footer: footer
            });
        }
        // ───────────────────────────── 详情抽屉 ─────────────────────────────
        function EventDrawer(props) {
            const { event, onClose, onEdit, onDelete, busy, confirmDelete, setConfirmDelete, events, readOnly } = props;
            const [copied, setCopied] = useState(false);
            const seriesCount = event.isOccurrence ? events.filter((e) => e.seriesStart === event.seriesStart).length : 0;
            return h("div", { className: "dshc-overlay", onMouseDown: (e) => { if (e.target === e.currentTarget)
                    onClose(); } }, [
                h("div", { className: "dshc-drawer", style: { position: "relative" } }, [
                    h("button", { type: "button", className: "dshc-btn ghost dshc-close", onClick: onClose, "aria-label": "close" }, "\u2715"),
                    h("div", { className: "dshc-drawertitle" }, event.summary),
                    h("div", { className: "dshc-sub" }, [
                        formatWhen(event),
                        h("span", { className: "dshc-tag" }, formatDuration(event))
                    ].filter(Boolean)),
                    h("dl", { className: "dshc-kv" }, [
                        event.rrule ? h("dt", { key: "rdt" }, t("repeat.recurring")) : null,
                        event.rrule ? h("dd", { key: "rdd" }, humanRepeat(event.rrule) + " · " + event.rrule) : null,
                        event.isOccurrence && !event.rrule ? h("dt", { key: "odt" }, t("repeat.occurrence")) : null,
                        event.isOccurrence && !event.rrule ? h("dd", { key: "odd" }, (seriesCount > 0 ? seriesCount + " / " : "") + t("repeat.occurrence")) : null,
                        event.location ? h("dt", { key: "ldt" }, t("field.location")) : null,
                        event.location ? h("dd", { key: "ldd" }, event.location) : null,
                        event.description ? h("dt", { key: "ddt" }, t("field.description")) : null,
                        event.description ? h("dd", { key: "ddd", style: { whiteSpace: "pre-wrap" } }, event.description) : null,
                        h("dt", { key: "udt" }, t("field.uid")),
                        h("dd", { key: "udd" }, h("span", { className: "dshc-mono" }, event.uid))
                    ].filter(Boolean)),
                    h("div", { className: "dshc-actions" }, [
                        h(Btn, { key: "copy", onClick: async () => { const ok = await copyText(event.uid); if (ok) {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1600);
                            } } }, copied ? t("action.copied") : t("action.copy")),
                        h("span", { className: "dshc-spacer" }),
                        confirmDelete
                            ? h(Btn, { key: "confirm", variant: "primary", disabled: busy === true || readOnly === true, onClick: () => onDelete(event) }, t("action.confirmDelete"))
                            : h(Btn, { key: "delete", variant: "danger", onClick: () => setConfirmDelete(true), disabled: busy === true || readOnly === true }, t("action.delete")),
                        h(Btn, { key: "edit", variant: "outline", onClick: () => onEdit(event), disabled: busy === true || readOnly === true }, t("action.edit"))
                    ]),
                    confirmDelete ? h("div", { className: "dshc-sub", style: { textAlign: "right", marginTop: "6px" } }, t(isRecurring(event) ? "confirm.deleteSeries" : "confirm.delete", { name: event.summary })) : null
                ])
            ]);
        }
        // ───────────────────────────── 连接设置 ─────────────────────────────
        /** 每个服务商要填哪些格子。顺序就是表单里的顺序。 */
        const PROVIDER_FIELDS = {
            google: ["calendarId", "clientId", "clientSecret", "refreshToken", "tokenUrl", "proxyUrl"],
            icloud: ["caldavUrl", "username", "password", "proxyUrl"],
            nextcloud: ["host", "user", "username", "calendar", "password", "proxyUrl"],
            custom: ["caldavUrl", "username", "password", "proxyUrl"]
        };
        const FIELD_LABEL = {
            caldavUrl: "conn.caldavUrl", username: "conn.username", password: "conn.password",
            host: "conn.host", user: "conn.user", calendar: "conn.calendar", calendarId: "conn.calendarId",
            clientId: "conn.clientId", clientSecret: "conn.clientSecret", refreshToken: "conn.refreshToken",
            tokenUrl: "conn.tokenUrl", proxyUrl: "conn.proxyUrl"
        };
        const SECRET_FIELDS = ["password", "clientSecret", "refreshToken"];
        const PROVIDER_HINT = { google: "conn.googleHint", icloud: "conn.icloudHint", nextcloud: "conn.nextcloudHint", custom: "conn.customHint" };
        /** 字段级小字提示：provider -> 字段 -> 文案 key（没有就不显示）。 */
        const FIELD_HINT = {
            google: { calendarId: "hint.calendarId.google", refreshToken: "hint.refreshToken.google", clientId: "hint.clientId.google", tokenUrl: "hint.tokenUrl" },
            icloud: { caldavUrl: "hint.caldavUrl.icloud", username: "hint.username.icloud", password: "hint.password.icloud" },
            nextcloud: { host: "hint.host.nextcloud", user: "hint.user.nextcloud", username: "hint.username.nextcloud", calendar: "hint.calendar.nextcloud" },
            custom: { caldavUrl: "hint.caldavUrl.custom", username: "hint.username.custom" }
        };
        /** 「怎么拿到这些值」的步骤 + 外链（两边语言各一份文案，链接是共用的）。 */
        const PROVIDER_LINKS = {
            google: [
                { href: "https://console.cloud.google.com/apis/credentials", key: "link.googleConsole" },
                { href: "https://developers.google.com/oauthplayground", key: "link.googlePlayground" }
            ],
            icloud: [{ href: "https://appleid.apple.com/account/manage", key: "link.appleId" }],
            nextcloud: [],
            custom: []
        };
        const PROVIDER_NAMES = ["google", "icloud", "nextcloud", "custom"];
        /** 面板上的连接摘要 → 表单草稿。密钥一律留空，靠 placeholder 说明「已保存」。 */
        function connectionDraftOf(connection) {
            const out = { provider: "" };
            for (const key of Object.keys(FIELD_LABEL))
                out[key] = "";
            if (connection) {
                for (const key of Object.keys(out)) {
                    if (typeof connection[key] === "string")
                        out[key] = connection[key];
                }
            }
            return out;
        }
        /** 「当前：icloud · 你@icloud.com」里的那半句。 */
        function connectionSummary(connection) {
            if (connection === null || connection === undefined)
                return "";
            const provider = connection.provider || "custom";
            const account = connection.calendarId || connection.username || connection.user
                || (connection.host ? String(connection.host).replace(/^https?:\/\//, "") : "")
                || connection.caldavUrl || "";
            return account === "" ? provider : provider + " · " + account;
        }
        /**
         * 连接设置表单：填 → 测试 → 保存。保存前服务端还会再测一次（test:true），
         * 所以「保存成功」等价于「这套凭据刚才真的连上了」。
         */
        function ConnectionForm(props) {
            const { connection, onClose, onSaved } = props;
            const formId = useId();
            const [form, setForm] = useState(() => connectionDraftOf(connection));
            const [busy, setBusy] = useState("");
            const [result, setResult] = useState(null);
            // iCloud 自动发现：结果只在本次表单里，选中后填入 caldavUrl。
            const [discovered, setDiscovered] = useState([]);
            const [discoverBusy, setDiscoverBusy] = useState(false);
            const [discoverError, setDiscoverError] = useState(null);
            const [manualUrl, setManualUrl] = useState(false);
            const maySave = connection === null || connection.settingsAvailable !== false;
            const patch = (fields) => {
                setForm((prev) => Object.assign({}, prev, fields));
                setResult(null);
                if (fields.provider !== undefined && fields.provider !== form.provider) {
                    setDiscovered([]);
                    setDiscoverError(null);
                    setManualUrl(false);
                }
            };
            const visible = PROVIDER_FIELDS[form.provider] || [];
            const payload = () => {
                const out = {};
                for (const key of Object.keys(FIELD_LABEL)) {
                    const value = form[key];
                    if (typeof value !== "string")
                        continue;
                    // 密钥留空 = 保持已存的那一份；其余字段空串服务端也按「保持不变」处理。
                    if (SECRET_FIELDS.indexOf(key) !== -1 && value.trim() === "")
                        continue;
                    out[key] = value.trim();
                }
                if (form.provider !== "")
                    out.provider = form.provider;
                if (form.provider === "google")
                    out.authMethod = "oauth";
                else if (form.provider !== "" && connection && form.provider !== connection.provider)
                    out.authMethod = "basic";
                return out;
            };
            const test = async () => {
                setBusy("test");
                setResult(null);
                try {
                    const value = await api("testConnection", payload());
                    const sample = (value.sample || []).join("、");
                    setResult({ ok: true, text: t("conn.ok", { n: value.count }) + (sample === "" ? "" : t("conn.okSample", { sample })) });
                }
                catch (error) {
                    setResult({ ok: false, text: backendMessage(error) });
                }
                finally {
                    setBusy("");
                }
            };
            const save = async () => {
                setBusy("save");
                setResult(null);
                try {
                    onSaved(await api("saveConnection", Object.assign({}, payload(), { test: true })));
                }
                catch (error) {
                    setResult({ ok: false, text: backendMessage(error) });
                }
                finally {
                    setBusy("");
                }
            };
            const discover = async () => {
                setDiscoverBusy(true);
                setDiscoverError(null);
                setDiscovered([]);
                try {
                    const value = await api("discoverIcloud", {
                        username: form.username || "",
                        password: form.password || "",
                        proxyUrl: form.proxyUrl || ""
                    });
                    const calendars = value.calendars || [];
                    setDiscovered(calendars);
                    if (calendars.length > 0) patch({ caldavUrl: calendars[0].url });
                    setManualUrl(false);
                }
                catch (error) {
                    const raw = backendMessage(error) || t("error.load");
                    setDiscoverError(/未知动作/.test(raw) ? t("conn.discoverStale") : raw);
                }
                finally {
                    setDiscoverBusy(false);
                }
            };
            const body = h("div", null, [
                h("div", { className: "dshc-sub", style: { marginBottom: "10px" } }, t("conn.intro")),
                h("p", { className: "dshc-sub", style: { marginBottom: "10px" } }, t("conn.credentials")),
                maySave !== true
                    ? h("div", { className: "dshc-alert warn" }, t("conn.noSettings"))
                    : null,
                h("div", { className: "dshc-field" }, [
                    h("label", { htmlFor: formId + "-provider" }, t("conn.provider")),
                    h("select", { id: formId + "-provider", className: "dshc-input", "aria-label": t("conn.provider"), value: form.provider, onChange: (e) => patch({ provider: e.target.value }) }, [h("option", { value: "", key: "__none" }, "— " + t("conn.needProvider") + " —")].concat(PROVIDER_NAMES.map((name) => h("option", { value: name, key: name }, name === "custom" ? t("provider.custom") : name === "icloud" ? "iCloud" : name === "nextcloud" ? "Nextcloud" : "Google"))))
                ]),
                PROVIDER_HINT[form.provider] ? h("div", { className: "dshc-sub", style: { marginBottom: "8px" } }, t(PROVIDER_HINT[form.provider])) : null,
                form.provider === "" ? null : h("details", { className: "dshc-steps" }, [
                    h("summary", { key: "sum" }, t("conn.steps")),
                    h("ol", { key: "list" }, (UI[UI_LANG]["steps." + form.provider] || []).map((line, index) => h("li", { key: "s" + index }, line))),
                    (PROVIDER_LINKS[form.provider] || []).length === 0 ? null : h("div", { key: "links", style: { marginTop: "6px", display: "flex", gap: "10px", flexWrap: "wrap" } }, (PROVIDER_LINKS[form.provider] || []).map((link) => h("a", { key: link.href, href: link.href, target: "_blank", rel: "noreferrer", className: "dshc-link" }, t(link.key)))),
                    form.provider === "icloud" ? h("div", { className: "dshc-discover", key: "discover" }, [
                        h(Btn, {
                            key: "find", type: "button",
                            disabled: busy !== "" || discoverBusy || !form.username || !form.password,
                            onClick: discover
                        }, discoverBusy ? t("conn.discovering") : t("conn.discover")),
                        h("span", { key: "hint", className: "dshc-sub" }, t("conn.discoverHint")),
                        discoverError !== null
                            ? h("div", { key: "error", className: "dshc-alert error", role: "alert" }, discoverError)
                            : null,
                        discovered.length > 0
                            ? h("span", { key: "found", className: "dshc-sub", role: "status" }, t("conn.discoverFound", { n: discovered.length }))
                            : null
                    ]) : null,
                ]),
                h("div", { className: "dshc-fields", key: "fields" }, visible.map((key) => {
                    const secret = SECRET_FIELDS.indexOf(key) !== -1;
                    const stored = connection !== null && connection !== undefined && ((key === "password" && connection.hasPassword === true)
                        || (key === "clientSecret" && connection.hasClientSecret === true)
                        || (key === "refreshToken" && connection.hasRefreshToken === true));
                    const hintKey = FIELD_HINT[form.provider] ? FIELD_HINT[form.provider][key] : undefined;
                    const asSelect = key === "caldavUrl" && discovered.length > 0 && manualUrl !== true;
                    const options = asSelect ? discovered.map((item) => ({ value: item.url, label: item.name })) : [];
                    if (asSelect && (form[key] || "") !== "" && !options.some((o) => o.value === form[key])) {
                        options.unshift({ value: form[key], label: form[key] });
                    }
                    return h("div", { className: "dshc-field" + (key === "caldavUrl" || key === "host" ? " wide" : ""), key }, [
                        h("label", { htmlFor: formId + "-" + key }, t(FIELD_LABEL[key])),
                        asSelect ? h("select", {
                            id: formId + "-" + key,
                            className: "dshc-input",
                            "aria-label": t(FIELD_LABEL[key]),
                            value: form[key] || "",
                            onChange: (e) => patch({ [key]: e.target.value })
                        }, options.map((o) => h("option", { key: o.value, value: o.value, title: o.value }, o.label)))
                        : h(Txt, {
                            id: formId + "-" + key,
                            type: secret ? "password" : "text",
                            "aria-label": t(FIELD_LABEL[key]),
                            value: form[key] || "",
                            placeholder: stored ? t("conn.keep") : "",
                            onChange: (e) => patch({ [key]: e.target.value })
                        }),
                        hintKey ? h("div", { className: "dshc-sub", style: { marginTop: "3px" } }, t(hintKey)) : null,
                        asSelect ? h("button", { key: "manual", type: "button", className: "dshc-linkbtn", onClick: () => setManualUrl(true) }, t("conn.manualUrl")) : null
                    ]);
                })),
                result !== null
                    ? h("div", { className: "dshc-alert " + (result.ok === true ? "ok" : "error") }, (result.ok === true ? "✓ " : t("conn.fail") + "：") + result.text)
                    : null,
                h("div", { className: "dshc-actions" }, [
                    h(Btn, { key: "cancel", onClick: onClose, disabled: busy !== "" }, t("action.cancel")),
                    h(Btn, { key: "test", onClick: test, disabled: busy !== "" || form.provider === "" }, busy === "test" ? t("conn.testing") : t("conn.test")),
                    h(Btn, { key: "save", variant: "primary", onClick: save, disabled: busy !== "" || form.provider === "" || maySave !== true }, busy === "save" ? t("conn.saving") : t("conn.save"))
                ]),
                maySave !== true || (connection !== null && connection !== undefined && connection.settingsKind === "file")
                    ? h("div", { className: "dshc-sub", style: { marginTop: "10px" } }, connection !== null && connection !== undefined && connection.settingsKind === "file"
                        ? t("conn.storageFallback")
                        : t("conn.current", { summary: connectionSummary(connection) }))
                    : null
            ]);
            return h(Dlg, { open: true, onClose, title: t("conn.title"), children: body });
        }
        // ───────────────────────────── 主面板 ─────────────────────────────
        // ───────────────────────────── 浮层 Esc 的模块级栈 ─────────────────────────────
        // 一个页面可能同时有多个 CalendarPanel（设置页一节 + 对话页悬浮面板）。如果各自往
        // document 挂捕获监听，stopPropagation 拦不住同阶段的其他监听 —— 一次 Esc 会连关
        // 两层；用全局 querySelector 兜底也会被另一个面板的浮层误触发。这里共用一个捕获
        // 监听，按「焦点所在 root / 最近打开的层」只关一层。
        const LAYER_ESCAPE_STACK = [];
        let layerEscapeListener = null;
        function panelRootOf(node) {
            if (node === null || node === undefined || typeof node.closest !== "function")
                return null;
            return node.closest(".dshc-root");
        }
        /** 目标是否位于别的宿主浮层内（那类浮层会自己处理 Esc）。 */
        function isForeignHostLayer(node) {
            if (node === null || node === undefined || typeof node.closest !== "function")
                return false;
            const layer = node.closest('[role="dialog"], [role="alertdialog"]');
            if (layer === null)
                return false;
            if (layer.closest(".dshc-root") !== null)
                return false;
            if (layer.querySelector('[data-dshc-scope="1"]') !== null)
                return false;
            return true;
        }
        /** 是否有别的宿主浮层盖在上面：有就把 Esc 让给宿主，别关下面的日历层。 */
        function hasForeignHostDialog() {
            const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
            for (let i = 0; i < dialogs.length; i++) {
                const layer = dialogs[i];
                if (layer.closest(".dshc-root") !== null)
                    continue;
                if (layer.querySelector('[data-dshc-scope="1"]') !== null)
                    continue;
                if (layer.hidden === true || layer.getAttribute("aria-hidden") === "true")
                    continue;
                if (typeof window !== "undefined" && window !== null && typeof window.getComputedStyle === "function") {
                    const style = window.getComputedStyle(layer);
                    if (style.display === "none" || style.visibility === "hidden")
                        continue;
                }
                return true;
            }
            return false;
        }
        function registerLayerEscape(root, closeTop) {
            const entry = { root, closeTop };
            LAYER_ESCAPE_STACK.push(entry);
            if (layerEscapeListener === null) {
                layerEscapeListener = (event) => {
                    if (event.key !== "Escape" || event.isComposing === true)
                        return;
                    const target = event.target;
                    // 上层有别的宿主浮层（不是本插件渲染的）时，Esc 归它；
                    // 普通宿主元素（不在任何浮层里）仍然兜底关我们自己的层。
                    if (hasForeignHostDialog() || isForeignHostLayer(target))
                        return;
                    const root = panelRootOf(target);
                    let owner = null;
                    if (root !== null) {
                        for (let i = LAYER_ESCAPE_STACK.length - 1; i >= 0; i--) {
                            const candidate = LAYER_ESCAPE_STACK[i];
                            if (candidate.root !== null && candidate.root.contains(target)) {
                                owner = candidate;
                                break;
                            }
                        }
                    }
                    if (owner === null)
                        owner = LAYER_ESCAPE_STACK[LAYER_ESCAPE_STACK.length - 1] || null;
                    if (owner === null)
                        return;
                    event.preventDefault();
                    event.stopPropagation();
                    owner.closeTop();
                };
                document.addEventListener("keydown", layerEscapeListener, true);
            }
            return () => {
                const index = LAYER_ESCAPE_STACK.indexOf(entry);
                if (index >= 0)
                    LAYER_ESCAPE_STACK.splice(index, 1);
                if (LAYER_ESCAPE_STACK.length === 0 && layerEscapeListener !== null) {
                    document.removeEventListener("keydown", layerEscapeListener, true);
                    layerEscapeListener = null;
                }
            };
        }
        Object.assign(UI.zh, {
            // 首启页：backend 还没选过时占住视图区。只有两个终态，没有「稍后再说」。
            "start.title": "开始使用日历", "start.subtitle": "日程存放的位置由你决定，之后可以在设置里切换。",
            "start.local": "使用本地日历", "start.localHint": "数据保存在本机，无需账号",
            "start.remote": "连接远程日历", "start.remoteHint": "Google、iCloud、Nextcloud 或其他 CalDAV",
            "start.footnote": "本地日历的数据只存在这台电脑上；之后可以在设置里连接远程日历并迁移过去。",
            "source.local": "本地日历", "source.caldav": "CalDAV",
            "source.title": "日历来源", "source.current": "当前使用：{name}",
            "source.switchTo": "切换到{name}",
            "source.switchNote": "切换时会把当前日历的日程复制过去，原有数据不会删除；已存在的和看起来重复的会跳过。",
            "source.switched": "已复制 {n} 条，现在使用{name}。",
            "source.caldavOff": "远程日历还没连接。先到侧栏日历的「日历连接」里填好账号，再回来切换。",
            "source.busy": "正在复制日程…",
            "conn.credentials": "这里填日历账号，不是 DSH 的模型密钥。",
            "import.title": "从 ICS 文件导入日程", "import.intro": "先核对预览，再导入选中的日程。已有相同 UID 的记录会跳过。",
            "import.file": "选择 ICS 文件", "import.noFile": "未选择文件", "import.paste": "或粘贴 ICS 内容", "import.timezone": "未标注时区的时间按", "import.chooseZone": "请主动选择时区", "import.preview": "预览与检查",
            "import.busy": "正在处理…", "import.close": "关闭导入", "import.select": "选择下一批（最多 20 条）", "import.clear": "清除选择", "import.commit": "确认导入 {n} 条",
            "import.ready": "可导入", "import.blocked": "需要修正", "import.duplicate": "已存在，跳过", "import.imported": "已导入", "import.failed": "失败，可重试",
            "import.conflicts": "首场时间与 {n} 条日程重叠，请核对", "import.recurring": "重复系列 · {n} 条例外", "import.scope": "重叠提示检查首场时间，不代表整个重复系列。每批最多 20 个系列；预览保留 15 分钟。",
            "import.ignored": "另有 {n} 个非日程组件未导入。", "import.limit": "ICS 文件最大 256 KiB；每次预览最多 100 个日程系列。", "import.results": "本批：{ok} 条已导入，{duplicate} 条已存在，{failed} 条失败。",
            "import.connection": "连接设置", "import.errorSize": "文件超过 256 KiB，请分批导出。", "import.stopped": "请求已停止；重新预览可核对已写入的日程。", "import.stop": "停止本批",
            "import.retryHint": "重试只处理失败项，成功项不会重复写入。", "import.noReady": "没有可导入的日程，请检查上面的提示。",
            "import.cancel": "取消导入",
            "import.connectionHint": "请先在侧栏日历的「日历连接」中配置账号，再回来导入。",
            "section.settingsSubtitle": "日历来源、经期记录、ICS 导入导出。",
            "ics.title": "ICS 文件", "ics.intro": "可以把别的日历导进来，也可以把当前日历导出成一个 .ics 文件。",
            "import.section": "导入",
            "export.title": "导出", "export.hint": "导出当前日历（{source}）的全部日程，用于备份或导入到别的日历应用。",
            "export.button": "导出 ICS 文件", "export.done": "已导出 {n} 条日程。", "export.failed": "当前环境无法直接触发下载，请检查浏览器设置。",
            "export.busy": "正在导出…", "export.staleServer": "服务端还没加载导出功能：请重启 DSH 后再试。",
            "cycle.title": "经期记录", "cycle.intro": "填上次经期开始日期与平均周期，日历就在预计经期的日期下标一条粉红短线。数据只存本机浏览器，不上传不同步；预测按固定周期推算，仅供备忘。",
            "cycle.lastStart": "上次经期开始日期", "cycle.cycleLength": "平均周期（天）", "cycle.periodLength": "经期持续（天）",
            "cycle.save": "保存", "cycle.clear": "清除记录", "cycle.saved": "已保存", "cycle.cleared": "已清除",
            "cycle.mark": "预计经期第 {n} 天"
        });
        Object.assign(UI.en, {
            "start.title": "Get started", "start.subtitle": "Choose where your events live. You can switch later in settings.",
            "start.local": "Use a local calendar", "start.localHint": "Stored on this machine, no account needed",
            "start.remote": "Connect a remote calendar", "start.remoteHint": "Google, iCloud, Nextcloud or another CalDAV",
            "start.footnote": "Local data never leaves this machine. You can connect a remote calendar later and migrate your events.",
            "source.local": "Local calendar", "source.caldav": "CalDAV",
            "source.title": "Calendar source", "source.current": "Currently using: {name}",
            "source.switchTo": "Switch to {name}",
            "source.switchNote": "Switching copies the current events across; nothing is deleted. Existing and likely-duplicate events are skipped.",
            "source.switched": "Copied {n} events. Now using {name}.",
            "source.caldavOff": "No remote calendar yet. Add an account under \u201cCalendar connection\u201d in the sidebar first.",
            "source.busy": "Copying events\u2026",
            "conn.credentials": "Use your calendar account, not your DSH model key.",
            "import.title": "Import events from ICS", "import.intro": "Review the preview before importing selected events. Existing UIDs are skipped.",
            "import.file": "Choose an ICS file", "import.noFile": "No file selected", "import.paste": "Or paste ICS content", "import.timezone": "Interpret times without a timezone as", "import.chooseZone": "Choose a timezone explicitly", "import.preview": "Preview and check",
            "import.busy": "Working…", "import.close": "Close import", "import.select": "Select next batch (up to 20)", "import.clear": "Clear selection", "import.commit": "Confirm import of {n} events",
            "import.ready": "Ready", "import.blocked": "Needs correction", "import.duplicate": "Already exists; skipped", "import.imported": "Imported", "import.failed": "Failed; retry available",
            "import.conflicts": "The first occurrence overlaps {n} events; please review", "import.recurring": "Recurring series · {n} exceptions", "import.scope": "Overlap checks cover the first occurrence, not the whole series. Up to 20 series per batch; previews expire in 15 minutes.",
            "import.ignored": "{n} non-event components were not imported.", "import.limit": "Up to 256 KiB per file and 100 event series per preview.", "import.results": "Batch: {ok} imported, {duplicate} already present, {failed} failed.",
            "import.connection": "Connection settings", "import.errorSize": "The file exceeds 256 KiB; export smaller batches.", "import.stopped": "Request stopped. Preview again to check which events were saved.", "import.stop": "Stop batch",
            "import.retryHint": "Retry only processes failed items; successful items are not written again.", "import.noReady": "No events are ready to import. Review the messages above.",
            "import.cancel": "Cancel import",
            "import.connectionHint": "Connect a calendar from the sidebar first, then come back to import.",
            "section.settingsSubtitle": "Calendar source, cycle tracking, ICS import and export.",
            "ics.title": "ICS files", "ics.intro": "Import events from another calendar, or export this calendar as an .ics file.",
            "import.section": "Import",
            "export.title": "Export", "export.hint": "Export all events in the current calendar ({source}) for backup or for importing elsewhere.",
            "export.button": "Export ICS file", "export.done": "Exported {n} events.", "export.failed": "This environment cannot start a download; check your browser settings.",
            "export.busy": "Exporting\u2026", "export.staleServer": "The server has not loaded the export action yet. Restart DSH and try again.",
            "cycle.title": "Cycle tracking", "cycle.intro": "Enter your last period start date and average cycle; a short pink line marks predicted period days. Stored in this browser only — never uploaded or synced. Fixed-cycle arithmetic, for reminder only.",
            "cycle.lastStart": "Last period start date", "cycle.cycleLength": "Average cycle (days)", "cycle.periodLength": "Period length (days)",
            "cycle.save": "Save", "cycle.clear": "Clear record", "cycle.saved": "Saved", "cycle.cleared": "Cleared",
            "cycle.mark": "Predicted period day {n}"
        });
        async function importApi(action, payload, signal) {
            const res = await fetch(IMPORT_ROUTE, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-DSH-Calendar-Pro-Import": "1" }, body: JSON.stringify(Object.assign({ action }, payload)), signal });
            let body;
            try {
                body = await res.json();
            }
            catch (e) {
                body = null;
            }
            if (!res.ok || !body || body.ok !== true)
                throw Object.assign(new Error(backendMessage({ message: body && body.message || "HTTP " + res.status, status: res.status })), { status: res.status });
            return body.value;
        }
        function importDate(row) {
            if (!row.start)
                return "";
            if (row.allDay)
                return row.start + (row.end && row.end !== row.start ? " → " + row.end + " (" + (UI_LANG === "en" ? "exclusive end" : "结束日不计入") + ")" : "");
            let timezone = row.timezones && row.timezones[0] || "UTC";
            try {
                new Intl.DateTimeFormat("en", { timeZone: timezone });
            }
            catch (e) {
                timezone = "UTC";
            }
            const fmt = new Intl.DateTimeFormat(UI_LANG === "en" ? "en-GB" : "zh-CN", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
            return fmt.format(new Date(row.start)) + " → " + fmt.format(new Date(row.end || row.start)) + " · " + timezone;
        }
        function IcsImportPanel(props) {
            const [content, setContent] = useState(""), [timezone, setTimezone] = useState(""), [zones, setZones] = useState(["UTC", "Asia/Shanghai", "America/New_York", "Europe/London"]);
            const [fileName, setFileName] = useState("");
            const [exportInfo, setExportInfo] = useState("");
            const [exportError, setExportError] = useState("");
            /** 导出是独立动作：用独立 busy，别去碰导入那套状态（会联动整块表单）。 */
            const [exportBusy, setExportBusy] = useState(false);
            const [preview, setPreview] = useState(null), [selected, setSelected] = useState([]), [results, setResults] = useState({}), [error, setError] = useState(""), [busy, setBusy] = useState(false);
            const controller = useRef(null), alive = useRef(true), fileSequence = useRef(0), fileInput = useRef(null);
            useEffect(() => {
                alive.current = true;
                const abort = new AbortController();
                importApi("zones", {}, abort.signal).then(v => { if (alive.current && Array.isArray(v.zones)) {
                    const common = ["Asia/Shanghai", "UTC", "Asia/Tokyo", "Europe/London", "America/New_York"];
                    setZones(common.concat(v.zones.filter(zone => !common.includes(zone))));
                } }).catch(() => { });
                return () => { alive.current = false; abort.abort(); if (controller.current)
                    controller.current.abort(); };
            }, []);
            useEffect(() => { props.onBusy(busy); return () => props.onBusy(false); }, [busy]);
            const reset = () => { setPreview(null); setSelected([]); setResults({}); setError(""); };
            const update = value => { fileSequence.current++; setFileName(""); setContent(value); reset(); };
            const loadFile = async (event) => {
                const file = event.target.files && event.target.files[0];
                if (!file)
                    return;
                const sequence = ++fileSequence.current;
                reset();
                setContent("");
                setFileName(file.name);
                if (file.size > 256 * 1024) {
                    setError(t("import.errorSize"));
                    return;
                }
                try {
                    const value = await file.text();
                    if (alive.current && sequence === fileSequence.current)
                        setContent(value);
                }
                catch (e) {
                    if (alive.current && sequence === fileSequence.current)
                        setError(backendMessage(e));
                }
            };
            /** 导出当前日历的全部日程：服务端拼好 .ics 文本，这里只负责触发下载。 */
            const exportNow = async () => {
                if (exportBusy)
                    return;
                setExportBusy(true);
                setExportError("");
                setExportInfo("");
                try {
                    const value = await api("exportIcs", {});
                    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") {
                        throw new Error(t("export.failed"));
                    }
                    const blob = new Blob([value.data], { type: "text/calendar;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = value.filename;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    setExportInfo(t("export.done", { n: value.count }));
                }
                catch (failure) {
                    const message = backendMessage(failure) || String(failure);
                    // 服务端是旧版本时只会回「未知动作：exportIcs」——那对用户毫无意义，直接给可操作的指引。
                    setExportError(/未知动作/.test(message) ? t("export.staleServer") : message);
                }
                finally {
                    setExportBusy(false);
                }
            };
            const exportSource = () => {
                const value = CONN_CACHE.value;
                return value !== null && value !== undefined && value.backend === "caldav" ? providerLabel(value) : t("source.local");
            };
            const eligible = preview ? preview.rows.filter(row => row.status === "ready" && !["imported", "duplicate"].includes(results[row.id] && results[row.id].status)) : [];
            const run = async (committing) => {
                if (busy)
                    return;
                setBusy(true);
                setError("");
                const abort = new AbortController();
                controller.current = abort;
                const timer = setTimeout(() => abort.abort(), 125000);
                try {
                    const value = await importApi(committing ? "commit" : "preview", committing ? { id: preview.id, selected, confirmed: true } : { ics: content, floatingTimezone: timezone }, abort.signal);
                    if (!alive.current)
                        return;
                    if (committing) {
                        const next = Object.assign({}, results);
                        value.results.forEach(row => { next[row.id] = row; });
                        setResults(next);
                        setSelected(value.results.filter(row => row.status === "failed").map(row => row.id));
                        props.onImported();
                    }
                    else {
                        setPreview(value);
                        setResults({});
                        setSelected([]);
                    }
                }
                catch (e) {
                    if (alive.current)
                        setError(abort.signal.aborted ? t("import.stopped") : backendMessage(e));
                }
                finally {
                    clearTimeout(timer);
                    controller.current = null;
                    if (alive.current)
                        setBusy(false);
                }
            };
            const count = Object.values(results);
            return h("section", { className: "dshc-import", "aria-label": t("ics.title"), "aria-busy": busy }, [
                h("h3", { key: "title" }, t("ics.title")),
                h("p", { key: "intro", className: "dshc-sub" }, t("ics.intro")),
                h("h4", { key: "importh", className: "dshc-subtitle" }, t("import.section")),
                h("p", { key: "importhint", className: "dshc-sub" }, t("import.intro")),
                // 原生 input[type=file] 自带的按钮与「未选择文件」文案跟随浏览器语言（英文环境就是英文），
                // 所以把它藏起来，用我们自己的按钮触发，选中后在这里显示文件名。
                // 隐藏用行内 style：下面的 `.dshc-import input[type=file]` 规则带元素选择器，
                // 权重高于 `.dshc-file-native`，只靠 class 藏不住（会看到英文的 Choose File）。
                h("div", { key: "file", className: "dshc-file" }, [
                    h(Btn, { key: "pick", disabled: busy, onClick: () => { const node = fileInput.current; if (node !== null)
                            node.click(); } }, t("import.file")),
                    h("span", { key: "name", className: "dshc-file-name", title: fileName }, fileName !== "" ? fileName : t("import.noFile")),
                    h("input", { key: "native", ref: fileInput, className: "dshc-file-native", style: { display: "none" }, type: "file", accept: ".ics,text/calendar", disabled: busy, onChange: loadFile })
                ]),
                h("label", { key: "paste" }, [t("import.paste"), h("textarea", { value: content, rows: 5, disabled: busy, onChange: e => update(e.target.value), spellCheck: false })]),
                h("label", { key: "zone" }, [t("import.timezone"), h("select", { value: timezone, disabled: busy, onChange: e => { setTimezone(e.target.value); reset(); } }, [h("option", { key: "empty", value: "" }, t("import.chooseZone")), ...zones.map(zone => h("option", { key: zone, value: zone }, zone === "Asia/Shanghai" ? (UI_LANG === "en" ? "Beijing time · Asia/Shanghai" : "北京时间 · Asia/Shanghai") : zone))])]),
                h("p", { key: "limit", className: "dshc-sub" }, t("import.limit")),
                h("div", { key: "actions", className: "dshc-import-actions" }, [
                    h(Btn, { key: "preview", disabled: busy || !content.trim(), onClick: () => run(false) }, busy ? t("import.busy") : t("import.preview")),
                    // 设置页里导入面板常驻，没有「关闭」这回事；浮层/旧入口才需要关。
                    props.embedded === true ? null : h(Btn, { key: "close", disabled: busy, onClick: props.onClose }, t("import.close")),
                    busy ? h(Btn, { key: "stop", onClick: () => controller.current && controller.current.abort() }, t("import.stop")) : null
                ]),
                error ? h("div", { key: "error", className: "dshc-alert error", role: "alert" }, error) : null,
                preview ? h("div", { key: "preview-data" }, [
                    preview.connectionReady === false ? h("div", { key: "connection", className: "dshc-alert warn" }, [
                        backendMessage(preview.connectionMessage),
                        props.embedded === true
                            ? h("span", { key: "hint" }, t("import.connectionHint"))
                            : h(Btn, { key: "open", onClick: props.onConnection }, t("import.connection"))
                    ]) : null,
                    h("p", { key: "scope", className: "dshc-sub" }, t("import.scope")),
                    preview.ignored ? h("p", { key: "ignored" }, t("import.ignored", { n: preview.ignored })) : null,
                    h("div", { key: "rows", className: "dshc-import-rows" }, preview.rows.map(row => {
                        const result = results[row.id], status = result ? result.status : row.status;
                        return h("div", { key: row.id, className: "dshc-import-row" }, [
                            h("label", { key: "select", className: "dshc-import-pick" }, [h("input", { type: "checkbox", checked: selected.includes(row.id), disabled: busy || row.status !== "ready" || ["imported", "duplicate"].includes(status) || (!selected.includes(row.id) && selected.length >= 20), onChange: e => setSelected(prev => e.target.checked ? prev.concat(row.id) : prev.filter(id => id !== row.id)) }), h("strong", null, row.summary)]),
                            h("span", { key: "status", className: "dshc-tag" }, t("import." + status)), h("p", { key: "date" }, importDate(row)),
                            row.recurring ? h("p", { key: "repeat" }, t("import.recurring", { n: row.exceptions })) : null,
                            status !== "duplicate" && status !== "imported" && row.conflicts ? h("p", { key: "conflict", className: "dshc-import-warning" }, t("import.conflicts", { n: row.conflicts })) : null,
                            ...(status === "duplicate" || status === "imported" ? [] : row.warnings.concat(row.errors)).map((message, i) => h("p", { key: "message-" + i, className: "dshc-import-warning" }, backendMessage(message))),
                            result && result.message ? h("p", { key: "failure", role: "alert" }, backendMessage(result.message)) : null
                        ]);
                    })),
                    count.length ? h("p", { key: "results", role: "status", "aria-live": "polite" }, t("import.results", { ok: count.filter(r => r.status === "imported").length, duplicate: count.filter(r => r.status === "duplicate").length, failed: count.filter(r => r.status === "failed").length })) : null,
                    count.some(r => r.status === "failed") ? h("p", { key: "retry" }, t("import.retryHint")) : null,
                    !eligible.length && !count.length ? h("p", { key: "no-ready" }, t("import.noReady")) : null,
                    h("div", { key: "commit", className: "dshc-import-actions" }, [h(Btn, { key: "select", disabled: busy || !eligible.length, onClick: () => setSelected(eligible.slice(0, 20).map(row => row.id)) }, t("import.select")), h(Btn, { key: "clear", disabled: busy, onClick: () => setSelected([]) }, t("import.clear")), h(Btn, { key: "commit", variant: "primary", disabled: busy || !preview.connectionReady || !selected.length, onClick: () => run(true) }, t("import.commit", { n: selected.length })),
                        // 常驻面板没有「关闭」按钮；预览结果（尤其「没有可导入的日程」时）必须能自己退出来。
                        h(Btn, { key: "cancel", disabled: busy, onClick: () => { setPreview(null); setSelected([]); setResults({}); setError(""); setContent(""); setFileName(""); } }, t("import.cancel"))])
                ]) : null,
                h("div", { key: "export", className: "dshc-export" }, [
                    h("h4", { key: "title" }, t("export.title")),
                    h("p", { key: "hint", className: "dshc-sub" }, t("export.hint", { source: exportSource() })),
                    h(Btn, { key: "go", disabled: exportBusy, onClick: exportNow }, exportBusy ? t("export.busy") : t("export.button")),
                    exportInfo !== "" ? h("p", { key: "done", className: "dshc-sub", role: "status" }, exportInfo) : null,
                    exportError !== "" ? h("p", { key: "err", className: "dshc-alert error", role: "alert" }, exportError) : null
                ])
            ]);
        }
        /**
         * 加载指示：三点环绕 + 一行说明。
         *
         * 不用网格骨架 —— 那看起来像「月视图没渲染出来」，还把内容顶在上面。
         * 这里是一个独立的、居中的小动画，深色/浅色都走宿主令牌；减少动效偏好时降速。
         */
        function CalendarLoader() {
            return h("div", { className: "dshc-loading", role: "status", "aria-live": "polite" }, [
                h("div", { key: "orbit", className: "dshc-loading-orbit", "aria-hidden": "true" }, [
                    h("i", { key: "a" }), h("i", { key: "b" }), h("i", { key: "c" })
                ]),
                h("span", { key: "text" }, t("state.loading"))
            ]);
        }
        /**
         * 设置页的「日历来源」：一个按钮切换，文字直接写明切到哪。
         *
         * 不做「先预检再执行」两步 —— 用户看不出「迁移到哪里」，还要多点一次。
         * 切换的语义是**复制 + 切换**（只复制、不删源），所以不需要额外的确认弹窗；
         * 但有一条硬规则：任何一条复制失败就不切，避免「以为搬完了其实没搬」。
         */
        function SourceSettings() {
            const [conn, setConn] = useState(CONN_CACHE.value);
            const [busy, setBusy] = useState(false);
            const [done, setDone] = useState("");
            const [error, setError] = useState("");
            useEffect(() => {
                let alive = true;
                api("connection", {}).then((value) => {
                    if (!alive)
                        return;
                    CONN_CACHE.value = value;
                    CONN_CACHE.at = Date.now();
                    setConn(value);
                }).catch(() => { });
                return () => { alive = false; };
            }, []);
            const current = conn !== null && conn !== undefined && conn.backend !== null && conn.backend !== undefined ? conn.backend : "local";
            const target = current === "caldav" ? "local" : "caldav";
            const remoteReady = conn !== null && conn !== undefined && conn.configured === true;
            const ready = target === "local" || remoteReady;
            const targetLabel = target === "local" ? t("source.local") : providerLabel(conn);
            const currentLabel = current === "caldav" ? providerLabel(conn) : t("source.local");
            const switchNow = async () => {
                setBusy(true);
                setError("");
                setDone("");
                try {
                    const value = await api("switchBackend", {});
                    if (value && value.connection) {
                        CONN_CACHE.value = value.connection;
                        CONN_CACHE.at = Date.now();
                        setConn(value.connection);
                    }
                    setDone(t("source.switched", { n: value && value.migrated ? value.migrated : 0, name: targetLabel }));
                    invalidateCalendarData();
                }
                catch (failure) {
                    setError(backendMessage(failure) || String(failure));
                }
                finally {
                    setBusy(false);
                }
            };
            return h("section", { className: "dshc-source", "aria-label": t("source.title") }, [
                h("h3", { key: "title" }, t("source.title")),
                h("p", { key: "current", className: "dshc-source-current" }, t("source.current", { name: currentLabel })),
                h("p", { key: "note", className: "dshc-sub" }, t("source.switchNote")),
                ready !== true ? h("p", { key: "off", className: "dshc-sub" }, t("source.caldavOff")) : null,
                h("div", { key: "actions", className: "dshc-actions" }, [
                    h(Btn, { key: "switch", variant: "primary", disabled: busy || ready !== true, onClick: switchNow }, busy ? t("source.busy") : t("source.switchTo", { name: targetLabel }))
                ]),
                done !== "" ? h("p", { key: "done", className: "dshc-source-done", role: "status" }, done) : null,
                error !== "" ? h("p", { key: "err", className: "dshc-alert error", role: "alert" }, error) : null
            ]);
        }
        /**
         * 设置页里的经期记录。只写本机 localStorage（见 cycle.js 的隐私约束），
         * 保存后通过模块级订阅通知已挂载的日历重画，未挂载的下次进来读新值。
         *
         * 没有「启用」开关：填了开始日期就展示，想关掉就点「清除记录」。
         * 反馈做在按钮自己身上（2 秒内显示「已保存」/「已清除」并锁住），不再单独占一行文字 ——
         * 那行字留在页面上会过期，用户过一会儿再看就分不清是刚做的还是旧状态。
         */
        /**
         * 清除后（以及从没记录过）界面上不留上次的数字，让「没记录」看起来就是空的。
         * 注意：空输入框必须靠 cycle.js 的 clampInt 回落到默认 28 / 5，**不能**当 0 夹到下限，
         * 否则用户看到「默认 28 / 5」、点保存却变成「15 / 1」（真被这么坑过一次）。
         */
        const EMPTY_CYCLE_DRAFT = { lastStart: "", cycleLength: "", periodLength: "" };
        function CycleSettings() {
            // 初始就是真实值：没记录时是 28 / 5（不是灰字占位，占位会被当成已填好）。
            const [draft, setDraft] = useState(getCycleConfig);
            /** "" | "saved" | "cleared"：同一时刻只亮一个按钮。 */
            const [flash, setFlash] = useState("");
            const formId = useId();
            const timer = useRef(null);
            useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
            /** 点亮某个按钮的完成态并在 2 秒后恢复；连着点同一个按钮会重新计时。 */
            const flashFor = (kind) => {
                if (timer.current !== null) clearTimeout(timer.current);
                setFlash(kind);
                timer.current = setTimeout(() => { timer.current = null; setFlash(""); }, 2000);
            };
            const patch = (fields) => { setDraft((prev) => Object.assign({}, prev, fields)); };
            const save = () => {
                // 没填日期 = 没有记录 = 不画线。这时等价于清除，输入框也保持空着，别再塞回 28 / 5。
                if (draft.lastStart === "") {
                    clearCycleConfig();
                    setDraft(Object.assign({}, EMPTY_CYCLE_DRAFT));
                }
                else {
                    setDraft(setCycleConfig(draft));
                }
                flashFor("saved");
            };
            const clear = () => {
                clearCycleConfig();
                setDraft(Object.assign({}, EMPTY_CYCLE_DRAFT));
                flashFor("cleared");
            };
            return h("section", { className: "dshc-cycle", "aria-label": t("cycle.title") }, [
                h("h3", { key: "title" }, t("cycle.title")),
                h("p", { key: "intro", className: "dshc-sub" }, t("cycle.intro")),
                h("div", { key: "fields", className: "dshc-cycle-fields" }, [
                    h("div", { key: "start", className: "dshc-field" }, [
                        h("label", { htmlFor: formId + "-start" }, t("cycle.lastStart")),
                        h(Txt, { id: formId + "-start", type: "date", value: draft.lastStart, onChange: (e) => patch({ lastStart: e.target.value }) })
                    ]),
                    h("div", { key: "length", className: "dshc-field" }, [
                        h("label", { htmlFor: formId + "-cycle" }, t("cycle.cycleLength")),
                        h(Txt, { id: formId + "-cycle", type: "number", min: 15, max: 60, value: draft.cycleLength, onChange: (e) => patch({ cycleLength: e.target.value }) })
                    ]),
                    h("div", { key: "period", className: "dshc-field" }, [
                        h("label", { htmlFor: formId + "-period" }, t("cycle.periodLength")),
                        h(Txt, { id: formId + "-period", type: "number", min: 1, max: 14, value: draft.periodLength, onChange: (e) => patch({ periodLength: e.target.value }) })
                    ])
                ]),
                h("div", { key: "actions", className: "dshc-actions" }, [
                    h(Btn, { key: "save", variant: "primary", disabled: flash === "saved", onClick: save }, t(flash === "saved" ? "cycle.saved" : "cycle.save")),
                    h(Btn, { key: "clear", disabled: flash === "cleared", onClick: clear }, t(flash === "cleared" ? "cycle.cleared" : "cycle.clear"))
                ])
            ]);
        }
        /**
         * 页脚的数据源标签：只读，**不可点**。
         *
         * 页面永远只显示一个数据源，这里只说明「现在看的是哪一份」；
         * 切换数据源要迁移、可能丢数据，属于设置页里的一次性流程，不该在页脚一键可达。
         */
        function sourceLabel(conn) {
            if (conn === null || conn === undefined)
                return "";
            if (conn.backend === "local")
                return t("source.local");
            if (conn.backend !== "caldav")
                return "";
            return providerLabel(conn);
        }
        /** 远程服务的显示名；与「当前源」无关，供「切换到 X」这类文案使用。 */
        function providerLabel(conn) {
            const provider = conn === null || conn === undefined ? undefined : conn.provider;
            if (provider === "google")
                return "Google";
            if (provider === "icloud")
                return "iCloud";
            if (provider === "nextcloud")
                return "Nextcloud";
            return t("source.caldav");
        }
        /**
         * 首启页：`backend` 还没选过时占住视图区。
         *
         * 只有两个终态 —— 使用本地日历，或走连接向导接远程。没有「先看看」「稍后再说」：
         * 任何中间态都会让用户以为「日程可以存在两处」，与互斥单数据源的模型相悖。
         */
        function SourcePicker(props) {
            const busy = props.busy === true;
            return h("div", { className: "dshc-start" }, [
                h("h3", { key: "title" }, t("start.title")),
                h("p", { key: "sub", className: "dshc-sub" }, t("start.subtitle")),
                h("div", { key: "cards", className: "dshc-start-cards" }, [
                    h("button", { key: "local", type: "button", className: "dshc-start-card", disabled: busy, onClick: props.onLocal }, [
                        h("strong", null, t("start.local")),
                        h("span", { className: "dshc-sub" }, t("start.localHint"))
                    ]),
                    h("button", { key: "remote", type: "button", className: "dshc-start-card", disabled: busy, onClick: props.onRemote }, [
                        h("strong", null, t("start.remote")),
                        h("span", { className: "dshc-sub" }, t("start.remoteHint"))
                    ])
                ]),
                props.error ? h("p", { key: "error", className: "dshc-start-error", role: "alert" }, props.error) : null,
                h("p", { key: "note", className: "dshc-start-note" }, t("start.footnote"))
            ]);
        }
        function CalendarPanel(props) {
            useUILanguage();
            const compact = props.compact === true;
            const [view, setView] = useState(loadStoredView);
            const [anchor, setAnchor] = useState(() => new Date());
            const [reloadToken, setReloadToken] = useState(0);
            const [selected, setSelected] = useState(null);
            const [draft, setDraft] = useState(null);
            const [busy, setBusy] = useState(false);
            const [formError, setFormError] = useState(null);
            const [banner, setBanner] = useState(null);
            const [confirmDelete, setConfirmDelete] = useState(false);
            // 连接信息也从跨会话缓存起手：回来时 `configured === null` 会直接走骨架屏，
            // 那正是「每次进页面都闪一下」的第二个来源。
            const [configured, setConfigured] = useState(() => (CONN_CACHE.value === null ? null : CONN_CACHE.value.configured !== false));
            const [conn, setConn] = useState(() => CONN_CACHE.value);
            const [connOpen, setConnOpen] = useState(false);
            const [sourceBusy, setSourceBusy] = useState(false);
            // 首启页的选择失败必须留在页面上：只闪 2.2 秒的提示条会被当成"点了没反应"。
            const [sourceError, setSourceError] = useState(null);
            const [availabilityOpen,setAvailabilityOpen]=useState(false),[availabilityBusy,setAvailabilityBusy]=useState(false);
            // 经期记录在设置页维护；模块级订阅让设置页一保存，已挂载的日历立刻重画。
            const [cycle, setCycle] = useState(getCycleConfig);
            useEffect(() => subscribeCycle(setCycle), []);
            const layerOpen = draft !== null || selected !== null || connOpen === true;
            const rootRef = useRef(null);
            /** 让 Launcher 知道本面板里有没有浮层：宿主 Portal 的 Esc 不能被面板级监听抢走。 */
            useEffect(() => {
                const notify = typeof props.onLayerChange === "function" ? props.onLayerChange : null;
                if (notify !== null)
                    notify(layerOpen);
                return () => { if (notify !== null)
                    notify(false); };
            }, [layerOpen]);
            /** 面板内浮层的打开顺序：Esc 关最后打开的那个，而不是按类型硬编码。 */
            const layerOrderRef = useRef([]);
            useEffect(() => {
                const openKeys = [];
                if (selected !== null)
                    openKeys.push("selected");
                if (draft !== null)
                    openKeys.push("draft");
                if (connOpen === true)
                    openKeys.push("conn");
                const kept = layerOrderRef.current.filter((key) => openKeys.indexOf(key) !== -1);
                const added = openKeys.filter((key) => kept.indexOf(key) === -1);
                layerOrderRef.current = kept.concat(added);
            }, [draft, connOpen, selected]);
            /**
             * Esc 分层关闭：有浮层时只关最上面一层（表单/连接设置 > 详情抽屉）。
             * 监听走模块级的层栈 —— 多个 CalendarPanel 并存时一次 Esc 只关一层；
             * 焦点在上层宿主 Portal 里时直接让行，交给宿主自己的 Esc 语义。
             */
            useEffect(() => {
                if (layerOpen !== true)
                    return () => { };
                const root = rootRef.current;
                if (root === null)
                    return () => { };
                const closeTop = () => {
                    const order = layerOrderRef.current;
                    const top = order.length === 0 ? null : order[order.length - 1];
                    if (top === "draft") {
                        setDraft(null);
                        setFormError(null);
                    }
                    else if (top === "conn")
                        setConnOpen(false);
                    else if (top === "selected") {
                        setSelected(null);
                        setConfirmDelete(false);
                    }
                };
                return registerLayerEscape(root, closeTop);
            }, [draft, selected, connOpen]);
            /** 乐观改期：uid → { start, end }。等服务器回读到同样的时间再撤掉，避免闪回。 */
            const [overrides, setOverrides] = useState({});
            const [undo, setUndo] = useState(null);
            const undoTimer = useRef(0);
            /** 每个 uid 一个串行队列：见 applyMove 的注释。 */
            const moveQueue = useRef({});
            useEffect(() => () => { if (undoTimer.current)
                clearTimeout(undoTimer.current); }, []);
            /** 只在「用户点刷新」时才真的重新问连接；重新进页面走缓存（TTL 内直接命中）。 */
            const connToken = useRef(reloadToken);
            useEffect(() => {
                const bumped = reloadToken !== connToken.current;
                connToken.current = reloadToken;
                const cached = CONN_CACHE.value;
                if (cached !== null && bumped !== true && Date.now() - CONN_CACHE.at < DATA_TTL_MS)
                    return () => { };
                let alive = true;
                api("connection", {}).then((value) => { if (alive) {
                    CONN_CACHE.value = value;
                    CONN_CACHE.at = Date.now();
                    setConn(value);
                    // 本地日历不需要账号，不能用 resolveConfig 的结果判断它「可用与否」。
                    setConfigured(value ? (value.backend === "local" || value.configured !== false) : false);
                } })
                    .catch(() => { if (alive)
                    setConfigured(true); }); // 状态都问不到时按「已配置」处理，让错误条去解释
                return () => { alive = false; };
            }, [reloadToken]);
            const range = useMemo(() => rangeOf(view, anchor), [view, anchor.getFullYear(), anchor.getMonth(), anchor.getDate()]);
            const data = useCalendarData(range, reloadToken);
            const reload = () => setReloadToken((n) => n + 1);
            /** 选「本地日历」：写进 settings 后立刻刷新。此刻本地是空的，没有数据要迁移。 */
            const chooseLocal = async () => {
                setSourceBusy(true);
                setSourceError(null);
                try {
                    const value = await api("setBackend", { backend: "local" });
                    if (value && value.connection) {
                        CONN_CACHE.value = value.connection;
                        CONN_CACHE.at = Date.now();
                        setConn(value.connection);
                    }
                    setConfigured(true);
                    invalidateCalendarData();
                    reload();
                }
                catch (error) {
                    const message = backendMessage(error) || t("error.load");
                    setSourceError(message);
                    notify(message);
                }
                finally {
                    setSourceBusy(false);
                }
            };
            /** 数据还没到过（null）时按空数组渲染：切视图不再闪骨架，只可能是「这段没日程」。 */
            const events = useMemo(() => data.events || [], [data.events]);
            /** 渲染用的事件：把乐观改期叠加在服务器数据之上。 */
            const visibleEvents = useMemo(() => events.map((event) => {
                const override = overrides[event.uid];
                return override === undefined ? event : Object.assign({}, event, override);
            }), [events, overrides]);
            /**
             * 页脚统计 = 当前视图里显示出来的日程数（含重复展开），翻到哪个月就数哪个月。
             * 以前只数「今天之后还没过去」的，结果翻到过去的月份，屏幕上明明有 3 条日程，
             * 页脚却写「0 个日程」——口径和看到的内容对不上。
             */
            const shownEvents = visibleEvents;
            /**
             * 改期成功后把焦点还给同一个日程。
             *
             * 位置必须在 const data = useCalendarData(...) **之后**：依赖数组 [data.events] 在渲染期求值，
             * 写在前面会直接 TDZ 抛错（panel 每次渲染就崩 —— 纯函数测试抓不到，评审抓到了）。
             * 另外只在「焦点还在面板里」时才回收，免得用户在慢 reload 期间已经点到别处又被抢回来。
             */
            const focusUid = useRef(null);
            useEffect(() => {
                const uid = focusUid.current;
                if (uid === null)
                    return;
                focusUid.current = null;
                const active = document.activeElement;
                const inPanel = active === undefined || active === null || active === document.body
                    || (typeof active.closest === "function" && active.closest(".dshc-root") !== null);
                if (inPanel !== true)
                    return;
                try {
                    const selector = '.dshc-slot[data-uid="' + String(uid).replace(/"/g, '\\"') + '"]';
                    const node = document.querySelector(selector);
                    if (node !== null && typeof node.focus === "function")
                        node.focus({ preventScroll: true });
                }
                catch (error) { /* uid 里有怪字符就算了，不值得为此报错 */ }
            }, [data.events]);
            /** 服务器回读到新时间后，撤掉对应的乐观覆盖（否则会一直盖着）。 */
            useEffect(() => {
                setOverrides((prev) => {
                    const uids = Object.keys(prev);
                    if (uids.length === 0)
                        return prev;
                    const next = Object.assign({}, prev);
                    let changed = false;
                    for (const uid of uids) {
                        const stored = events.find((event) => event.uid === uid);
                        if (stored !== undefined && stored.start === prev[uid].start && stored.end === prev[uid].end) {
                            delete next[uid];
                            changed = true;
                        }
                    }
                    return changed ? next : prev;
                });
            }, [events]);
            /** 乐观改期的落盘：先动画面、再发请求；失败就把覆盖撤掉并报错。 */
            /**
             * 改期落盘：**按 uid 串行 + 合并**。
             *
             * 按住方向键会按 repeat 频率连发，直接并发发 PUT 的话：乱序可能让服务器停在中间某个时间、
             * 而先发的那次失败会把后发那次的乐观位置一起回滚掉。这里同一 uid 只跑一个请求，
             * 期间来的新落点合并成「最后一次」，跑完再接着发。
             */
            const applyMove = (event, range) => {
                const uid = event.uid;
                const shown = overrides[uid] === undefined ? { start: event.start, end: event.end } : overrides[uid];
                if (range.start === shown.start && range.end === shown.end)
                    return; // 无效位移（同一格内晃一下）不发请求
                const queue = moveQueue.current;
                if (queue[uid] === undefined)
                    queue[uid] = { running: false, next: null };
                const entry = queue[uid];
                if (entry.running === true) {
                    entry.next = range;
                    return;
                }
                entry.running = true;
                void drain(uid, event, range, entry);
            };
            /** 串行队列的驱动：失败即回滚 + 对账（超时可能已经落盘，不能假设「失败 = 没改」）。 */
            const drain = async (uid, event, firstRange, entry) => {
                const original = { uid, start: event.start, end: event.end, summary: event.summary };
                let range = firstRange;
                try {
                    for (;;) {
                        setOverrides((prev) => Object.assign({}, prev, { [uid]: { start: range.start, end: range.end } }));
                        try {
                            await api("update", { uid, start: range.start, end: range.end });
                        }
                        catch (error) {
                            setOverrides((prev) => { const next = Object.assign({}, prev); delete next[uid]; return next; });
                            notify(t("move.failed", { message: error !== null && error !== undefined && error.message ? error.message : String(error) }));
                            reload(); // 对账：超时/断连时服务器可能已经改了
                            break;
                        }
                        focusUid.current = uid;
                        // 一次「连续操作」只留一个撤销点：记录的是这段操作前的原始位置，而不是上一小步。
                        setUndo(Object.assign({ recurring: false }, original));
                        if (undoTimer.current)
                            clearTimeout(undoTimer.current);
                        undoTimer.current = setTimeout(() => setUndo(null), 5000);
                        reload();
                        if (entry.next === null)
                            break;
                        range = entry.next;
                        entry.next = null;
                    }
                }
                finally {
                    entry.running = false;
                    if (entry.next === null)
                        delete moveQueue.current[uid];
                    else {
                        const pending = entry.next;
                        entry.next = null;
                        applyMove(event, pending);
                    }
                }
            };
            /** 改期入口：重复日程先问一句（拖动会移动整个系列，这是语义雷区，不能悄悄做）。 */
            const reschedule = (event, range) => {
                // 重复日程暂不支持拖动改期：CalDAV 里整个系列是一个对象，而 update 只能改 master 的
                // DTSTART —— 把「这次实例的目标时间」发过去等于**重锚系列起点**（早于它的实例全丢、
                // COUNT/UNTIL 语义被改，撤销也回不到原系列）。评审实测过，这里必须先挡住。
                if (isRecurring(event)) {
                    notify(t("move.recurringUnsupported"));
                    return;
                }
                // 超过 24 小时的日程：当天放不下，任何位移都会被钳到 00:00，语义不清，一并挡住。
                if (slotFromEvent(event).durationMinutes > 24 * 60) {
                    notify(t("move.tooLong"));
                    return;
                }
                applyMove(event, range);
            };
            /** 撤销：把上一次改期前的 start/end 再写回去。 */
            const undoMove = async () => {
                if (undo === null)
                    return;
                const target = undo;
                setUndo(null);
                if (undoTimer.current)
                    clearTimeout(undoTimer.current);
                const optimistic = true; // 撤销只服务单次日程（重复日程不走拖动）
                if (optimistic === true)
                    setOverrides((prev) => Object.assign({}, prev, { [target.uid]: { start: target.start, end: target.end } }));
                try {
                    await api("update", { uid: target.uid, start: target.start, end: target.end });
                    reload();
                }
                catch (error) {
                    if (optimistic === true)
                        setOverrides((prev) => { const next = Object.assign({}, prev); delete next[target.uid]; return next; });
                    notify(t("move.failed", { message: error !== null && error !== undefined && error.message ? error.message : String(error) }));
                }
            };
            const notify = (text) => { setBanner(text); setTimeout(() => setBanner((current) => (current === text ? null : current)), 2200); };
            const title = view === "week" ? formatWeekTitle(anchor) : view === "agenda" ? t("view.agenda") : formatMonthTitle(anchor);
            const step = (delta) => setAnchor((current) => (view === "week" ? addDays(current, delta * 7) : addMonthShift(current, delta)));
            const submit = async (form) => {
                setBusy(true);
                setFormError(null);
                try {
                    const fields = fieldsOfDraft(form);
                    if (form.uid === undefined)
                        await api("create", fields);
                    else
                        await api("update", Object.assign({ uid: form.uid }, fields));
                    setDraft(null);
                    setSelected(null);
                    reload();
                    notify(form.uid === undefined ? "已创建" : "已保存");
                }
                catch (error) {
                    setFormError(backendMessage(error));
                }
                finally {
                    setBusy(false);
                }
            };
            const remove = async (event) => {
                setBusy(true);
                try {
                    await api("delete", { uid: event.uid, ...(isRecurring(event) ? { scope: "series" } : {}) });
                    setSelected(null);
                    setConfirmDelete(false);
                    reload();
                    notify("已删除");
                }
                catch (error) {
                    setBanner(backendMessage(error));
                }
                finally {
                    setBusy(false);
                }
            };
            const toolbar = compact ? (h("div", { className: "dshc-toolbar" }, [
                h("h3", { className: "dshc-title", key: "title" }, t("section.title")),
                h("div", { className: "dshc-tabs", key: "tabs" }, VIEWS.map((name) => h("button", {
                    key: name, type: "button", className: "dshc-tab" + (view === name ? " on" : ""),
                    onClick: () => { setView(name); storeView(name); }
                }, t("view." + name)))),
                h("span", { className: "dshc-spacer", key: "spacer" }),
                h("span", { className: "dshc-monthhead", key: "period" }, title),
                h(Btn, { key: "prev", onClick: () => step(-1), "aria-label": t("action.prev") }, "\u2039"),
                h(Btn, { key: "today", onClick: () => setAnchor(new Date()) }, t("action.today")),
                h(Btn, { key: "next", onClick: () => step(1), "aria-label": t("action.next") }, "\u203a"),
                h(Btn, { key: "reload", onClick: reload }, t("action.refresh")),
                h(Btn, { key: "new", variant: "primary", onClick: () => setDraft(draftAt(anchor)) }, t("action.new"))
            ])) : h('div',{className:'calendar-toolbar'},
 h('div',{className:'calendar-period'},h(W.IconButton,{icon:'left',label:t('action.prev'),onClick:()=>step(-1)}),h('strong',null,title),h(W.IconButton,{icon:'right',label:t('action.next'),onClick:()=>step(1)}),h(W.Button,{onClick:()=>setAnchor(new Date())},t('action.today'))),
 h('div',{className:'calendar-view-controls',role:'group','aria-label':calendarText('日历视图','Calendar view')},VIEWS.map(name=>h(W.Button,{key:name,'aria-pressed':view === name,onClick:()=>{setView(name);storeView(name);}},t('view.'+name))),h(W.IconButton,{icon:'refresh',label:t('action.refresh'),onClick:reload})));;
            // 浮层只用来快速看一眼日程：数据源选择、连接配置、找空闲一律回侧栏做，
            // 免得同一个功能在浮层和主页面用两个名字、两套流程。
            const compactHint = () => h("div", { className: "dshc-empty" }, [h("p", null, t("panel.compactHint"))]);
            const body = () => {
                // 首启：还没选过数据源 —— 先让用户决定日程存在哪。不显示空日历，也没有示例模式。
                // 严格判 null：backend 缺失只可能来自「服务端更老」，不能因此把正常日历顶成首启页。
                if (conn !== null && conn !== undefined && conn.backend === null) {
                    if (compact === true) return compactHint();
                    return h(SourcePicker, { busy: sourceBusy, error: sourceError, onLocal: chooseLocal, onRemote: () => setConnOpen(true) });
                }
                if (configured === false) {
                    if (compact === true) return compactHint();
                    return h("div", { className: "dshc-empty" }, [
                        h("h3", null, t("state.notConfigured")),
                        h("p", null, t("state.notConfiguredHint")),
                        h("div", { style: { marginTop: "12px", display: "flex", gap: "8px", justifyContent: "center" } }, [
                            h(Btn, { key: "cfg", variant: "primary", onClick: () => setConnOpen(true) }, t("conn.button"))
                        ])
                    ]);
                }
                if (configured === null)
                    return h(CalendarLoader, {});
                // 当前窗口没有缓存时才转圈；有缓存（哪怕过期）直接画那个窗口的数据，后台刷新用进度线提示。
                if (data.events === null && data.loading === true)
                    return h(CalendarLoader, {});
                if (view === "week")
                    return h(WeekView, { anchor, events: visibleEvents, onPick: openEvent, onCreateAt: createAt, onReschedule: reschedule, cycle });
                if (view === "agenda")
                    return h(AgendaView, { events: visibleEvents, onPick: openEvent, onCreateAt: createAt });
                return h(MonthView, { anchor, events: visibleEvents, onPick: openEvent, onCreateAt: createAt, cycle });
            };
            const openEvent = (event) => { setConfirmDelete(false); setSelected(event); };
            const createAt = (day, hour) => {
                setDraft(draftAt(day, hour));
            };
            const content = h("div", { ref: rootRef, className: "dshc-root" }, [
                h("div", { className: "dshc-shell" }, [
                    banner !== null ? h("div", { className: "dshc-alert ok", role: "status", "aria-live": "polite" }, banner) : null,
                    undo !== null
                        ? h("div", { className: "dshc-undo", role: "status", "aria-live": "polite" }, [
                            h("span", { key: "text" }, t("move.saved") + "：" + (undo.summary || "")),
                            h("button", { key: "undo", type: "button", className: "dshc-undo-btn", onClick: undoMove }, t("move.undo"))
                        ])
                        : null,
                    data.error !== null && data.error !== undefined && configured !== false
                        ? h("div", { className: "dshc-alert error" }, [
                            h("span", null, backendMessage(data.error) || t("error.load")),
                            h("span", { className: "dshc-spacer" }),
                            h(Btn, { onClick: reload }, t("action.retry"))
                        ])
                        : null,
                    // 工作台里不要外面那层 div：一屏布局是 flex 链，多一层普通块会把工具条变成可压缩的项。
                    compact === true ? toolbar : h(React.Fragment, null, toolbar),
                    data.refreshing === true ? h("div", { key: "refresh", className: "dshc-refresh", role: "status", "aria-label": t("state.refreshing") }, h("span", { key: "bar" })) : null,
                    availabilityOpen ? h(AvailabilityPanel,{key:'availability',anchor,onBusy:setAvailabilityBusy,onClose:()=>setAvailabilityOpen(false),onChoose:slot=>{setAvailabilityOpen(false);setAnchor(new Date(slot.start));setFormError(null);setDraft({...draftOfEvent({start:slot.start,end:slot.end,allDay:false}),uid:undefined});}}) : null,
                    // 空闲时段与月/周/议程互斥：两者平级时，视图的 flex:1 会把面板挤成一小块，
                    // 面板自己的候选列表也被压到只剩两行。打开面板时直接不渲染视图。
                    availabilityOpen ? null : body(),
                    h("div", { className: "dshc-footer" }, [
                        // 左边：周视图的拖拽提示。和右边的账号信息同一行，不要分割线。
                        view === "week"
                            ? h("span", { key: "hint", className: "dshc-footer-hint" }, t("drag.hint"))
                            : null,
                        // 右边：当前视图的日程数 + 当前账号。
                        h("span", { key: "count" }, t("count.events", { n: shownEvents.length }) + (shownEvents.some((e) => e.isOccurrence) ? " · " + t("count.occurrences", { n: shownEvents.filter((e) => e.isOccurrence).length }) : "")),
                        // 只说明当前看的是哪一份数据，不可点：切换数据源属于设置页的一次性流程。
                        h("span", { key: "source", title: conn !== null && conn !== undefined && conn.backend === "caldav" ? connectionSummary(conn) : undefined }, sourceLabel(conn) === "" ? "" : "· " + sourceLabel(conn))
                    ])
                ]),
                selected !== null
                    ? h(EventDrawer, {
                        event: selected,
                        events,
                        busy,
                        confirmDelete,
                        setConfirmDelete,
                        onClose: () => { setSelected(null); setConfirmDelete(false); },
                        onEdit: async (event) => {
                            if (!isRecurring(event)) {
                                setSelected(null);
                                setDraft(draftOfEvent(event));
                                return;
                            }
                            setBusy(true);
                            try {
                                const value = await api("event", { uid: event.uid });
                                setSelected(null);
                                setDraft({ ...draftOfEvent(value.event), isSeries: true });
                            }
                            catch (error) {
                                setBanner(backendMessage(error));
                            }
                            finally {
                                setBusy(false);
                            }
                        },
                        onDelete: remove
                    })
                    : null,
                draft !== null
                    ? h(EventForm, { draft, events, busy, error: formError, onCancel: () => { setDraft(null); setFormError(null); }, onSubmit: submit })
                    : null,
                connOpen === true
                    ? h(ConnectionForm, {
                        connection: conn,
                        onClose: () => setConnOpen(false),
                        onSaved: (value) => {
                            if (value && value.connection)
                                setConn(value.connection);
                            setConnOpen(false);
                            setDemo(false);
                            reload();
                            notify(t("conn.savedToast"));
                        }
                    })
                    : null
            ]);
if(compact) return content;
return h(W.Page,{workbench:props.workbench===true,title:t('section.title'),subtitle:calendarText('查看日程、安排时间。','View events and plan time.'),className:'calendar-workbench',actions:h(React.Fragment,null,
 h(W.Button,{icon:'link',disabled:configured===null,onClick:()=>setConnOpen(true)},calendarText('日历连接','Calendar connection')),
 h(W.Button,{disabled:configured!==true,onClick:()=>setAvailabilityOpen(v=>!v)},calendarText('找空闲时段','Find available time')),
 h(W.Button,{variant:'primary',disabled:configured!==true,title:configured!==true?calendarText('请先连接日历','Connect a calendar first'):undefined,onClick:()=>setDraft(draftAt(anchor))},t('action.new')))},h('style',null,CALENDAR_WORKBENCH_CSS),content);
        }
        /** 月份平移：先跳到本月 1 号再加月，避免 1 月 31 日 +1 个月变成 3 月 3 日。 */
        function addMonthShift(date, delta) {
            const first = new Date(date.getFullYear(), date.getMonth(), 1);
            const shifted = new Date(first.getFullYear(), first.getMonth() + delta, 1);
            const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
            return new Date(shifted.getFullYear(), shifted.getMonth(), Math.min(date.getDate(), lastDay));
        }
        /** 侧栏 / 工作台里的那一节：只有日历本身。 */
        function CalendarSection({workbench=false}={}) { return h(CalendarPanel,{workbench}); }
        /** 设置页：日历来源、经期记录、ICS 导入导出；侧栏只留日历本身。 */
        function SettingsSection() {
            useUILanguage();
            return h(W.Page, { title: t('section.title'), subtitle: t('section.settingsSubtitle'), className: 'calendar-settings' },
                h("div", { className: "dshc-settings", key: "settings" }, [
                    h(SourceSettings, { key: "source" }),
                    h(CycleSettings, { key: "cycle" }),
                    h(IcsImportPanel, {
                        key: "ics",
                        embedded: true,               // 常驻面板：不显示「关闭」，连接提示改纯文字
                        onBusy: () => { },
                        onClose: () => { },
                        onConnection: () => { },
                        onImported: invalidateCalendarData
                    })
                ])
            );
        }
        /** 对话页右下角的小按钮 + 悬浮面板（自己挂 root，不占用宿主槽位）。 */
        function Launcher() {
const [activePanel,setActivePanel]=useState(null);
useEffect(()=>{let layout;try{layout=calendarHostContext?.get?.('layout') || calendarHostContext?.layout;}catch{}if(!layout?.panelInfo)return;const update=()=>setActivePanel(layout.panelInfo.getSnapshot().activePanelId);update();return layout.panelInfo.subscribe(update);},[]);
            useUILanguage();
            const [open, setOpen] = useState(false);
            const [layerOpen, setLayerOpen] = useState(false);
            useEffect(() => {
                if (open !== true)
                    return () => { };
                const onKey = (event) => {
                    if (event.key !== "Escape" || event.isComposing === true)
                        return;
                    // 浮层交给 CalendarPanel 的层栈；宿主 Portal 的 Esc 交给宿主组件。
                    if (layerOpen === true)
                        return;
                    setOpen(false);
                };
                document.addEventListener("keydown", onKey);
                return () => document.removeEventListener("keydown", onKey);
            }, [open, layerOpen]);
            const calendarIcon = h("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }, [
                h("rect", { key: "r", x: 3, y: 5, width: 18, height: 16, rx: 3 }),
                h("path", { key: "l", d: "M3 10h18M8 3v4M16 3v4" })
            ]);
            if(activePanel) return null;
return h("div", null, [
                h("button", {
                    type: "button",
                    className: "dshc-fab" + (open === true ? " on" : ""),
                    title: t("nav.title"),
                    "aria-label": t("nav.title"),
                    onClick: () => setOpen((value) => !value)
                }, calendarIcon),
                open === true ? h("div", { className: "dshc-float" }, h(CalendarPanel, { compact: true, onLayerChange: setLayerOpen })) : null
            ]);
        }
        // ───────────────────────────── 挂载 ─────────────────────────────
        const inject = ["slots", "locale"];
        function apply(ctx) {
calendarHostContext=ctx;W.register(ctx,{id:'dsh-calendar-pro.workbench',label:()=>t('nav.title'),icon:'calendar',component:CalendarSection,order:58});

            // 语言要在任何 t() 之前定下来（与 dsh-email 同款契约）。
            try {
                ctx.effect(() => subscribeLocale(ctx), "dsh-calendar-pro: locale");
            }
            catch (e) { /* 没有 effect 的宿主不该拖垮面板 */ }
            try {
                ctx.effect(() => {
                    const id = "dsh-calendar-pro/client";
                    if (document.querySelector('style[data-plugin-css="' + id + '"]'))
                        return () => { };
                    const style = document.createElement("style");
                    style.dataset.plugin = "dsh-calendar-pro";
                    style.dataset.pluginCss = id;
                    style.textContent = CSS + CSS_EXTRA + ".dshc-import{margin:12px 0;padding:14px;border:1px solid var(--dsw-alias-border-l2,#d5d9df);border-radius:12px;min-width:0}.dshc-import h3{margin:0 0 8px}.dshc-import label{display:block;font-size:12px;margin:10px 0}.dshc-import input[type=file]:not(.dshc-file-native),.dshc-import textarea,.dshc-import select{display:block;box-sizing:border-box;width:100%;max-width:100%;margin-top:5px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;padding:7px;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff)}.dshc-import textarea{resize:vertical;font:12px/1.5 monospace}.dshc-import-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.dshc-import-rows{max-height:480px;overflow:auto}.dshc-import-row{padding:10px 4px;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);overflow-wrap:anywhere}.dshc-import-row p{font-size:12px;margin:5px 0}.dshc-import .dshc-import-pick{display:flex;align-items:flex-start;gap:8px}.dshc-import-pick input{margin-top:2px;flex-shrink:0}.dshc-import-warning{color:var(--dsw-alias-state-warn-primary,#886200)}";
                    style.textContent += "@media(max-width:700px){[role=dialog]:has(.dshc-root){width:100%!important;max-width:100%!important;flex-direction:column!important}[role=dialog]:has(.dshc-root)>nav+div{min-width:0;width:100%}[role=dialog]:has(.dshc-root)>nav+div>div:has(.dshc-root){padding:12px!important;min-width:0}[role=dialog]:has(.dshc-root) nav{width:100%!important;flex-basis:auto!important;border-right:0;max-height:170px;overflow:auto}[role=dialog]:has(.dshc-root) nav>div:has(>button){display:flex;flex-direction:row!important;flex-wrap:wrap;flex-shrink:0;gap:4px}}";
                    document.head.appendChild(style);
                    return () => { style.remove(); };
                }, "dsh-calendar-pro: styles");
            }
            catch (e) { /* 无 DOM 环境（纯 node 侧冒烟）时跳过 */ }
            try {
                // 设置页只放数据源与进阶设置；侧栏已经有了日历本身，不该重复一遍。
                ctx.slots.inject("settings.section", () => ctx.slots.register({
                    name: "settings.section",
                    id: "dsh-calendar-pro",
                    order: 50,
                    label: () => {
                        let lang = UI_LANG;
                        try {
                            if (activeLocaleService?.getSnapshot)
                                lang = localeToLang(activeLocaleService.getSnapshot().active);
                        }
                        catch { }
                        return UI[lang]["nav.title"];
                    },
                    inject: () => ({})
                }, SettingsSection));
            }
            catch (e) { /* 没有 slots 服务：仍是合法的插件，只是没有设置页 */ }
            try {
                ctx.effect(() => mountLauncher(), "dsh-calendar-pro: floating panel");
            }
            catch (e) { /* 同上 */ }
        }
        /** 把悬浮面板挂到页面上；已经挂过（HMR / 重复 apply）就复用。 */
        function mountLauncher() {
            if (typeof document === "undefined" || document.body === null)
                return () => { };
            if (document.getElementById("dsh-calendar-pro-root") !== null)
                return () => { };
            const host = document.createElement("div");
            host.id = "dsh-calendar-pro-root";
            document.body.appendChild(host);
            let root = null;
            try {
                const ReactDomClient = require("react-dom/client");
                root = ReactDomClient.createRoot(host);
                root.render(h(Launcher, {}));
            }
            catch (e) {
                // 老宿主没有 react-dom/client 时不要静默留下一个空气泡：整个按钮一起撤掉。
                host.remove();
                return () => { };
            }
            return () => {
                try {
                    if (root !== null)
                        root.unmount();
                }
                catch (e) { /* 卸载失败也要把节点摘掉 */ }
                host.remove();
            };
        }
        relocalize = () => { for (const update of languageListeners)
            update(); };
        exports.apply = apply;
        exports.inject = inject;
        return module.exports;
    } });
