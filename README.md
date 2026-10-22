<!-- Standard ARIA WIRE™ Open Source Repository Header -->

<p align="center">
  <a href="https://www.ariawave.tech">
    <img src="https://www.ariawave.tech/AriaLogoWhiteLarge.png" alt="ARIA Logo" width="180" />
  </a>
</p>

<p align="center">
  <a href="https://www.ariawave.tech/open-source?utm_source=github&utm_medium=repo-badge&utm_campaign=google-zoom-scheduler"><img src="https://img.shields.io/badge/ARIAWAVE-Sovereign_Scheduling-00f0ff?style=for-the-badge" alt="AriaWave Sovereign Scheduling" /></a>
  <a href="https://www.ariawave.tech"><img src="https://img.shields.io/badge/Zero_SaaS_Tax-No_Calendly_Fees-10b981?style=for-the-badge" alt="Zero SaaS Tax" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-38bdf8?style=for-the-badge" alt="MIT License" /></a>
</p>

<h1 align="center">AriaWave Sovereign Google Calendar + Zoom Scheduler</h1>

<p align="center">
  <strong>Zero-Dependency Multi-Calendar Google Free/Busy Engine, Dynamic Zoom Meeting Provisioner, Next.js Booking Widget & Autonomous Agent Skill (<code>SKILL.md</code>).</strong><br/>
  Engineered by <a href="https://www.ariawave.tech">Aria Technology Group</a> ("Anti-Slop Architecture • Sovereign Systems")
</p>

---

## Overview

Most businesses pay $15–$25/seat/month for third-party scheduling wrappers (Calendly, Cal.com Cloud, Chili Piper) that inject slow third-party iframes, leak lead telemetry, and break on mobile viewports.

**`ariawave-google-zoom-scheduler`** replaces SaaS scheduling middlemen with a **100% self-owned, zero-dependency Google Calendar + Zoom scheduling stack**:
- **Multi-Calendar `freeBusy` Aggregation:** Queries multiple Google Workspace calendars in parallel (e.g., `@aria.net` + `@ariawave.tech`) with automatic 10-minute pre/post buffers so you are never double-booked.
- **Dual-Mode Zoom Provisioning:** Mints unique per-meeting Zoom links via **Zoom Server-to-Server OAuth API** (`POST /v2/users/me/meetings`), with automatic fallback to a verified Zoom Personal Meeting Room (PMI).
- **Human-in-the-Loop (HITL) Email Safety:** Defaults to `sendUpdates="none"` so autonomous agents never blast unapproved external invites without human confirmation, while returning instant **Zoom Join credentials**, **1-Click Google Calendar Template URLs**, and **RFC-5545 `.ics` downloads** directly to the user.
- **Drop-In Next.js App Router + Agent Skill (`SKILL.md`):** Includes production TypeScript API routes, a responsive React booking component, and a zero-dependency Python 3 CLI for Claude Code, Antigravity, and Hermes agents.

---

## Architecture Comparison: Anti-Slop vs. SaaS Wrappers

| Capability | Third-Party SaaS (Calendly / Cal Cloud) | AriaWave Sovereign Scheduler |
|---|---|---|
| **Monthly Seat Cost** | $15–$30 / user / month | **$0 (Uses your existing Google + Zoom)** |
| **Multi-Domain Calendar Sync** | Paid higher tiers only | **Built-in parallel `freeBusy` fan-out** |
| **Zoom Meeting Creation** | OAuth wrapper | **Direct Zoom S2S OAuth + PMI fallback** |
| **Agentic CLI + `SKILL.md`** | None | **Included (`schedule_zoom_meeting.py`)** |
| **HITL Email Guardrail** | None (auto-blasts attendees) | **`sendUpdates=none` default + `.ics` / GCal link** |

---

## Quick Start

### 1. Autonomous Agent CLI (`schedule_zoom_meeting.py`)

```bash
# Check live available 30-minute windows across the next 5 business days
python3 scripts/schedule_zoom_meeting.py --check-slots --days 5

# Stage a Google Calendar + Zoom meeting (HITL safe mode: sendUpdates=none)
python3 scripts/schedule_zoom_meeting.py \
  --book \
  --title "Aria Strategy & Architecture Consult" \
  --start "2026-10-23T14:30:00-04:00" \
  --duration 30 \
  --attendee-name "Jane Doe" \
  --attendee-email "jane@example.com" \
  --topic "Proxmox cluster migration & autonomous agent cleanroom"
```

### 2. Next.js App Router Integration

1. Copy `src/google-zoom-scheduler.ts` to `lib/google-zoom-scheduler.ts`.
2. Copy `src/Scheduler.tsx` to `components/Scheduler.tsx`.
3. Expose `GET /api/calendar/availability` and `POST /api/calendar/book`.
4. Configure `.env.local` (see `.env.example`).

---

## Repository Structure

```text
ariawave-google-zoom-scheduler/
├── SKILL.md                             # Autonomous Agent Skill (Antigravity / Hermes / Claude Code)
├── scripts/
│   └── schedule_zoom_meeting.py         # Zero-dependency Python 3 CLI for free/busy & booking
├── src/
│   ├── google-zoom-scheduler.ts         # Core TypeScript Google freeBusy + Zoom S2S engine
│   └── Scheduler.tsx                    # Responsive React / Next.js live booking component
├── .env.example                         # Environment variable template
├── LICENSE                              # MIT License
└── README.md                            # Architecture & quickstart documentation
```

---

<p align="center">
  Licensed under the MIT License • Engineered by <a href="https://www.ariawave.tech">Aria Technology Group</a>
</p>
