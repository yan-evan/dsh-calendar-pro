/**
 * 邮件日程识别的面板部分：把后端识别出的候选变成可一键处理的操作。
 *
 * 四个组件：MailTodoDialog 待确认清单、MailAnalyzeDialog 首次回扫、
 * MailSettingsCard 邮箱连接卡片、MailArrivalToast 新候选轻提示。
 *
 * 点「创建」只打开预填的新建表单，用户核对并保存成功后才把候选标成 created。
 */

const MAIL_CSS = `
.dshc-mail{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:12px;padding:18px;min-width:0;background:transparent}
.dshc-mail h3{margin:0 0 6px;font-size:15px;font-weight:600}
.dshc-mail p.dshc-mail-intro{margin:0 0 12px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#6b7280)}
.dshc-mail-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 14px;margin:10px 0}
.dshc-mail-fields label{display:grid;gap:5px;font-size:12px;min-width:0}
.dshc-mail-fields input,.dshc-mail-fields select{box-sizing:border-box;width:100%;min-width:0;font:inherit;font-size:13px;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;padding:7px}
.dshc-mail-fields .dshc-mail-check{display:flex;align-items:center;gap:6px}
.dshc-mail-fields .dshc-mail-check input{width:auto}
.dshc-mail-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.dshc-mail-status{margin-top:10px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#6b7280);overflow-wrap:anywhere}
.dshc-mail-status.error{color:var(--dsw-alias-state-error-primary,#ad3636)}
.dshc-mail-status.ok{color:var(--dsw-alias-state-success-primary,#1a7f37)}
.dshc-todo-list{display:flex;flex-direction:column;gap:10px;max-height:min(58vh,520px);overflow:auto;padding-right:2px}
.dshc-todo-card{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:11px;padding:12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.dshc-todo-card.is-new{border-color:var(--dsw-alias-state-business-primary,#2563eb);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary,#2563eb) inset}
.dshc-todo-head{display:flex;align-items:flex-start;gap:8px;min-width:0}
.dshc-todo-title{font-weight:600;font-size:14px;min-width:0;overflow-wrap:anywhere;flex:1}
.dshc-todo-badge{flex:0 0 auto;font-size:11px;line-height:18px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#eef2f7);color:var(--dsw-alias-label-tertiary,#6b7280)}
.dshc-todo-card.is-new .dshc-todo-badge{background:var(--dsw-alias-state-business-primary,#2563eb);color:#fff}
.dshc-todo-when{font-size:13px}
.dshc-todo-meta{font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);line-height:1.6;overflow-wrap:anywhere}
.dshc-todo-mail{border-top:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.14));padding-top:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);line-height:1.6}
.dshc-todo-snippet{display:block;margin-top:2px;overflow-wrap:anywhere}
.dshc-todo-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.dshc-todo-empty{padding:22px 0;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#6b7280)}
.dshc-mail-toast{position:fixed;right:18px;bottom:136px;z-index:57;width:min(300px,calc(100vw - 36px));box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-elevation-prominent,0 10px 28px rgba(0,0,0,.2));font-size:13px}
.dshc-mail-toast strong{display:block;margin-bottom:4px}
.dshc-mail-toast p{margin:0 0 8px;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);overflow-wrap:anywhere}
.dshc-mail-toast .dshc-mail-toast-actions{display:flex;gap:8px}
.dshc-fab-badge{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-state-error-primary,#dc2626);color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:600}
`;

/** 回扫天数选项：与后端 MAIL_ANALYZE_DAYS 一致。 */
const MAIL_DAY_VALUES = [1, 3, 7, 30];

/** 天数下拉的选项元素，对话框与设置卡片共用一份。 */
function mailDayOptions() {
  return MAIL_DAY_VALUES.map((value) => h("option", { key: value, value: String(value) }, t("mail.daysOption", { n: value })));
}

/** 服务商预设，和后端 MAIL_PRESETS 对齐；换服务商时自动填主机。 */
const MAIL_PROVIDER_PRESETS = {
  qq: { imapHost: "imap.qq.com", imapPort: 993, imapSecure: true },
  "163": { imapHost: "imap.163.com", imapPort: 993, imapSecure: true },
  gmail: { imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true },
  icloud: { imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true },
  custom: null
};

