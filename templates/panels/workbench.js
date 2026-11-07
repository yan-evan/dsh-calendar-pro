function calendarText(zh, en) { return UI_LANG === 'en' ? en : zh; }
/**
 * 工作台页面的样式覆盖层。
 *
 * 这一层的唯一目标：**一屏之内装下整个日历，页面本身不出现滚动条**。
 * 做法是把 `.w-page` / `.w-body` 原本的 `overflow:auto` 改成 `hidden`，再把剩余高度
 * 一路 flex 传给 `.dshc-view`，由各视图自己吃掉：
 *   · 月视图：6 行等分（grid-template-rows:repeat(6,minmax(0,1fr))），一格放得下几条由 JS 实测算；
 *   · 周视图：时间轴高度由 JS 实测写进 --timeline-h，窗口内的时段线性铺满，不再有「24 小时刻度」；
 *   · 议程：列表内部滚动，页面仍然不动。
 * 页脚（`.dshc-footer`）因此天然停在内容区最后一行，也就是页面右下角。
 *
 * 两个坑记在这：
 *   1. 所有规则都带 `.calendar-workbench` 前缀。宿主 `.w-page` 的那套样式是行内 <style>，
 *      与插件样式同在一个文档里，只靠顺序不稳，靠选择器权重才稳。
 *   2. 不要给列写 `minmax(65px,1fr)` 这类硬下限 —— 窄容器下它会把网格撑宽，
 *      于是又冒出左右滚动条。一律 `minmax(0,1fr)`。
 */
