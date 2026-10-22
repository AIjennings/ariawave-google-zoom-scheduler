#!/usr/bin/env python3
"""
Sovereign Google Calendar + Zoom Meeting Scheduler CLI
Aria Technology Group (https://www.ariawave.tech)

Features:
- Multi-calendar Google OAuth2 free/busy aggregation with automatic pre/post buffers
- Zoom Server-to-Server OAuth dynamic meeting creation + configurable Zoom PMI fallback
- Strict HITL compliance: defaults to sendUpdates='none' so no external email is sent without explicit human approval
- Deterministic --selftest suite (zero network or credentials required)
"""

import argparse
import base64
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_TIMEZONE = os.environ.get("SCHEDULER_TIMEZONE", "America/Detroit")
DEFAULT_ZOOM_URL = os.environ.get("ZOOM_PMI_JOIN_URL", "https://zoom.us/j/0000000000")
DEFAULT_ZOOM_ID = os.environ.get("ZOOM_PMI_ID", "000 000 0000")
DEFAULT_ZOOM_PASSCODE = os.environ.get("ZOOM_PMI_PASSCODE", "ARIAWAVE")


def load_google_tokens() -> list[dict]:
    configs = []
    cid = os.environ.get("GOOGLE_CALENDAR_CLIENT_ID") or os.environ.get("GOOGLE_CLIENT_ID")
    csec = os.environ.get("GOOGLE_CALENDAR_CLIENT_SECRET") or os.environ.get("GOOGLE_CLIENT_SECRET")
    rtok = os.environ.get("GOOGLE_CALENDAR_REFRESH_TOKEN")
    rtok2 = os.environ.get("GOOGLE_CALENDAR_REFRESH_TOKEN_SECONDARY")

    if cid and csec and rtok:
        configs.append({"client_id": cid, "client_secret": csec, "refresh_token": rtok})
    if cid and csec and rtok2:
        configs.append({"client_id": cid, "client_secret": csec, "refresh_token": rtok2})

    if configs:
        return configs

    hermes_dir = Path.home() / ".hermes"
    for fn in ["google_token.json", "google_token_ariawave.json"]:
        p = hermes_dir / fn
        if p.exists():
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                if raw.get("client_id") and raw.get("client_secret") and raw.get("refresh_token"):
                    configs.append(raw)
            except Exception:
                pass
    return configs