/**
 * 邮件状态在模块层共享：面板工具条与悬浮按钮都要读，各自轮询会重复请求，
 * 也会破坏「重进页面不发请求」的缓存约定。没人订阅时停表。
 */
const MAIL_STATUS = { value: null, at: 0, timer: null, inflight: null, listeners: new Set() };

/** 已缓存的状态快照；还没拿到就是 null。 */
function mailStatusSnapshot() {
  return MAIL_STATUS.value;
}

/** 拉一次状态；同一时刻只发一个请求，结果广播给所有订阅者。 */
function refreshMailStatus() {
  if (MAIL_STATUS.inflight !== null) return MAIL_STATUS.inflight;
  MAIL_STATUS.inflight = mailApi("status", {}).then((value) => {
    MAIL_STATUS.inflight = null;
    if (value === null || value === undefined) return value;
    MAIL_STATUS.value = value;
    MAIL_STATUS.at = Date.now();
    for (const listener of Array.from(MAIL_STATUS.listeners)) {
      try { listener(value); } catch (error) { /* 单个订阅者出错不影响别人 */ }
    }
    return value;
  }).catch(() => { MAIL_STATUS.inflight = null; return null; });
  return MAIL_STATUS.inflight;
}

/**
 * 订阅邮件状态，返回取消订阅函数。
 * @param listener (value) => void，立即用缓存值回调一次
 * @param intervalMs 轮询间隔；面板要角标及时，悬浮窗可慢一些
 */
function mailStatusSubscribe(listener, intervalMs) {
  MAIL_STATUS.listeners.add(listener);
  if (MAIL_STATUS.timer === null) {
    const period = typeof intervalMs === "number" && intervalMs >= 5000 ? intervalMs : 15000;
    MAIL_STATUS.timer = setInterval(() => { void refreshMailStatus(); }, period);
    // Node 下（含 jsdom 单测）显式清理定时器，否则未订阅的计时器会阻塞进程退出。
    if (MAIL_STATUS.timer !== null && typeof MAIL_STATUS.timer === "object" && typeof MAIL_STATUS.timer.unref === "function")
      MAIL_STATUS.timer.unref();
  }
  if (MAIL_STATUS.value !== null) listener(MAIL_STATUS.value);
  else void refreshMailStatus();
  return function unsubscribe() {
    MAIL_STATUS.listeners.delete(listener);
    if (MAIL_STATUS.listeners.size === 0 && MAIL_STATUS.timer !== null) {
      clearInterval(MAIL_STATUS.timer);
      MAIL_STATUS.timer = null;
    }
  };
}

/** 工具条按钮文案：有待办就带上条数，没有就是纯入口。 */
function mailToolbarLabel(counts) {
  const n = counts !== null && counts !== undefined && typeof counts.pending === "number" ? counts.pending : 0;
  return n > 0 ? t("mail.buttonCount", { n }) : t("mail.button");
}

/** 候选 → 新建日程表单的草稿。时间按本地时区展示，用户看到的就是日历里的样子。 */
function mailCandidateToDraft(candidate) {
  const allDay = candidate.allDay === true;
  const start = startDate(candidate);
  const rawEnd = endDate(candidate);
  let endTime = "";
  let startTime = "";
  if (allDay !== true) {
    const startLocal = start;
    const endLocal = new Date(Math.max(rawEnd.getTime(), startLocal.getTime() + 30 * 60000));
    startTime = hhmm(startLocal);
    // 跨天的事件在「单日 + 起止时刻」的表单里表达不了：压到当天 23:59，用户可再改。
    endTime = dayKey(endLocal) === dayKey(startLocal) ? hhmm(endLocal) : "23:59";
  }
  const source = [];
  if (candidate.mail && candidate.mail.subject) source.push(t("mail.from") + "：" + candidate.mail.from + " · " + candidate.mail.subject);
  return {
    uid: undefined,
    summary: candidate.summary || "",
    date: dayKey(start),
    startTime,
    endTime,
    allDay,
    location: candidate.location || "",
    description: [candidate.description || "", source.join("\n")].filter(Boolean).join("\n\n"),
    repeat: "",
    rrule: "",
    mailTodoId: candidate.id
  };
}