const CALENDAR_WORKBENCH_CSS = `
.calendar-workbench.w-page[data-main=true]{overflow:hidden;padding-bottom:18px}
.calendar-workbench .w-body{overflow:hidden;min-height:0;min-width:0}
.calendar-workbench .w-page-header{padding-bottom:16px}
.calendar-workbench .dshc-root{font-size:14px;min-width:0;min-height:0;display:flex;flex-direction:column;flex:1}
.calendar-workbench .dshc-shell{border:0;border-radius:0;padding:0;background:transparent;box-shadow:none;max-width:none;min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
.calendar-workbench .dshc-alert,.calendar-workbench .dshc-undo{flex:0 0 auto}
.calendar-workbench .dshc-import{flex:0 0 auto;max-height:42%;overflow:auto}
.calendar-workbench .calendar-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:0 0 14px;flex:0 0 auto}
.calendar-workbench .calendar-period{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.calendar-workbench .calendar-period strong{font-size:20px;min-width:140px;text-align:center;font-weight:600}
.calendar-workbench .calendar-view-controls{display:flex;align-items:center;gap:4px}
.calendar-workbench .calendar-view-controls .w-button{border-radius:6px;border-color:transparent;min-width:50px;padding:7px 12px}
.calendar-workbench .calendar-view-controls [aria-pressed=true]{background:var(--w-selected);color:var(--w-accent)}

/* 视图容器：三种视图都撑满剩余高度，自己不滚 */
.calendar-workbench .dshc-view{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.calendar-workbench .dshc-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px}
.calendar-workbench .dshc-loading,.calendar-workbench .dshc-start{flex:1}
.calendar-workbench .dshc-footer{flex:0 0 auto;min-height:16px}
.calendar-workbench .dshc-alert,.calendar-workbench .dshc-undo,.calendar-workbench .dshc-refresh{flex:0 0 auto}

/* ── 月视图：6 行等分，格子里的条数由 JS 按实测行高算 ── */
.calendar-workbench .dshc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:0;margin:0!important}
.calendar-workbench .dshc-dowgrid{flex:0 0 auto;border-block-start:1px solid var(--w-border);border-inline-start:1px solid var(--w-border)}
.calendar-workbench .dshc-dow{padding:8px 0;text-align:center;border-inline-end:1px solid var(--w-border);font-size:12px;color:var(--w-muted)}
.calendar-workbench .dshc-monthgrid{flex:1;min-height:0;grid-template-rows:repeat(6,minmax(0,1fr));border-inline-start:1px solid var(--w-border);border-block-end:1px solid var(--w-border)}
.calendar-workbench .dshc-cell{display:block;width:100%;min-height:0;overflow:hidden;border-radius:0;padding:5px 7px;background:transparent;border:0;border-block-start:1px solid var(--w-border);border-inline-end:1px solid var(--w-border);cursor:pointer;text-align:left;font:inherit;color:inherit}
.calendar-workbench .dshc-cell:hover{background:color-mix(in srgb,var(--w-accent) 5%,transparent)}
.calendar-workbench .dshc-cell.out{background:var(--w-soft);opacity:.6}
.calendar-workbench .dshc-daynum{font-size:12px;line-height:20px;color:var(--w-text);margin:0 0 3px;display:flex;justify-content:space-between}
.calendar-workbench .dshc-cell.today{border-color:var(--w-border)}
.calendar-workbench .dshc-cell.today .dshc-daynum b{width:20px;height:20px;padding:0;text-align:center;border-radius:50%;background:var(--w-accent);color:#fff;font-size:12px;font-weight:600;line-height:20px}
.calendar-workbench .dshc-chip{display:block;width:100%;height:15px;line-height:15px;text-align:left;border:0;border-left:3px solid var(--w-accent);background:var(--w-soft);color:var(--w-text);border-radius:3px;padding:0 5px;margin:0 0 2px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.calendar-workbench .dshc-chip:hover{background:var(--w-selected)}
.calendar-workbench .dshc-chip.allday{border-left-color:var(--dsw-alias-state-success-primary,#16a34a)}
.calendar-workbench .dshc-chip.recurring{border-left-color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.calendar-workbench .dshc-more{font-size:10px;line-height:15px;color:var(--w-muted);padding-left:3px}

/* ── 农历副文本 + 法定节假日「休 / 班」角标 ── */
.calendar-workbench .dshc-lunar{font-size:10px;line-height:1;color:var(--w-muted);max-width:58%}
.calendar-workbench .dshc-lunar.festival{color:var(--w-accent)}
/* 日号 + 角标一组靠左、农历靠右；角标不再绝对定位，就不会盖住农历。 */
.calendar-workbench .dshc-daylead{gap:5px}
/* 周表头 / 议程日期行：农历与「今天」并排，字号跟随各自容器，别一个 10px 一个 12px。 */
.calendar-workbench .dshc-dayhead .dshc-lunar{font-size:11px;line-height:inherit;color:var(--w-muted);max-width:none}
.calendar-workbench .dshc-daylabel .dshc-lunar{font-size:12px;line-height:inherit;color:var(--w-muted);max-width:none}

/* ── 周视图：时间轴吃满剩余高度，窗口内线性铺开，不滚动 ── */
.calendar-workbench .dshc-allday{flex:0 0 auto;padding:0 0 6px}
.calendar-workbench .dshc-week{flex:1;min-height:0;max-height:none;overflow:hidden}
.calendar-workbench .dshc-weekcol{min-width:0;min-height:0}
.calendar-workbench .dshc-weekcol+.dshc-weekcol{border-inline-start:1px solid var(--w-border)}
.calendar-workbench .dshc-dayhead{border-inline-end:0;font-size:11px}
.calendar-workbench .dshc-hourrail{border-right:0;background-image:repeating-linear-gradient(to bottom,var(--w-border) 0 1px,transparent 1px var(--line-h,44px))}
.calendar-workbench .dshc-daycol{border-left:0;background-image:repeating-linear-gradient(to bottom,var(--w-border) 0 1px,transparent 1px var(--line-h,44px))}
.calendar-workbench .dshc-daycol.today{background-color:color-mix(in srgb,var(--w-accent) 6%,transparent)}
.calendar-workbench .dshc-slot{border-radius:3px;padding:1px 4px;font-size:10px;line-height:1.25;overflow:hidden;container-type:size;container-name:dshc-slot}
.calendar-workbench .dshc-slot-title{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.calendar-workbench .dshc-slot-time{display:none;opacity:.8;white-space:nowrap;font-variant-numeric:tabular-nums}
@container dshc-slot (min-height:32px){.calendar-workbench .dshc-slot-time{display:block}}
@container dshc-slot (min-height:54px){.calendar-workbench .dshc-slot-title{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}}
.calendar-workbench .dshc-resize{height:5px;border-radius:0}

/* ── 议程：列表自己滚，页面不动 ── */
.calendar-workbench .dshc-agenda{flex:1;min-height:0;max-height:none;overflow:auto;padding-right:6px}
.calendar-workbench .dshc-daylabel{background:var(--w-bg)}

/* ── 页脚：永远停在页面右下角，左提示 + 右账号同一行，不加分割线 ── */
.calendar-workbench .dshc-footer{flex:0 0 auto;margin:0;padding:6px 2px 0;justify-content:flex-end;gap:14px;font-size:11px;color:var(--w-muted);text-align:right}
.calendar-workbench .dshc-footer>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

@container dsh-workbench (max-width:760px){.calendar-workbench .calendar-toolbar{gap:10px}.calendar-workbench .calendar-period{gap:4px}.calendar-workbench .calendar-period strong{font-size:17px;min-width:116px}.calendar-workbench .calendar-view-controls{width:100%;justify-content:space-between;border-top:1px solid var(--w-border);padding-top:10px}.calendar-workbench .dshc-cell{padding:3px 3px}.calendar-workbench .dshc-daynum{font-size:11px;line-height:16px;margin-bottom:2px}.calendar-workbench .dshc-chip{font-size:10px;padding:0 3px}.calendar-workbench .dshc-chip .t{display:none}.calendar-workbench .dshc-dow{font-size:11px;padding:6px 0}.calendar-workbench .dshc-week{grid-template-columns:30px repeat(7,minmax(0,1fr))}.calendar-workbench .dshc-hourlabel{font-size:9px;right:2px}.calendar-workbench .dshc-dayhead .dshc-lunar{display:none}.calendar-workbench .dshc-footer{font-size:10px}}
`;