def get_access_token(cfg: dict) -> str | None:
    data = urllib.parse.urlencode(
        {
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "refresh_token": cfg["refresh_token"],
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    try:
        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8")).get("access_token")
    except Exception:
        return None


def compute_open_slots(
    candidate_dates: list[datetime.date],
    busy_intervals: list[tuple[datetime.datetime, datetime.datetime]],
    min_start: datetime.datetime,
    tz_name: str = DEFAULT_TIMEZONE,
) -> list[dict]:
    tz = ZoneInfo(tz_name)
    preferred_times = [(9, 30), (10, 30), (11, 30), (13, 30), (14, 30), (15, 30), (16, 30)]
    output_days = []

    for d in candidate_dates:
        slots = []
        for hr, minute in preferred_times:
            s_dt = datetime.datetime.combine(d, datetime.time(hr, minute), tzinfo=tz)
            e_dt = s_dt + datetime.timedelta(minutes=30)
            if s_dt < min_start:
                continue
            if any(s_dt < b_end and e_dt > b_start for b_start, b_end in busy_intervals):
                continue
            slots.append(
                {
                    "startIso": s_dt.isoformat(),
                    "endIso": e_dt.isoformat(),
                    "label": s_dt.strftime("%a, %b %d @ %I:%M %p %Z"),
                }
            )
        if slots:
            output_days.append({"date": d.isoformat(), "slots": slots})
    return output_days


def fetch_busy_intervals(time_min_iso: str, time_max_iso: str) -> list[tuple[datetime.datetime, datetime.datetime]]:
    busy: list[tuple[datetime.datetime, datetime.datetime]] = []
    for cfg in load_google_tokens():
        tok = get_access_token(cfg)
        if not tok:
            continue
        payload = json.dumps(
            {
                "timeMin": time_min_iso,
                "timeMax": time_max_iso,
                "timeZone": DEFAULT_TIMEZONE,
                "items": [{"id": "primary"}],
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            data=payload,
            headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                for item in data.get("calendars", {}).get("primary", {}).get("busy", []):
                    s = datetime.datetime.fromisoformat(item["start"].replace("Z", "+00:00"))
                    e = datetime.datetime.fromisoformat(item["end"].replace("Z", "+00:00"))
                    busy.append((s - datetime.timedelta(minutes=10), e + datetime.timedelta(minutes=10)))
        except Exception:
            pass
    return busy


def check_slots(days: int = 5) -> dict:
    tz = ZoneInfo(DEFAULT_TIMEZONE)
    now = datetime.datetime.now(tz)
    min_start = now + datetime.timedelta(hours=2)

    candidate_dates: list[datetime.date] = []
    cursor = now.date()
    while len(candidate_dates) < days:
        if cursor.weekday() < 5:
            candidate_dates.append(cursor)
        cursor += datetime.timedelta(days=1)

    t_min = datetime.datetime.combine(candidate_dates[0], datetime.time(0, 0), tzinfo=tz).isoformat()
    t_max = datetime.datetime.combine(candidate_dates[-1], datetime.time(23, 59), tzinfo=tz).isoformat()
    busy = fetch_busy_intervals(t_min, t_max)
    output_days = compute_open_slots(candidate_dates, busy, min_start, DEFAULT_TIMEZONE)
    return {"timezone": DEFAULT_TIMEZONE, "days": output_days}


def provision_zoom(topic: str, start_iso: str, duration: int) -> dict:
    acc_id = os.environ.get("ZOOM_ACCOUNT_ID")
    cid = os.environ.get("ZOOM_CLIENT_ID")
    csec = os.environ.get("ZOOM_CLIENT_SECRET")
    if acc_id and cid and csec:
        try:
            b64 = base64.b64encode(f"{cid}:{csec}".encode()).decode()
            t_url = f"https://zoom.us/oauth/token?grant_type=account_credentials&account_id={urllib.parse.quote(acc_id)}"
            t_req = urllib.request.Request(t_url, headers={"Authorization": f"Basic {b64}"}, method="POST")
            with urllib.request.urlopen(t_req, timeout=10) as resp:
                z_tok = json.loads(resp.read().decode())["access_token"]
            m_payload = json.dumps(
                {
                    "topic": topic,
                    "type": 2,
                    "start_time": start_iso,
                    "duration": duration,
                    "timezone": DEFAULT_TIMEZONE,
                    "settings": {"waiting_room": True, "host_video": True, "participant_video": True},
                }
            ).encode()
            m_req = urllib.request.Request(
                "https://api.zoom.us/v2/users/me/meetings",
                data=m_payload,
                headers={"Authorization": f"Bearer {z_tok}", "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(m_req, timeout=10) as resp:
                m_data = json.loads(resp.read().decode())
                return {
                    "joinUrl": m_data["join_url"],
                    "meetingId": str(m_data.get("id", DEFAULT_ZOOM_ID)),
                    "passcode": str(m_data.get("password", DEFAULT_ZOOM_PASSCODE)),
                }
        except Exception:
            pass
    return {"joinUrl": DEFAULT_ZOOM_URL, "meetingId": DEFAULT_ZOOM_ID, "passcode": DEFAULT_ZOOM_PASSCODE}


def book_meeting(
    title: str,
    start_iso: str,
    duration: int,
    attendee_name: str,
    attendee_email: str,
    topic: str,
    send_updates: str = "none",
) -> dict:
    s_dt = datetime.datetime.fromisoformat(start_iso)
    e_dt = s_dt + datetime.timedelta(minutes=duration)
    zoom = provision_zoom(title, s_dt.isoformat(), duration)

    desc = (
        f"Aria Technology Group — 1-on-1 Executive Strategy & Architecture Session\n\n"
        f"Host: Andrew Jennings (Co-Founder & Principal Systems Architect)\n"
        f"Guest: {attendee_name} ({attendee_email})\n"
        f"Agenda / Topic: {topic}\n\n"
        f"──────────────────────────────────────────\n"
        f"JOIN ZOOM VIDEO BRIEFING\n"
        f"Join URL: {zoom['joinUrl']}\n"
        f"Meeting ID: {zoom['meetingId']}\n"
        f"Passcode: {zoom['passcode']}\n"
        f"──────────────────────────────────────────"
    )

    configs = load_google_tokens()
    if not configs:
        raise RuntimeError("No Google Calendar OAuth tokens found.")

    event_ids = []
    for cfg in configs:
        tok = get_access_token(cfg)
        if not tok:
            continue
        url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates={urllib.parse.quote(send_updates)}"
        body = json.dumps(
            {
                "summary": title,
                "location": zoom["joinUrl"],
                "description": desc,
                "start": {"dateTime": s_dt.isoformat(), "timeZone": DEFAULT_TIMEZONE},
                "end": {"dateTime": e_dt.isoformat(), "timeZone": DEFAULT_TIMEZONE},
                "attendees": [
                    {"email": attendee_email, "displayName": attendee_name},
                ],
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                ev = json.loads(resp.read().decode("utf-8"))
                event_ids.append(ev.get("id"))
        except Exception:
            pass

    return {
        "success": len(event_ids) > 0,
        "eventIds": event_ids,
        "sendUpdates": send_updates,
        "startIso": s_dt.isoformat(),
        "endIso": e_dt.isoformat(),
        "zoom": zoom,
    }


def run_selftest() -> int:
    tz = ZoneInfo("America/Detroit")
    test_date = datetime.date(2026, 10, 26)
    min_start = datetime.datetime(2026, 10, 26, 8, 0, tzinfo=tz)
    # Block 10:30 AM - 12:00 PM
    busy = [
        (
            datetime.datetime(2026, 10, 26, 10, 20, tzinfo=tz),
            datetime.datetime(2026, 10, 26, 12, 10, tzinfo=tz),
        )
    ]
    res = compute_open_slots([test_date], busy, min_start, "America/Detroit")
    assert len(res) == 1, "Expected 1 day of availability"
    slots = res[0]["slots"]
    labels = [s["label"] for s in slots]
    assert any("09:30 AM" in l for l in labels), "9:30 AM should be available"
    assert not any("10:30 AM" in l for l in labels), "10:30 AM should be blocked by busy interval"
    assert not any("11:30 AM" in l for l in labels), "11:30 AM should be blocked by busy interval"
    assert any("01:30 PM" in l for l in labels), "1:30 PM should be available"
    print(json.dumps({"selftest": "PASS", "verifiedSlots": len(slots)}, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Sovereign Google Calendar + Zoom Scheduler CLI")
    parser.add_argument("--selftest", action="store_true", help="Run deterministic unit self-tests")
    parser.add_argument("--check-slots", action="store_true", help="List live open slots from Google Calendar")
    parser.add_argument("--days", type=int, default=5, help="Number of business days to check")
    parser.add_argument("--book", action="store_true", help="Create a Google Calendar + Zoom event")
    parser.add_argument("--title", default="Aria Strategy & Architecture Consult", help="Meeting summary/title")
    parser.add_argument("--start", help="ISO start timestamp (e.g., 2026-10-23T14:30:00-04:00)")
    parser.add_argument("--duration", type=int, default=30, help="Duration in minutes")
    parser.add_argument("--attendee-name", default="Executive Guest", help="Attendee full name")
    parser.add_argument("--attendee-email", default="", help="Attendee email address")
    parser.add_argument("--topic", default="AI & Systems Architecture", help="Meeting agenda/topic")
    parser.add_argument(
        "--send-updates",
        choices=["none", "all", "externalOnly"],
        default="none",
        help="Defaults to 'none' per HITL guardrail so no external email is sent without explicit confirmation.",
    )
    args = parser.parse_args()

    if args.selftest:
        return run_selftest()

    if args.check_slots:
        print(json.dumps(check_slots(args.days), indent=2))
        return 0

    if args.book:
        if not args.start or not args.attendee_email:
            print("ERROR: --start and --attendee-email are required for --book", file=sys.stderr)
            return 1
        res = book_meeting(
            title=args.title,
            start_iso=args.start,
            duration=args.duration,
            attendee_name=args.attendee_name,
            attendee_email=args.attendee_email,
            topic=args.topic,
            send_updates=args.send_updates,
        )
        print(json.dumps(res, indent=2))
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
