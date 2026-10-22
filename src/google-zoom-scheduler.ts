export interface TimeSlot {
  id: string;
  startIso: string;
  endIso: string;
  dateKey: string;
  dayLabel: string;
  timeLabel: string;
  displayLabel: string;
}

export interface AvailabilityResponse {
  timezone: string;
  slotDurationMinutes: number;
  liveCalendarConnected: boolean;
  days: {
    dateKey: string;
    dayLabel: string;
    slots: TimeSlot[];
  }[];
  fallbackSchedulerUrl: string;
}

export interface BookingRequest {
  startIso: string;
  endIso?: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  company?: string;
  topic?: string;
  sourceContext?: string;
}

export interface BookingResult {
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

interface GoogleTokenConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId?: string;
}

const DEFAULT_TIMEZONE = process.env.SCHEDULER_TIMEZONE || 'America/Detroit';
const SLOT_DURATION_MINUTES = 30;
const WORKDAY_START_HOUR = 9;
const WORKDAY_END_HOUR = 17;

const DEFAULT_ZOOM_JOIN_URL = process.env.ZOOM_PMI_JOIN_URL || 'https://zoom.us/j/YOUR_PMI_ID';
const DEFAULT_ZOOM_MEETING_ID = process.env.ZOOM_PMI_ID || '000 000 0000';
const DEFAULT_ZOOM_PASSCODE = process.env.ZOOM_PMI_PASSCODE || 'PASSCODE';
const DEFAULT_ZOOM_SCHEDULER_URL = process.env.NEXT_PUBLIC_ZOOM_SCHEDULER_URL || 'https://scheduler.zoom.us';

function loadGoogleCredentialConfigs(): GoogleTokenConfig[] {
  const configs: GoogleTokenConfig[] = [];

  const envClientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const envClientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const envRefreshPrimary = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  const envRefreshSecondary = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN_SECONDARY;

  if (envClientId && envClientSecret && envRefreshPrimary) {
    configs.push({
      clientId: envClientId,
      clientSecret: envClientSecret,
      refreshToken: envRefreshPrimary,
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    });
  }

  if (envClientId && envClientSecret && envRefreshSecondary) {
    configs.push({
      clientId: envClientId,
      clientSecret: envClientSecret,
      refreshToken: envRefreshSecondary,
      calendarId: 'primary',
    });
  }

  return configs;
}

async function getGoogleAccessToken(config: GoogleTokenConfig): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

interface BusyInterval {
  startMs: number;
  endMs: number;
}

async function fetchBusyIntervals(timeMinIso: string, timeMaxIso: string): Promise<{
  busy: BusyInterval[];
  connected: boolean;
}> {
  const configs = loadGoogleCredentialConfigs();
  if (configs.length === 0) {
    return { busy: [], connected: false };
  }

  const allBusy: BusyInterval[] = [];
  let anyConnected = false;

  await Promise.all(
    configs.map(async (cfg) => {
      const token = await getGoogleAccessToken(cfg);
      if (!token) return;

      try {
        const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timeMin: timeMinIso,
            timeMax: timeMaxIso,
            timeZone: DEFAULT_TIMEZONE,
            items: [{ id: cfg.calendarId || 'primary' }],
          }),
          cache: 'no-store',
        });

        if (!res.ok) return;
        anyConnected = true;
        const data = await res.json();
        const calKey = cfg.calendarId || 'primary';
        const busyList = data?.calendars?.[calKey]?.busy || [];
        for (const item of busyList) {
          const startMs = Date.parse(item.start);
          const endMs = Date.parse(item.end);
          if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
            allBusy.push({
              startMs: startMs - 10 * 60 * 1000,
              endMs: endMs + 10 * 60 * 1000,
            });
          }
        }
      } catch {
        // Ignore single calendar failure
      }
    })
  );

  return { busy: allBusy, connected: anyConnected };
}

