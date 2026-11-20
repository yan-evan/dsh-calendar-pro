# Changelog

> **Language**: English (this page) · [中文](CHANGELOG.md)
>
> See also: [README](README.en.md) · [User manual](MANUAL.en.md)

All notable changes to this project are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-20

### Added

- **Mail schedule detection (the headline of this release)**: connect a read-only inbox and turn times written in email into schedule candidates. Fill in the mailbox and IMAP app password in Settings — QQ Mail, 163, Gmail, Outlook and iCloud have presets. The plugin connects to IMAP itself: nothing is sent, deleted, marked as read or moved
- **Candidates instead of silent writes**: detected schedules go to a review list first; "Create event" opens a pre-filled form and only saving writes to the calendar. One email can carry several candidates, each created or ignored on its own
- **Optional first scan**: after connecting, you are asked whether to scan recent mail — 1 / 3 / 7 / 30 days (7 by default). Skipping still allows "Scan mail again" at any time, and processed mail does not produce duplicates
- **New-mail nudge**: new mail is checked on the poll interval (60 seconds by default); a detected schedule puts a red badge on the floating button and shows a light toast above it. Review opens the list itself, not the calendar
- **`.ics` invitations first**: mail with a calendar invite is parsed from the attachment, which is more accurate than reading the body
- **What it reads**: absolute dates (`11月21日下午5点`, `2026-11-21 17:00`) and relative ones (today / tomorrow / next Wednesday); casual invitations without a "会议时间：" label (`明天下午5点，请到C992会议室`) also yield candidates; mail with a labelled info block is read even when no model is available
- **Notes carry the schedule elements**: online meetings put the join link and meeting number into the description, one per line, instead of a generic "read from the body" note

### Changed

- **Find available time is a modal now**: it no longer takes over the calendar page — the calendar stays behind it. The dialog is about 760px wide, filters stay fixed while the candidate list scrolls, and filters go single-column with a near full-screen dialog on narrow displays. Picking a candidate fills the new-event form directly
- **Per-item handling only**: each candidate offers just "Create event" and "Ignore"; when one email yields several schedules they are handled one by one. With no candidates the list shows a single line instead of scan statistics

## [0.1.3] - 2026-11-13

### Fixed

- The self-check falsely reported "no CalDAV account configured" in local calendar mode; it now branches on the active data source
- A single-day all-day event without DTEND was invisible to queries covering its own day; its end date now defaults to the next day per RFC 5545
- A migration with failed items still switched the data source; failures now abort the migration and keep the current source
- Deleting or editing a recurring series in the local calendar needed no confirmation; it now requires `scope="series"` like CalDAV
- Free/busy candidates on a daylight-saving switch day repeated or missed local hours; they are now filtered by local wall clock
- Changing only the start time produced a VEVENT whose DTSTART and DTEND value types disagreed; the end now converts along with it and is validated
- The end of a query window meant different things per path; all paths now use the half-open interval `[start, end)`
- Recurrence expansion hitting its limit was still presented as a complete result; it now returns `complete=false` and notes the truncation
- Comments and the README disagreed with the implementation on tool count and supported Node version

## [0.1.2] - 2026-11-11

### Fixed

- The calendar page did not refresh after a CalDAV connection was saved, so the new data only appeared after a manual refresh. A stale call in the save callback threw before the refresh could run. Saving now reloads immediately, and the main view, floating panel and settings page all refresh together

## [0.1.1] - 2026-11-10

### Added

- Update notice: checks for a newer version once a day and shows a dismissible banner at the top
- GitHub link in the home-page subtitle

### Changed

- iCloud connection form: username and password first, CalDAV URL after auto-discovery

### Fixed

- Local calendar mode wrongly showed the "no CalDAV account configured" page after switching views and returning

## [0.1.0] - 2026-11-07

First release. A calendar plugin for DSH that works out of the box and lets the agent manage your schedule.

### Added

**Let the agent take over your schedule**

- Natural-language queries: ask "What's on next Wednesday?" and recurring events expand into individual occurrences automatically
- Create, edit and delete by conversation: one sentence is enough, with full support for all-day events and recurrence rules (RRULE)
- Free-slot suggestions: give a duration and your preferences to get bookable candidates, weekdays 09:00–18:00 by default
- Full-text search: matches titles, descriptions and locations, so you don't need to remember the month
- Confirmation before destructive actions: before deleting a recurring series or a batch of events, the agent explains the scope and waits for your approval

**Your schedule across devices**

- CalDAV support: iCloud, Google, Nextcloud, and any other CalDAV-compatible service
- Native reminders: once synced, iPhone, iPad and Mac remind you through the system Calendar
- Two-way sync: an event added on your phone shows up on your computer, and a time changed on your computer updates on your phone
- One schedule, consistent everywhere: check it on your phone while travelling, edit it at your desk

**Designed to be easy**

- Floating calendar: open it from the bottom-right corner of a conversation without interrupting your chat; press Esc to close
- Lunar calendar and public holidays: holiday and make-up workday badges appear directly on the date cells
- Cycle tracking: record your cycle and predict the next period, with data stored only on this machine
- Direct manipulation: click to open details, drag to reschedule, click empty space to create — no page jumps
- Bilingual UI: follows the DSH display language automatically, no separate setting

**A full traditional calendar, too**

- Local calendar: zero configuration, no account, fully usable without connecting to any server
- Manual editing: month / week / agenda views, click to create, drag to reschedule, all without the agent
- ICS import and export: move in from another calendar without retyping, or export your data any time

### Known limitations

- Requires DSH `>= 0.2.1-rc.3` and Node `^22.19.0 || >= 24.0.0`
- During 0.x, internal interfaces may change between minor versions; check the notes for the version you're upgrading to
