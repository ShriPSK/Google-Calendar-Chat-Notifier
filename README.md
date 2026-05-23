# 📅 Google Calendar → Google Chat Alert System

A Google Apps Script that monitors your Google Calendar and sends real-time alerts to a Google Chat Space whenever a new meeting with a Google Meet link is created.

---

## Features

- 🔔 Alerts within ~60 seconds of a new calendar event being created
- 🎥 Only triggers for events that have a Google Meet link
- 👤 Only alerts for events where you are an attendee or organizer
- 🃏 Sends a rich Chat card with:
  - Event title, date & time
  - Organizer name & email
  - Attendees with response status (✅ ❌ ❓ ⏳)
  - Event description (first 300 characters)
  - Drive attachments (if any)
  - **Join Google Meet** and **Open in Calendar** buttons
- 🔁 Duplicate-proof — won't re-alert on event updates
- 🧹 Auto-cleans up stale tracking data daily

---

## How It Works

```
Google Calendar
      │
      │  Apps Script polls every 1 minute
      ▼
 pollCalendar()
      │
      ├─ Has Google Meet link?
      ├─ Are you an attendee?
      ├─ Already alerted for this event?
      │
      ▼
 sendChatAlert()
      │
      ▼
 Google Chat Space (Incoming Webhook)
```

---

## Prerequisites

- A Google Workspace (org) account
- Access to [Google Apps Script](https://script.google.com)
- A Google Chat Space where you can create an Incoming Webhook

---

## Setup

### 1. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) → **New project**
2. Delete the default code and paste the contents of `Code.gs`
3. Fill in the two config values at the top of the file:

```javascript
const CONFIG = {
  CHAT_WEBHOOK_URL: "YOUR_GOOGLE_CHAT_WEBHOOK_URL",
  MY_EMAIL: "you@yourcompany.com",
  ...
};
```

### 2. Enable the Calendar API

1. In the Apps Script editor, click **+** next to *Services* in the left sidebar
2. Find **Google Calendar API** → click **Add**

### 3. Create a Google Chat Incoming Webhook

1. Open your Google Chat Space
2. Click the Space name → **Apps & integrations** → **Webhooks**
3. Click **Add webhook** → give it a name → **Save**
4. Copy the webhook URL and paste it into `CHAT_WEBHOOK_URL` in the config

### 4. Run setup

1. In the Apps Script editor, select `setup` from the function dropdown
2. Click **Run**
3. Approve the permissions prompt when asked
4. Check **View → Logs** — you should see:
   ```
   Polling trigger installed — runs every 1 minute.
   ```

### 5. (Optional) Add daily cleanup trigger

To automatically clean up stale tracking data:

1. Click the **⏰ Triggers** icon in the left sidebar
2. **Add Trigger** → Function: `cleanupOldAlertedKeys` → Event source: **Time-driven** → **Day timer**

---

## Testing

You can manually test without waiting for the 1-minute trigger:

1. Create a Google Calendar event with a Google Meet link
2. In the Apps Script editor, select `pollCalendar` → click **Run**
3. Check your Google Chat Space — the alert card should appear immediately

To test just the Chat card formatting:

```javascript
// Run testChatAlert() from the editor
function testChatAlert() { ... }
```

---

## File Structure

```
Code.gs
 ├── CONFIG                    → Webhook URL, email, calendar ID
 ├── setup()                   → One-time setup: installs polling trigger
 ├── pollCalendar()            → Runs every minute, fetches updated events
 ├── processEvent()            → Filters: Meet link, attendee, duplicate check
 ├── sendChatAlert()           → Builds and POSTs the Chat card
 ├── buildSections()           → Constructs Chat card sections
 ├── extractMeetLink()         → Extracts Meet URL from conferenceData or description
 ├── isAttendee()              → Checks if you're in the attendees list
 ├── formatEventTime()         → Formats start/end times (IST)
 ├── formatAttendees()         → Formats attendee list with response status icons
 ├── formatAttachments()       → Extracts Drive attachment links
 ├── cleanupOldAlertedKeys()   → Deletes expired tracking keys from Script Properties
 └── stripHtml()               → Strips HTML tags from event descriptions
```

---

## Chat Card Preview

```
┌─────────────────────────────────────────┐
│ 📅 New Meeting Invite                   │
│    Q3 Planning Sync                     │
├─────────────────────────────────────────┤
│ 🕐 Thursday, 29 May 2025               │
│    10:00 AM → 11:00 AM                 │
│                                         │
│ 👤 Organizer: Priya Sharma              │
│    <priya@company.com>                  │
├─────────────────────────────────────────┤
│ Attendees                               │
│ ✅ Rahul Mehta                          │
│ ⏳ you@company.com                      │
│ ❓ Ananya Singh                         │
├─────────────────────────────────────────┤
│ Description                             │
│ Please review the deck before joining…  │
├─────────────────────────────────────────┤
│ Attachments                             │
│ 📁 Q3_Deck.pdf                         │
├─────────────────────────────────────────┤
│ [ Join Google Meet ] [ Open in Calendar]│
└─────────────────────────────────────────┘
```

---

## Attendee Response Status Icons

| Icon | Status |
|------|--------|
| ✅ | Accepted |
| ❌ | Declined |
| ❓ | Tentative |
| ⏳ | Needs Action |

---

## Limitations

- **Polling delay** — alerts arrive within ~60 seconds, not instantly. This is due to a Google Workspace org restriction that blocks Calendar API push notifications to external URLs. If your admin enables external push notifications, the script can be upgraded to use real-time webhooks.
- **Attachments** — only shows attachments explicitly added by the organizer via Google Calendar. Email attachments are not included.
- **Apps Script quota** — free Workspace accounts get 90 min/day of execution time. At 1-min polling (~1–2 sec/run), this system uses well under the limit.
- **Script Properties limit** — 500KB total storage. The daily `cleanupOldAlertedKeys` trigger keeps this in check.

---

## Customization Ideas

- Alert X minutes **before** a meeting starts (reminder alert)
- Route alerts to **different Chat Spaces** based on keywords in the event title
- Include a **agenda/description summary** using the Anthropic API
- Filter by **specific organizer domains** (e.g. only external meeting invites)
- Add a **decline/accept** button directly in the Chat card

---

## License

MIT