/** 「12月3日 周四 15:00–16:00」这种一句话时间；复用日历自己的格式化，避免两套文案。 */
function mailWhenText(candidate) {
  const start = startDate(candidate);
  const weekday = UI_LANG === "en"
    ? start.toLocaleDateString("en-GB", { weekday: "short" })
    : "周" + WEEKDAYS_ZH[isoWeekday(start) - 1];
  return formatWhen({ allDay: candidate.allDay === true, start: candidate.start, end: candidate.end }) + " · " + weekday;
}

/** 来源邮件一行：谁发的、什么主题、什么时候到的。 */
function mailSourceText(mail) {
  if (!mail) return "";
  const when = mail.date ? new Date(mail.date) : null;
  const stamp = when !== null && Number.isFinite(when.getTime())
    ? formatDay(when) + " " + hhmm(when)
    : "";
  return [mail.from || calendarText("未知发件人", "Unknown sender"), mail.subject || "", stamp].filter(Boolean).join(" · ");
}

/**
 * 待确认清单。
 * @param onPick 点「创建日程」时回调，面板打开预填表单，这里不直接建。
 */
/** 清单里的一条候选：标题、状态、时间、来源、低置信提示与两个动作。 */
function MailTodoItem({ item, busy, onPick, onIgnore }) {
  return h("div", { className: "dshc-todo-card" + (item.isNew === true ? " is-new" : "") }, [
    h("div", { key: "head", className: "dshc-todo-head" }, [
      h("span", { key: "title", className: "dshc-todo-title" }, item.summary || t("mail.untitled")),
      h("span", { key: "state", className: "dshc-todo-badge" }, item.state === "failed" ? t("mail.stateFailed") : t("mail.statePending"))
    ]),
    h("div", { key: "when", className: "dshc-todo-when" }, item.state === "failed" ? t("mail.noTimeParsed") : mailWhenText(item)),
    item.state === "failed" && item.reason ? h("div", { key: "reason", className: "dshc-todo-meta" }, t("mail.failedReason", { message: item.reason })) : null,
    item.location !== "" ? h("div", { key: "loc", className: "dshc-todo-meta" }, t("field.location") + "：" + item.location) : null,
    item.source === "llm" && item.confidence < 0.6
      ? h("div", { key: "conf", className: "dshc-todo-meta" }, t("mail.lowConfidence"))
      : null,
    h("div", { key: "mail", className: "dshc-todo-mail" }, [
      h("span", { key: "src" }, t("mail.source") + "：" + mailSourceText(item.mail)),
      item.mail && item.mail.snippet ? h("span", { key: "snip", className: "dshc-todo-snippet" }, item.mail.snippet) : null
    ]),
    h("div", { key: "acts", className: "dshc-todo-actions" }, [
      h(Btn, { key: "create", variant: "primary", disabled: item.state === "failed" || busy === item.id, onClick: () => onPick(item) }, t("mail.create")),
      h(Btn, { key: "ignore", disabled: busy === item.id, onClick: () => onIgnore(item) }, t("mail.ignore"))
    ])
  ]);
}

function MailTodoDialog(props) {
  const { onClose, onPick, onCounts } = props;
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState(null);
  useUILanguage();

  const apply = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value.items)) setItems(value.items);
    if (value.counts !== undefined && typeof onCounts === "function") onCounts(value.counts);
  };
  const load = async () => {
    try {
      const value = await mailApi("candidates", {});
      apply(value);
    }
    catch (failure) {
      setError(failure && failure.message ? failure.message : String(failure));
    }
  };

  useEffect(() => {
    let alive = true;
    mailApi("status", {}).then((value) => { if (alive) setStatus(value); }).catch(() => { });
    // 打开即视为「看过了」：角标清零，但待办本身留着。
    mailApi("clearNew", {}).then(() => { if (alive) load(); }).catch(() => { if (alive) load(); });
    return () => { alive = false; };
  }, []);

  const dismiss = async (item) => {
    setBusy(item.id);
    setError("");
    try {
      apply(await mailApi("dismiss", { id: item.id }));
    }
    catch (failure) {
      setError(failure && failure.message ? failure.message : String(failure));
    }
    finally {
      setBusy("");
    }
  };
  const pending = items === null ? [] : items.filter((item) => item.state === "pending" || item.state === "failed");
  const body = h("div", { className: "dshc-mail-dialog" }, [
    status !== null && status.analyzedAt === null && status.configured === true
      ? h("p", { key: "hint", className: "dshc-mail-intro" }, t("mail.notAnalyzedHint"))
      : null,
    error !== "" ? h("div", { key: "err", className: "dshc-alert error", role: "alert" }, error) : null,
    items === null
      ? h("p", { key: "loading", className: "dshc-todo-empty" }, t("state.loading"))
      : pending.length === 0
        ? h("p", { key: "empty", className: "dshc-todo-empty" }, status !== null && status.configured !== true ? t("mail.emptyUnconfigured") : t("mail.empty"))
        : h("div", { key: "list", className: "dshc-todo-list" }, pending.map((item) => h(MailTodoItem, {
          key: item.id,
          item,
          busy,
          onPick,
          onIgnore: dismiss
        })))
  ]);

  return h(Dlg, {
    open: true,
    onClose,
    title: t("mail.dialogTitle"),
    closeLabel: calendarText("关闭", "Close"),
    children: body,
    footer: h("div", { className: "dshc-mail-actions" }, [
      h(Btn, { key: "close", onClick: onClose }, calendarText("关闭", "Close"))
    ])
  });
}

