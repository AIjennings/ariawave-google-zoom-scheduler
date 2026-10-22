---
name: google-zoom-scheduler
description: "Sovereign Google Calendar + Zoom Meeting scheduler skill. Checks real-time multi-calendar Google free/busy availability, provisions Zoom video meetings (Server-to-Server OAuth or PMI fallback), stages Google Calendar events with Human-in-the-Loop (HITL) email safety guardrails, and generates .ics / Google Calendar links."
version: 1.0.0
author: Aria Technology Group
metadata:
  tags: [google-calendar, zoom, scheduling, freebusy, hitl-guardrails, open-source]
---

# Sovereign Google Calendar + Zoom Scheduler Skill

Use this skill whenever an autonomous agent needs to:
1. **Check Real-Time Availability:** Query Google Calendar `freeBusy` across one or more Google Workspace calendars.
2. **Schedule a Google Calendar + Zoom Meeting:** Provision a Zoom meeting (via Zoom Server-to-Server OAuth API or configured Zoom PMI) and create the event on Google Calendar.
3. **Verify Scheduling Logic:** Run deterministic self-tests (`--selftest`).

---

## 1. Human-in-the-Loop (HITL) External Communication Guardrail

- **No Unapproved External Email Blasts (`sendUpdates="none"` by Default):**
  - When an agent creates or stages a calendar event, it MUST use `sendUpdates="none"` (the default in `scripts/schedule_zoom_meeting.py`) unless the human operator explicitly approves sending external attendee notifications.

---

## 2. CLI Script Usage (`scripts/schedule_zoom_meeting.py`)

### Run Deterministic Self-Test
```bash
python3 scripts/schedule_zoom_meeting.py --selftest
```

### Check Next 5 Business Days of Live Free/Busy Slots
```bash
python3 scripts/schedule_zoom_meeting.py --check-slots --days 5
```

### Stage a Google Calendar + Zoom Event (Safe Mode: `sendUpdates=none`)
```bash
python3 scripts/schedule_zoom_meeting.py \
  --book \
  --title "Strategy & Architecture Sync" \
  --start "2026-10-23T14:30:00-04:00" \
  --duration 30 \
  --attendee-name "Client Name" \
  --attendee-email "client@example.com" \
  --topic "Proxmox VE cluster migration & AI agent cleanroom"
```