function getEasternDateAt(year: number, monthZeroIndexed: number, day: number, hour: number, minute: number): Date {
  const utcGuess = new Date(Date.UTC(year, monthZeroIndexed, day, hour + 4, minute, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(utcGuess);

  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  const actualHour = map.hour === 24 ? 0 : map.hour;
  const hourDiff = hour - actualHour;
  return new Date(utcGuess.getTime() + hourDiff * 3600 * 1000);
}

export async function getLiveAvailability(daysCount = 5): Promise<AvailabilityResponse> {
  const now = new Date();
  const minStartMs = now.getTime() + 2 * 3600 * 1000;

  const candidateDays: { dateKey: string; dayLabel: string; year: number; month: number; day: number }[] = [];
  let cursor = new Date(now.getTime());

  while (candidateDays.length < daysCount) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).formatToParts(cursor);

    const pMap: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') pMap[p.type] = p.value;
    }

    const weekday = pMap.weekday;
    if (weekday !== 'Sat' && weekday !== 'Sun') {
      const monthNum = new Date(`${pMap.month} 1, ${pMap.year}`).getMonth();
      const dayNum = parseInt(pMap.day, 10);
      const yearNum = parseInt(pMap.year, 10);
      const dateKey = `${yearNum}-${String(monthNum + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

      if (!candidateDays.some((d) => d.dateKey === dateKey)) {
        candidateDays.push({
          dateKey,
          dayLabel: `${weekday}, ${pMap.month} ${dayNum}`,
          year: yearNum,
          month: monthNum,
          day: dayNum,
        });
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
  }

  const firstDay = candidateDays[0];
  const lastDay = candidateDays[candidateDays.length - 1];
  const timeMin = getEasternDateAt(firstDay.year, firstDay.month, firstDay.day, 0, 0).toISOString();
  const timeMax = getEasternDateAt(lastDay.year, lastDay.month, lastDay.day, 23, 59).toISOString();

  const { busy, connected } = await fetchBusyIntervals(timeMin, timeMax);

  const preferredHours: [number, number][] = [
    [9, 30],
    [10, 30],
    [11, 30],
    [13, 30],
    [14, 30],
    [15, 30],
    [16, 30],
  ];

  const daysResult = candidateDays
    .map((d) => {
      const slots: TimeSlot[] = [];

      for (const [hr, min] of preferredHours) {
        if (hr < WORKDAY_START_HOUR || hr >= WORKDAY_END_HOUR) continue;
        const startDate = getEasternDateAt(d.year, d.month, d.day, hr, min);
        const endDate = new Date(startDate.getTime() + SLOT_DURATION_MINUTES * 60 * 1000);

        const sMs = startDate.getTime();
        const eMs = endDate.getTime();
        if (sMs < minStartMs) continue;

        const overlapsBusy = busy.some((b) => sMs < b.endMs && eMs > b.startMs);
        if (overlapsBusy) continue;

        const timeLabel = new Intl.DateTimeFormat('en-US', {
          timeZone: DEFAULT_TIMEZONE,
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(startDate);

        slots.push({
          id: startDate.toISOString(),
          startIso: startDate.toISOString(),
          endIso: endDate.toISOString(),
          dateKey: d.dateKey,
          dayLabel: d.dayLabel,
          timeLabel,
          displayLabel: `${d.dayLabel} @ ${timeLabel}`,
        });
      }

      return {
        dateKey: d.dateKey,
        dayLabel: d.dayLabel,
        slots,
      };
    })
    .filter((d) => d.slots.length > 0);

  return {
    timezone: DEFAULT_TIMEZONE,
    slotDurationMinutes: SLOT_DURATION_MINUTES,
    liveCalendarConnected: connected,
    days: daysResult,
    fallbackSchedulerUrl: DEFAULT_ZOOM_SCHEDULER_URL,
  };
}

async function provisionZoomMeeting(params: {
  topic: string;
  startIso: string;
  durationMinutes: number;
}): Promise<{
  joinUrl: string;
  meetingId: string;
  passcode: string;
}> {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (accountId && clientId && clientSecret) {
    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${basicAuth}` },
          cache: 'no-store',
        }
      );

      if (tokenRes.ok) {
        const { access_token } = await tokenRes.json();
        const meetRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            topic: params.topic,
            type: 2,
            start_time: params.startIso,
            duration: params.durationMinutes,
            timezone: DEFAULT_TIMEZONE,
            settings: {
              host_video: true,
              participant_video: true,
              join_before_host: false,
              waiting_room: true,
            },
          }),
          cache: 'no-store',
        });

        if (meetRes.ok) {
          const meetData = await meetRes.json();
          if (meetData.join_url) {
            return {
              joinUrl: meetData.join_url,
              meetingId: String(meetData.id || DEFAULT_ZOOM_MEETING_ID),
              passcode: String(meetData.password || DEFAULT_ZOOM_PASSCODE),
            };
          }
        }
      }
    } catch {
      // Fall back to configured PMI
    }
  }

  return {
    joinUrl: DEFAULT_ZOOM_JOIN_URL,
    meetingId: DEFAULT_ZOOM_MEETING_ID,
    passcode: DEFAULT_ZOOM_PASSCODE,
  };
}

