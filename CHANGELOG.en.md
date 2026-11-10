# Changelog

> **Language**: English (this page) · [中文](CHANGELOG.md)
>
> See also: [README](README.en.md) · [User manual](MANUAL.en.md)

All notable changes to this project are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

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
