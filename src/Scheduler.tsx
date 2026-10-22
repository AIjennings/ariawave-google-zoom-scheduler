"use client";

import { useEffect, useState } from "react";
import { trackSiteEvent } from "@/lib/analytics";

interface TimeSlot {
  id: string;
  startIso: string;
  endIso: string;
  dateKey: string;
  dayLabel: string;
  timeLabel: string;
  displayLabel: string;
}

interface DayAvailability {
  dateKey: string;
  dayLabel: string;
  slots: TimeSlot[];
}

interface BookingResult {
  success: boolean;
  eventId?: string;
  summary: string;
  startIso: string;
  endIso: string;
  displayLabel: string;
  timezone: string;
  zoomJoinUrl: string;
  zoomMeetingId: string;
  zoomPasscode: string;
  googleCalendarAddUrl: string;
  icsDataUri: string;
  liveCalendarBooked: boolean;
}

export interface SchedulerProps {
  meetingLink?: string;
  sourceContext?: string;
  prefill?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    company?: string;
    topic?: string;
  };
}

export default function Scheduler({ meetingLink, sourceContext, prefill }: SchedulerProps) {
  const [days, setDays] = useState<DayAvailability[]>([]);
  const [activeDateKey, setActiveDateKey] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);

  const [firstName, setFirstName] = useState(prefill?.firstName || "");
  const [lastName, setLastName] = useState(prefill?.lastName || "");
  const [email, setEmail] = useState(prefill?.email || "");
  const [company, setCompany] = useState(prefill?.company || "");
  const [phone, setPhone] = useState(prefill?.phone || "");
  const [topic, setTopic] = useState(prefill?.topic || "");

  const [booking, setBooking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BookingResult | null>(null);

  const fallbackUrl =
    (meetingLink && meetingLink.startsWith("http") ? meetingLink : undefined) ||
    process.env.NEXT_PUBLIC_ZOOM_SCHEDULER_URL ||
    "https://scheduler.zoom.us/andrew-jennings-rzou8s/technology-consult";

  useEffect(() => {
    if (prefill?.firstName && !firstName) setFirstName(prefill.firstName);
    if (prefill?.lastName && !lastName) setLastName(prefill.lastName);
    if (prefill?.email && !email) setEmail(prefill.email);
    if (prefill?.company && !company) setCompany(prefill.company);
    if (prefill?.phone && !phone) setPhone(prefill.phone);
    if (prefill?.topic && !topic) setTopic(prefill.topic);
  }, [prefill, firstName, lastName, email, company, phone, topic]);

  useEffect(() => {
    let active = true;
    setLoadingSlots(true);
    fetch("/api/calendar/availability?days=5")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data?.days) && data.days.length > 0) {
          setDays(data.days);
          setActiveDateKey(data.days[0].dateKey);
          setSelectedSlot(data.days[0].slots[0] || null);
          setLiveConnected(Boolean(data.liveCalendarConnected));
        }
      })
      .catch(() => {
        // Fallback handled gracefully
      })
      .finally(() => {
        if (active) setLoadingSlots(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const currentDay = days.find((d) => d.dateKey === activeDateKey) || days[0];

  const handleBookSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) {
      setError("Please select an available time window.");
      return;
    }
    setBooking(true);
    setError("");
    trackSiteEvent("booking_click");

    try {
      const res = await fetch("/api/calendar/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startIso: selectedSlot.startIso,
          endIso: selectedSlot.endIso,
          firstName,
          lastName,
          email,
          phone,
          company,
          topic,
          sourceContext: sourceContext || "Website Live Google+Zoom Scheduler",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Could not book session.");
      }

      // Also sync lead to HubSpot & Twenty CRM via promo-intake
      fetch("/api/promo-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          workEmail: email,
          phoneNumber: phone,
          companyName: company || "Calendar Booking",
          service: `Booked Google+Zoom Consult (${sourceContext || "Website"})`,
          promoType: "general",
          priority: "yes",
          message: `Booked Slot: ${data.displayLabel}\nZoom URL: ${data.zoomJoinUrl}\nTopic: ${topic || "Executive AI & Systems Architecture"}`,
        }),
      }).catch(() => {});

      trackSiteEvent("generate_lead");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book session. Please try another slot.");
    } finally {
      setBooking(false);
    }
  };

  if (result) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.15rem",
          padding: "2rem 1.75rem",
          background: "rgba(6, 15, 28, 0.92)",
          border: "1px solid rgba(0, 240, 255, 0.35)",
          borderRadius: "14px",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "rgba(52,211,153,0.16)",
              border: "1px solid rgba(52,211,153,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#34d399",
              fontSize: "20px",
              flexShrink: 0,
            }}
          >
            ✓
          </div>
          <div>
            <div
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#34d399",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {result.liveCalendarBooked ? "SYNCED TO GOOGLE CALENDAR + ZOOM" : "SESSION RESERVED"}
            </div>
            <h3 style={{ color: "#fff", fontSize: "1.15rem", fontWeight: 800, margin: "2px 0 0 0" }}>
              {result.displayLabel}
            </h3>
          </div>
        </div>

        <div
          style={{
            background: "rgba(0, 240, 255, 0.06)",
            border: "1px solid rgba(0, 240, 255, 0.2)",
            borderRadius: "10px",
            padding: "1rem 1.15rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
            fontSize: "0.85rem",
            color: "#e2e8f0",
          }}
        >
          <div style={{ fontWeight: 700, color: "#00f0ff", fontFamily: "var(--font-mono, monospace)" }}>
            🎥 ZOOM VIDEO BRIEFING CREDENTIALS
          </div>
          <div>
            <strong>Join Link:</strong>{" "}
            <a
              href={result.zoomJoinUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#38bdf8", wordBreak: "break-all" }}
            >
              {result.zoomJoinUrl}
            </a>
          </div>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", color: "#cbd5e1" }}>
            <span>
              <strong>Meeting ID:</strong> {result.zoomMeetingId}
            </span>
            <span>
              <strong>Passcode:</strong> {result.zoomPasscode}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a
            href={result.googleCalendarAddUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1,
              minWidth: "200px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              background: "linear-gradient(135deg, #00f0ff 0%, #0ea5e9 100%)",
              color: "#030712",
              fontWeight: 800,
              fontSize: "0.875rem",
              padding: "0.8rem 1.25rem",
              borderRadius: "8px",
              textDecoration: "none",
            }}
          >
            <span>+ Add to Your Google Calendar</span>
          </a>

          <a
            href={result.icsDataUri}
            download="aria-strategy-consult.ics"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              color: "#f1f5f9",
              fontWeight: 700,
              fontSize: "0.85rem",
              padding: "0.8rem 1.15rem",
              borderRadius: "8px",
              textDecoration: "none",
            }}
          >
            Download .ICS (Outlook / Apple)
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleBookSession}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        padding: "1.75rem",
        background: "rgba(8, 15, 28, 0.85)",
        border: "1px solid rgba(0, 240, 255, 0.2)",
        borderRadius: "14px",
      }}
    >
      {/* Header & Live Sync Badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "10px",
              background: "linear-gradient(135deg, rgba(0, 240, 255, 0.2) 0%, rgba(14, 165, 233, 0.3) 100%)",
              border: "1px solid rgba(0, 240, 255, 0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#00f0ff",
              fontWeight: 900,
              fontSize: "15px",
            }}
          >
            AJ
          </div>
          <div>
            <h3 style={{ color: "#fff", fontSize: "1.05rem", fontWeight: 800, margin: 0 }}>
              Andrew Jennings • 30-Min Zoom Architecture Call
            </h3>
            <p style={{ color: "#00f0ff", fontSize: "0.78rem", margin: "2px 0 0 0", fontFamily: "var(--font-mono, monospace)" }}>
              {liveConnected ? "● LIVE GOOGLE CALENDAR FREE/BUSY + ZOOM SYNC" : "● DIRECT GOOGLE CALENDAR + ZOOM SCHEDULER"}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            color: "#fca5a5",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Day & Slot Selector */}
      <div>
        <div
          style={{
            color: "#94a3b8",
            fontSize: "0.76rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: "0.5rem",
          }}
        >
          1. Select Available Day &amp; Time (Eastern Time):
        </div>

        {loadingSlots ? (
          <div style={{ color: "#38bdf8", fontSize: "0.85rem", padding: "0.75rem 0", fontFamily: "var(--font-mono, monospace)" }}>
            Checking Andrew&apos;s live Google Calendar availability...
          </div>
        ) : (
          <>
            {/* Day Tabs */}
            <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "8px" }}>
              {days.map((d) => {
                const isActive = d.dateKey === (currentDay?.dateKey || activeDateKey);
                return (
                  <button
                    key={d.dateKey}
                    type="button"
                    onClick={() => {
                      setActiveDateKey(d.dateKey);
                      if (d.slots[0]) setSelectedSlot(d.slots[0]);
                    }}
                    style={{
                      padding: "7px 12px",
                      borderRadius: "7px",
                      border: isActive ? "1px solid #00f0ff" : "1px solid rgba(255,255,255,0.1)",
                      background: isActive ? "rgba(0, 240, 255, 0.16)" : "rgba(255,255,255,0.03)",
                      color: isActive ? "#ffffff" : "#94a3b8",
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                  >
                    {d.dayLabel}
                  </button>
                );
              })}
            </div>

            {/* Time Slots Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(125px, 1fr))", gap: "7px", marginTop: "6px" }}>
              {(currentDay?.slots || []).map((slot) => {
                const isSelected = selectedSlot?.id === slot.id;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: isSelected ? "1px solid #00f0ff" : "1px solid rgba(255,255,255,0.1)",
                      background: isSelected ? "rgba(0, 240, 255, 0.18)" : "rgba(255,255,255,0.03)",
                      color: isSelected ? "#fff" : "#cbd5e1",
                      fontSize: "0.78rem",
                      fontFamily: "var(--font-mono, monospace)",
                      fontWeight: isSelected ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {slot.timeLabel}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Attendee Details */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "#cbd5e1", marginBottom: "4px", fontWeight: 600 }}>
            First Name *
          </label>
          <input
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First Name"
            style={{
              width: "100%",
              padding: "9px 11px",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(4, 9, 18, 0.85)",
              color: "#fff",
              fontSize: "0.85rem",
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "#cbd5e1", marginBottom: "4px", fontWeight: 600 }}>
            Work Email *
          </label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            style={{
              width: "100%",
              padding: "9px 11px",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(4, 9, 18, 0.85)",
              color: "#fff",
              fontSize: "0.85rem",
            }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "#cbd5e1", marginBottom: "4px", fontWeight: 600 }}>
            Company Name
          </label>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company LLC"
            style={{
              width: "100%",
              padding: "9px 11px",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(4, 9, 18, 0.85)",
              color: "#fff",
              fontSize: "0.85rem",
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "#cbd5e1", marginBottom: "4px", fontWeight: 600 }}>
            What are we solving?
          </label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="AI agents, CRM sync, Proxmox, telecom..."
            style={{
              width: "100%",
              padding: "9px 11px",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(4, 9, 18, 0.85)",
              color: "#fff",
              fontSize: "0.85rem",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <button
          type="submit"
          disabled={booking || !selectedSlot}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            background: "linear-gradient(135deg, #00f0ff 0%, #00b4d8 100%)",
            color: "#030712",
            fontWeight: 800,
            fontSize: "0.92rem",
            padding: "0.85rem 1.4rem",
            borderRadius: "8px",
            border: "none",
            cursor: booking ? "wait" : "pointer",
            boxShadow: "0 4px 16px rgba(0, 240, 255, 0.25)",
          }}
        >
          <span>
            {booking
              ? "Booking on Google Calendar & Provisioning Zoom..."
              : selectedSlot
              ? `Confirm Google + Zoom Call (${selectedSlot.displayLabel}) →`
              : "Select a Time Window Above"}
          </span>
        </button>

        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            textAlign: "center",
            fontSize: "0.78rem",
            color: "#38bdf8",
            textDecoration: "none",
            padding: "2px",
          }}
        >
          Or open external Zoom Scheduler page &rarr;
        </a>
      </div>
    </form>
  );
}