function buildGoogleCalendarTemplateUrl(params: {
  title: string;
  startIso: string;
  endIso: string;
  details: string;
  location: string;
}): string {
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const query = new URLSearchParams({
    action: 'TEMPLATE',
    text: params.title,
    dates: `${fmt(params.startIso)}/${fmt(params.endIso)}`,
    details: params.details,
    location: params.location,
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}

function buildIcsDataUri(params: {
  uid: string;
  title: string;
  startIso: string;
  endIso: string;
  description: string;
  location: string;
  organizerEmail: string;
}): string {
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const escapeIcs = (str: string) =>
    str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aria Technology Group//Sovereign Google+Zoom Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${fmt(new Date().toISOString())}`,
    `DTSTART:${fmt(params.startIso)}`,
    `DTEND:${fmt(params.endIso)}`,
    `SUMMARY:${escapeIcs(params.title)}`,
    `DESCRIPTION:${escapeIcs(params.description)}`,
    `LOCATION:${escapeIcs(params.location)}`,
    `ORGANIZER:mailto:${params.organizerEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const icsContent = lines.join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}`;
}

export async function bookGoogleZoomMeeting(req: BookingRequest): Promise<BookingResult> {
  const startDate = new Date(req.startIso);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Invalid startIso timestamp');
  }

  const endDate = req.endIso
    ? new Date(req.endIso)
    : new Date(startDate.getTime() + SLOT_DURATION_MINUTES * 60 * 1000);

  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  const { busy } = await fetchBusyIntervals(startIso, endIso);
  const conflict = busy.some(
    (b) => startDate.getTime() < b.endMs - 10 * 60 * 1000 && endDate.getTime() > b.startMs + 10 * 60 * 1000
  );
  if (conflict) {
    throw new Error('Selected time slot was just claimed. Please choose another available window.');
  }

  const fullName = [req.firstName, req.lastName].filter(Boolean).join(' ').trim() || 'Executive Guest';
  const companyLabel = req.company ? ` (${req.company})` : '';
  const summary = `Strategy & Architecture Consult: ${fullName}${companyLabel}`;

  const zoom = await provisionZoomMeeting({
    topic: summary,
    startIso,
    durationMinutes: SLOT_DURATION_MINUTES,
  });

  const displayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(startDate);

  const descriptionLines = [
    `1-on-1 Executive Strategy & Systems Architecture Session`,
    ``,
    `Guest: ${fullName}${companyLabel}`,
    `Email: ${req.email}`,
    req.phone ? `Phone: ${req.phone}` : null,
    req.sourceContext ? `Source: ${req.sourceContext}` : null,
    req.topic ? `\nOperational Focus / Agenda:\n${req.topic}` : null,
    ``,
    `──────────────────────────────────────────`,
    `JOIN ZOOM VIDEO BRIEFING`,
    `Join URL: ${zoom.joinUrl}`,
    `Meeting ID: ${zoom.meetingId}`,
    `Passcode: ${zoom.passcode}`,
    `──────────────────────────────────────────`,
  ].filter((line): line is string => line !== null);

  const description = descriptionLines.join('\n');

  const sendUpdatesMode = process.env.GOOGLE_CALENDAR_SEND_UPDATES || 'none';
  const configs = loadGoogleCredentialConfigs();
  let eventId: string | undefined;
  let liveCalendarBooked = false;

  for (const cfg of configs) {
    const token = await getGoogleAccessToken(cfg);
    if (!token) continue;

    try {
      const calId = encodeURIComponent(cfg.calendarId || 'primary');
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?sendUpdates=${encodeURIComponent(sendUpdatesMode)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary,
            location: zoom.joinUrl,
            description,
            start: {
              dateTime: startIso,
              timeZone: DEFAULT_TIMEZONE,
            },
            end: {
              dateTime: endIso,
              timeZone: DEFAULT_TIMEZONE,
            },
            attendees: [{ email: req.email, displayName: fullName }],
          }),
          cache: 'no-store',
        }
      );

      if (res.ok) {
        const created = await res.json();
        eventId = eventId || created.id;
        liveCalendarBooked = true;
      }
    } catch {
      // Continue
    }
  }

  const googleCalendarAddUrl = buildGoogleCalendarTemplateUrl({
    title: summary,
    startIso,
    endIso,
    details: description,
    location: zoom.joinUrl,
  });

  const icsDataUri = buildIcsDataUri({
    uid: eventId || `aria-${Date.now()}@ariawave.tech`,
    title: summary,
    startIso,
    endIso,
    description,
    location: zoom.joinUrl,
    organizerEmail: process.env.ORGANIZER_EMAIL || 'andrew@ariawave.tech',
  });

  return {
    success: true,
    eventId,
    summary,
    startIso,
    endIso,
    displayLabel,
    timezone: DEFAULT_TIMEZONE,
    zoomJoinUrl: zoom.joinUrl,
    zoomMeetingId: zoom.meetingId,
    zoomPasscode: zoom.passcode,
    googleCalendarAddUrl,
    icsDataUri,
    liveCalendarBooked,
  };
}