/**
 * 首次回扫：先选范围（1/3/7/30 天），再显示进度，最后给结论。
 * 进度来自后端 job，重开对话框不会假装跑完。
 */
function MailAnalyzeDialog(props) {
  const { open, onClose, onDone } = props;
  const [phase, setPhase] = useState("ask");
  const [days, setDays] = useState(7);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  useUILanguage();

  useEffect(() => {
    if (open !== true || phase !== "running") return () => { };
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const value = await mailApi("analyzeStatus", {});
        if (!alive) return;
        setJob(value.job);
        if (value.job && value.job.running !== true) {
          setPhase("done");
          if (typeof onDone === "function") onDone(value.job);
        }
      }
      catch (failure) { /* 单次轮询失败不终止整个对话框 */ }
    }, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [open, phase]);

  const start = async () => {
    setError("");
    setPhase("running");
    try {
      const value = await mailApi("analyzeStart", { days });
      setJob(value.job);
    }
    catch (failure) {
      setError(failure && failure.message ? failure.message : String(failure));
      setPhase("ask");
    }
  };

  const content = phase === "ask"
    ? h("div", { key: "ask" }, [
      h("p", { key: "p1", className: "dshc-mail-intro" }, t("mail.analyzeIntro")),
      h("div", { key: "field", className: "dshc-mail-fields" }, h("label", { key: "days" }, [
        h("span", { key: "l" }, t("mail.analyzeDays")),
        h("select", {
          key: "s", value: String(days), onChange: (event) => setDays(Number(event.target.value))
        }, mailDayOptions())
      ])),
      error !== "" ? h("div", { key: "err", className: "dshc-alert error", role: "alert" }, error) : null
    ])
    : phase === "running"
      ? h("div", { key: "run" }, [
        h("p", { key: "phase", className: "dshc-mail-intro" }, t("mail.analyzeRunning", {
          done: job && job.done ? job.done : 0,
          total: job && job.total ? job.total : 0
        })),
        job && job.message ? h("p", { key: "msg", className: "dshc-todo-meta" }, job.message) : null,
        h("div", { key: "bar", className: "dshc-refresh", role: "status" }, h("span", { key: "b" }))
      ])
      : h("div", { key: "done" }, [
        job && job.error
          ? h("p", { key: "err", className: "dshc-mail-status error" }, t("mail.analyzeFailed", { message: job.error }))
          : h("p", { key: "ok", className: "dshc-mail-status ok" }, t("mail.analyzeDone", { n: job && job.added ? job.added : 0 }))
      ]);

  const footer = phase === "ask"
    ? h("div", { key: "acts", className: "dshc-mail-actions" }, [
      h(Btn, { key: "start", variant: "primary", onClick: start }, t("mail.analyzeStart")),
      h(Btn, { key: "later", onClick: onClose }, t("mail.analyzeLater"))
    ])
    : phase === "running"
      ? h("div", { key: "busy", className: "dshc-mail-actions" }, h("span", { className: "dshc-mail-intro" }, t("mail.analyzeKeepOpen")))
      : h("div", { key: "close", className: "dshc-mail-actions" }, h(Btn, { key: "ok", variant: "primary", onClick: onClose }, calendarText("关闭", "Close")));

  return h(Dlg, {
    open: open === true,
    onClose: phase === "running" ? () => { } : onClose,
    title: t("mail.analyzeTitle"),
    closeLabel: calendarText("关闭", "Close"),
    children: content,
    footer
  });
}

