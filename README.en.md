<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/assets/logo_with_name_dark.svg" />
    <img alt="dsh-calendar-pro" src="/assets/logo_with_name.svg" width="420" />
  </picture>
</p>

<h3 align="center">A calendar plugin for DSH: ready to use, with an agent that manages your schedule.</h3>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%5E22.19%20%7C%20%3E24-green.svg" alt="Node" /></a>
  <a href="https://github.com/deepseek-ai"><img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-purple.svg" alt="DSH" /></a>
</p>

<p align="center">
| <a href="#quick-start"><b>Quick start</b></a> | <a href="MANUAL.en.md"><b>User manual</b></a> | <a href="CHANGELOG.en.md"><b>Changelog</b></a> | <a href="README.md"><b>中文</b></a> |
</p>

---

> **Language**: English (this page) · [中文](README.md)
>
> Other documents: [User manual](MANUAL.en.md) · [Changelog](CHANGELOG.en.md)

## About

dsh-calendar-pro is a calendar plugin for [DSH (DeepSeek Harness)](https://github.com/deepseek-ai).

**Let the agent take over your schedule:**

- **Natural-language queries**: just ask "What's on next Wednesday?" — recurring events expand into individual occurrences automatically
- **Create, edit, delete by conversation**: one sentence is enough; all-day events and recurrence rules (RRULE) are fully supported
- **Free-slot suggestions**: tell it the duration and your preferences to get bookable candidates, weekdays 09:00–18:00 by default
- **Full-text search**: matches titles, descriptions and locations, so you don't need to remember which month it was in
- **Confirmation before destructive actions**: before deleting a recurring series or a batch of events, the agent explains the scope and waits for your approval

**Your schedule across devices:**

- **CalDAV support**: iCloud, Google, Nextcloud, and any other CalDAV-compatible service
- **Native reminders**: once synced, iPhone, iPad and Mac remind you through the system Calendar — no extra app needed
- **Two-way sync**: an event added on your phone shows up on your computer, and a time changed on your computer is updated on your phone
- **One schedule, consistent everywhere**: check it on your phone while travelling, edit it at your desk, always the same data

**Designed to be easy:**

- **Floating calendar**: open it from the bottom-right corner of a conversation without interrupting your chat; press Esc to close
- **Lunar calendar and public holidays**: holiday and make-up workday badges appear directly on the date cells
- **Cycle tracking**: record your cycle and see the next predicted period, with data stored only on this machine
- **Direct manipulation**: click to open details, drag to reschedule, click empty space to create — no page jumps
- **Bilingual UI**: follows the DSH display language automatically, no separate setting

**A full traditional calendar, too:**

- **Local calendar**: zero configuration, no account, fully usable without connecting to any server
- **Manual editing**: month / week / agenda views, click to create, drag to reschedule, all without the agent
- **ICS import and export**: move in from another calendar without retyping, or export your data any time
- **Predictable results**: every calendar operation gives a definite outcome

For detailed usage of every feature, see the [User manual](MANUAL.en.md). For what changed in each release, see the [Changelog](CHANGELOG.en.md).

## Quick start

**Install from npm:**

```bash
dsh plugin --profile web add dsh-calendar-pro
dsh   # after it restarts, "Calendar" appears in the sidebar
```

You can also skip the command line entirely: open **DSH → Plugins → Install plugin**, type `dsh-calendar-pro` and confirm.

**Install from source:**

```bash
dsh plugin --profile web add file:/absolute/path/to/this/project
dsh
```

**Install from a third-party plugin marketplace:**

Search for `dsh-calendar-pro` in the DSH plugin marketplace and click Install.

Once installed, try saying something to the agent:

```
You: Which day next week works for a two-hour retrospective?
DSH: Tuesday 14:00–16:00 and Thursday 10:00–12:00 are both free. Shall I book Tuesday?

You: Book it for Tuesday at 2 pm, title "Q4 Retro".
DSH: Created.
```

**Uninstall:**

`dsh plugin --profile web remove dsh-calendar-pro`.

## Community & Feedback

Follow the WeChat official account to chat with me:

![WeChat official account QR code](assets/wechat-qr.jpg)

Questions, ideas and feature requests are welcome — please [open an issue](https://github.com/yan-evan/dsh-calendar-pro/issues). Pull requests are welcome too.

## Credits

This project is based on [STARDUSTLC666/dsh-calendar](https://github.com/STARDUSTLC666/dsh-calendar) **v0.14.3**. Thanks to the original author [stardustlc](https://github.com/STARDUSTLC666) and the upstream community for the solid foundation.

| Feature | dsh-calendar 0.14.3 | dsh-calendar-pro |
| --- | --- | --- |
| Local calendar | No | **Yes** |
| Migrating between data sources | No | **Yes** |
| Lunar calendar, public holidays, make-up workdays | No | **Yes** |
| Cycle tracking and prediction | No | **Yes** |
| ICS export | No | **Yes** |
| Ease of use | Good | **Better** |
| CalDAV connection | Yes | Yes |
| Agent tools | Yes | Yes |
| Calendar views and manual editing | Yes | Yes |
| Recurring and all-day events | Yes | Yes |
| ICS import | Yes | Yes |
| Floating calendar and bilingual UI | Yes | Yes |

## License

[MIT](LICENSE)