/** 设置页的邮箱连接卡片。保存成功且还没回扫过时，自动弹出「要不要现在分析」。 */
function MailSettingsCard() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    enabled: true, provider: "qq", user: "", password: "", imapHost: "imap.qq.com", imapPort: 993, imapSecure: true,
    inboxFolder: "INBOX", analyzeDays: 7, pollSeconds: 60, useLlm: true
  });
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useUILanguage();

  useEffect(() => {
    let alive = true;
    mailApi("status", {}).then((value) => {
      if (!alive || value === null || value === undefined) return;
      setStatus(value);
      setForm((prev) => Object.assign({}, prev, {
        enabled: value.enabled !== false,
        provider: value.provider || prev.provider,
        user: value.user || "",
        password: "",
        imapHost: value.imapHost || prev.imapHost,
        imapPort: value.imapPort || prev.imapPort,
        imapSecure: value.imapSecure !== false,
        inboxFolder: value.inboxFolder || prev.inboxFolder,
        analyzeDays: value.analyzeDays || prev.analyzeDays,
        pollSeconds: value.pollSeconds || prev.pollSeconds,
        useLlm: value.useLlm !== false
      }));
    }).catch((failure) => { if (alive) setError(failure && failure.message ? failure.message : String(failure)); });
    return () => { alive = false; };
  }, [refresh]);

  const patch = (fields) => setForm((prev) => Object.assign({}, prev, fields));
  /** 一行「标签 + 控件」，保持设置页各字段的排布一致。 */
  const field = (key, label, control) => h("label", { key }, [h("span", { key: "l" }, label), control]);
  const checkField = (key, label, checked, onChange) => h("label", { key, className: "dshc-mail-check" }, [
    h("input", { key: "i", type: "checkbox", checked, onChange: (event) => onChange(event.target.checked) }),
    h("span", { key: "l" }, label)
  ]);
  const changeProvider = (value) => {
    const preset = MAIL_PROVIDER_PRESETS[value];
    patch(preset === null ? { provider: value } : { provider: value, imapHost: preset.imapHost, imapPort: preset.imapPort, imapSecure: preset.imapSecure });
  };

  const save = async () => {
    setBusy("save");
    setError("");
    setNote("");
    try {
      const value = await mailApi("saveConfig", { config: form });
      setStatus(value);
      setNote(t("mail.saved"));
      setRefresh((n) => n + 1);
      if (value && value.configured === true && value.analyzedAt === null) setAnalyzeOpen(true);
    }
    catch (failure) {
      setError(failure && failure.message ? failure.message : String(failure));
    }
    finally {
      setBusy("");
    }
  };
  const test = async () => {
    setBusy("test");
    setError("");
    setNote("");
    try {
      const value = await mailApi("testConnection", { config: form });
      setNote(value && value.detail ? value.detail : t("mail.testOk"));
    }
    catch (failure) {
      setError(failure && failure.message ? failure.message : String(failure));
    }
    finally {
      setBusy("");
    }
  };

  const configured = status !== null && status.configured === true;
  const statusLine = configured
    ? t("mail.statusConnected", { user: status.user || "", host: status.imapHost || "" })
    : t("mail.statusUnconfigured");
  const analyzedLine = status !== null && status.analyzedAt
    ? t("mail.statusAnalyzed", { when: new Date(status.analyzedAt).toLocaleString() })
    : t("mail.statusNotAnalyzed");
  const lastError = status !== null && status.lastError ? status.lastError : "";
  // 两个下拉先算好选项，fields 里只负责摆放。
  const providerOptions = ["qq", "163", "gmail", "outlook", "icloud", "custom"].map((value) => h("option", { key: value, value: value }, t("mail.provider." + value)));
  const dayOptions = mailDayOptions();

  return h("div", { className: "dshc-mail" }, [
    h("h3", { key: "title" }, t("mail.settingsTitle")),
    h("p", { key: "intro", className: "dshc-mail-intro" }, t("mail.settingsIntro")),
    h("div", { key: "fields", className: "dshc-mail-fields" }, [
      field("provider", t("mail.provider"), h("select", { key: "s", value: form.provider, onChange: (event) => changeProvider(event.target.value) }, providerOptions)),
      field("user", t("mail.user"), h("input", { key: "i", type: "email", autoComplete: "off", value: form.user, placeholder: "you@example.com", onChange: (event) => patch({ user: event.target.value }) })),
      field("password", t("mail.password"), h("input", {
        key: "i", type: "password", autoComplete: "new-password", value: form.password,
        placeholder: status !== null && status.hasPassword === true ? t("mail.passwordSaved") : t("mail.passwordHint"),
        onChange: (event) => patch({ password: event.target.value })
      })),
      field("host", t("mail.imapHost"), h("input", { key: "i", value: form.imapHost, onChange: (event) => patch({ imapHost: event.target.value }) })),
      field("port", t("mail.imapPort"), h("input", { key: "i", type: "number", value: String(form.imapPort), onChange: (event) => patch({ imapPort: Number(event.target.value) }) })),
      field("folder", t("mail.folder"), h("input", { key: "i", value: form.inboxFolder, onChange: (event) => patch({ inboxFolder: event.target.value }) })),
      field("poll", t("mail.poll"), h("input", { key: "i", type: "number", min: "30", max: "3600", value: String(form.pollSeconds), onChange: (event) => patch({ pollSeconds: Number(event.target.value) }) })),
      field("days", t("mail.defaultDays"), h("select", { key: "s", value: String(form.analyzeDays), onChange: (event) => patch({ analyzeDays: Number(event.target.value) }) }, dayOptions)),
      checkField("secure", t("mail.imapSecure"), form.imapSecure === true, (checked) => patch({ imapSecure: checked })),
      checkField("llm", t("mail.useLlm"), form.useLlm !== false, (checked) => patch({ useLlm: checked })),
      checkField("enabled", t("mail.enabled"), form.enabled !== false, (checked) => patch({ enabled: checked }))
    ]),
    h("div", { key: "acts", className: "dshc-mail-actions" }, [
      h(Btn, { key: "test", disabled: busy !== "", onClick: test }, busy === "test" ? t("mail.testing") : t("mail.testConnection")),
      h(Btn, { key: "save", variant: "primary", disabled: busy !== "", onClick: save }, busy === "save" ? "…" : t("action.save")),
      // 已配置就能重扫：首次回扫跳过之后仍要留一个入口。
      configured && status
        ? h(Btn, { key: "again", onClick: () => setAnalyzeOpen(true) }, t("mail.reanalyze"))
        : null
    ]),
    h("div", { key: "status", className: "dshc-mail-status" + (configured ? " ok" : "") }, [
      h("div", { key: "conn" }, statusLine),
      h("div", { key: "analyzed" }, analyzedLine),
      status !== null && status.llmAvailable !== true && form.useLlm !== false
        ? h("div", { key: "nollm" }, t("mail.noLlm"))
        : null,
      lastError !== "" ? h("div", { key: "err", className: "dshc-mail-status error" }, t("mail.lastError", { message: lastError })) : null,
      note !== "" ? h("div", { key: "note", className: "dshc-mail-status ok" }, note) : null,
      error !== "" ? h("div", { key: "e", className: "dshc-mail-status error", role: "alert" }, error) : null
    ]),
    h(MailAnalyzeDialog, {
      key: "analyze",
      open: analyzeOpen,
      onClose: () => { setAnalyzeOpen(false); setRefresh((n) => n + 1); },
      onDone: () => { setRefresh((n) => n + 1); }
    })
  ]);
}

/** 新邮件识别到日程时的轻提示：只负责「告诉 + 带路」，不替用户做决定。 */
function MailArrivalToast(props) {
  const { count, onOpen, onClose } = props;
  useUILanguage();
  return h("div", { className: "dshc-mail-toast", role: "status", "aria-live": "polite" }, [
    h("strong", { key: "t" }, t("mail.toastTitle", { n: count })),
    h("p", { key: "p" }, t("mail.toastBody")),
    h("div", { key: "a", className: "dshc-mail-toast-actions" }, [
      h(Btn, { key: "open", variant: "primary", onClick: onOpen }, t("mail.toastOpen")),
      h(Btn, { key: "close", onClick: onClose }, t("mail.toastLater"))
    ])
  ]);
}
