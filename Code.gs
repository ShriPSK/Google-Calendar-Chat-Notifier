// ============================================================
//  CONFIGURATION — fill these in before deploying
// ============================================================

const CONFIG = {
    // Paste your Google Chat Space Incoming Webhook URL here
    CHAT_WEBHOOK_URL: "your_chat_webhook_url_here",

    // Your org email address (used to identify yourself in attendee lists)
    MY_EMAIL: "your_org_email_address_here",

    // Calendar to watch — "primary" = your main org calendar
    CALENDAR_ID: "primary",

    // Script property key used to persist the watch channel state
    CHANNEL_ID_KEY: "watchChannelId",
    RESOURCE_ID_KEY: "watchResourceId",
    CHANNEL_EXPIRY_KEY: "watchChannelExpiry",

    // How many seconds the watch channel should live (max 604800 = 7 days)
    WATCH_TTL_SECONDS: 604800,
};


function setup() {
    // Remove any existing polling triggers
    ScriptApp.getProjectTriggers()
        .filter(t => t.getHandlerFunction() === "pollCalendar")
        .forEach(t => ScriptApp.deleteTrigger(t));

    // Poll every minute
    ScriptApp.newTrigger("pollCalendar")
        .timeBased()
        .everyMinutes(1)
        .create();

    // Initialize the last-checked timestamp
    PropertiesService.getScriptProperties()
        .setProperty("lastChecked", new Date().toISOString());

    Logger.log("Polling trigger installed — runs every 1 minute.");
}

function pollCalendar() {
    const props = PropertiesService.getScriptProperties();
    const lastChecked = props.getProperty("lastChecked") || new Date(Date.now() - 60000).toISOString();
    const now = new Date();

    Logger.log("Polling since: " + lastChecked);

    const events = Calendar.Events.list(CONFIG.CALENDAR_ID, {
        updatedMin: lastChecked,
        singleEvents: true,
        orderBy: "updated",
        maxResults: 20,
        showDeleted: false,
    });

    // Update lastChecked immediately to avoid reprocessing
    props.setProperty("lastChecked", now.toISOString());

    if (!events.items || events.items.length === 0) {
        Logger.log("No new events.");
        return;
    }

    Logger.log("Events to process: " + events.items.length);
    for (const event of events.items) {
        processEvent(event, now);
    }
}


// ============================================================
//  3. EVENT PROCESSING — filter & decide whether to alert
// ============================================================

/**
 * Applies all filters to an event and sends a Chat alert if it passes.
 */
function processEvent(event, now) {
    const eventId = event.id;
    const props = PropertiesService.getScriptProperties();

    // --- Filter 1: Must have a Google Meet link ---
    const meetLink = extractMeetLink(event);
    if (!meetLink) {
        Logger.log(`Event "${event.summary}" skipped — no Meet link.`);
        return;
    }

    // --- Filter 2: Must be a newly created event (not just an update) ---
    // We track alerted event IDs to avoid duplicate alerts on updates.
    const alertedKey = "alerted_" + eventId;
    if (props.getProperty(alertedKey)) {
        Logger.log(`Event "${event.summary}" skipped — already alerted.`);
        return;
    }

    // --- Filter 3: You must be an attendee (or organizer) ---
    if (!isAttendee(event)) {
        Logger.log(`Event "${event.summary}" skipped — you are not an attendee.`);
        return;
    }

    // --- Passed all filters: send alert ---
    Logger.log(`Sending alert for event: "${event.summary}"`);
    sendChatAlert(event, meetLink);

    // Mark as alerted so future updates don't re-trigger
    props.setProperty(alertedKey, "true");

    // Clean up old alerted keys after 30 days to prevent unbounded growth
    scheduleKeyCleanup(alertedKey, event);
}


// ============================================================
//  4. CHAT ALERT — format and POST to Google Chat Space
// ============================================================

/**
 * Sends a rich Google Chat card to the configured Space webhook.
 */
function sendChatAlert(event, meetLink) {
    const title = event.summary || "(No title)";
    const organizer = event.organizer
        ? event.organizer.displayName || event.organizer.email
        : "Unknown";
    const organizerEmail = event.organizer ? event.organizer.email : "";

    const { startStr, endStr, dateLabel } = formatEventTime(event);
    const description = event.description
        ? stripHtml(event.description).substring(0, 300) +
        (event.description.length > 300 ? "…" : "")
        : null;

    const attendeeLines = formatAttendees(event);
    const attachmentLines = formatAttachments(event);

    // Build the Chat card using the Cards v2 format
    const card = {
        cardsV2: [
            {
                cardId: "calendarAlert_" + event.id,
                card: {
                    header: {
                        title: "📅 New Meeting Invite",
                        subtitle: title,
                        imageUrl:
                            "https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v1/web-96dp/logo_meet_2020q4_color_2x_web_96dp.png",
                        imageType: "CIRCLE",
                    },
                    sections: buildSections({
                        dateLabel,
                        startStr,
                        endStr,
                        organizer,
                        organizerEmail,
                        attendeeLines,
                        meetLink,
                        description,
                        attachmentLines,
                    }),
                },
            },
        ],
    };

    const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(card),
        muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(CONFIG.CHAT_WEBHOOK_URL, options);
    if (response.getResponseCode() !== 200) {
        Logger.log("Chat webhook error: " + response.getContentText());
    }
}

/**
 * Builds the card sections array for the Chat card.
 */
function buildSections({ dateLabel, startStr, endStr, organizer, organizerEmail, attendeeLines, meetLink, description, attachmentLines }) {
    const sections = [];

    // --- Section 1: Time & Organizer ---
    sections.push({
        widgets: [
            {
                decoratedText: {
                    startIcon: { knownIcon: "CLOCK" },
                    text: `<b>${dateLabel}</b><br>${startStr} → ${endStr}`,
                },
            },
            {
                decoratedText: {
                    startIcon: { knownIcon: "PERSON" },
                    text: `<b>Organizer:</b> ${organizer}${organizerEmail ? " &lt;" + organizerEmail + "&gt;" : ""}`,
                },
            },
        ],
    });

    // --- Section 2: Attendees ---
    if (attendeeLines) {
        sections.push({
            header: "Attendees",
            widgets: [
                {
                    decoratedText: {
                        startIcon: { knownIcon: "MULTIPLE_PEOPLE" },
                        text: attendeeLines,
                    },
                },
            ],
        });
    }

    // --- Section 3: Description ---
    if (description) {
        sections.push({
            header: "Description",
            widgets: [
                {
                    textParagraph: { text: description },
                },
            ],
        });
    }

    // --- Section 4: Attachments ---
    if (attachmentLines.length > 0) {
        sections.push({
            header: "Attachments",
            widgets: attachmentLines.map((a) => ({
                decoratedText: {
                    startIcon: { knownIcon: "DRIVE" },
                    text: `<a href="${a.url}">${a.title}</a>`,
                },
            })),
        });
    }

    // --- Section 5: Join button ---
    sections.push({
        widgets: [
            {
                buttonList: {
                    buttons: [
                        {
                            text: "Join Google Meet",
                            icon: { knownIcon: "VIDEO_PLAY" },
                            color: { red: 0.067, green: 0.62, blue: 0.345, alpha: 1 }, // Google green
                            onClick: { openLink: { url: meetLink } },
                        },
                        {
                            text: "Open in Calendar",
                            icon: { knownIcon: "CALENDAR" },
                            onClick: {
                                openLink: {
                                    url: `https://calendar.google.com/calendar/r/eventedit/${encodeURIComponent(
                                        "primary"
                                    )}`,
                                },
                            },
                        },
                    ],
                },
            },
        ],
    });

    return sections;
}


// ============================================================
//  6. HELPER UTILITIES
// ============================================================

/**
 * Extracts the Google Meet URL from an event's conferenceData,
 * or falls back to searching the description/location fields.
 */
function extractMeetLink(event) {
    // Primary: conferenceData (set when "Add Google Meet" is used)
    if (event.conferenceData && event.conferenceData.entryPoints) {
        const videoEntry = event.conferenceData.entryPoints.find(
            (ep) => ep.entryPointType === "video"
        );
        if (videoEntry) return videoEntry.uri;
    }

    // Fallback: scan location and description for meet.google.com links
    const meetRegex = /https:\/\/meet\.google\.com\/[a-z\-]+/i;
    if (event.location && meetRegex.test(event.location)) {
        return event.location.match(meetRegex)[0];
    }
    if (event.description && meetRegex.test(event.description)) {
        return event.description.match(meetRegex)[0];
    }

    return null;
}

/**
 * Returns true if the configured email appears in the event's attendees
 * or if you are the organizer (single-person events have no attendees array).
 */
function isAttendee(event) {
    const myEmail = CONFIG.MY_EMAIL.toLowerCase();

    // If you're the organizer, you're implicitly attending
    if (
        event.organizer &&
        event.organizer.email &&
        event.organizer.email.toLowerCase() === myEmail
    ) {
        return true;
    }

    // Check attendees list
    if (event.attendees && event.attendees.length > 0) {
        return event.attendees.some(
            (a) => a.email && a.email.toLowerCase() === myEmail
        );
    }

    // No attendees list means it's your own event on your own calendar
    return true;
}

/**
 * Formats event start/end times into human-readable strings.
 */
function formatEventTime(event) {
    const isAllDay = !event.start.dateTime;

    if (isAllDay) {
        const date = new Date(event.start.date);
        return {
            dateLabel: formatDate(date),
            startStr: "All Day",
            endStr: "",
        };
    }

    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    return {
        dateLabel: formatDate(start),
        startStr: formatTime(start),
        endStr: formatTime(end),
    };
}

function formatDate(date) {
    return date.toLocaleDateString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "Asia/Kolkata",
    });
}

function formatTime(date) {
    return date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
    });
}

/**
 * Formats the attendees list into an HTML string for the Chat card.
 * Excludes the organizer (already shown) and limits to first 10.
 */
function formatAttendees(event) {
    if (!event.attendees || event.attendees.length === 0) return null;

    const organizerEmail = event.organizer ? event.organizer.email : "";
    const filtered = event.attendees.filter(
        (a) => a.email !== organizerEmail && !a.resource
    );

    if (filtered.length === 0) return null;

    const shown = filtered.slice(0, 10);
    const lines = shown.map((a) => {
        const name = a.displayName || a.email;
        const status = {
            accepted: "✅",
            declined: "❌",
            tentative: "❓",
            needsAction: "⏳",
        }[a.responseStatus] || "";
        return `${status} ${name}`;
    });

    if (filtered.length > 10) {
        lines.push(`…and ${filtered.length - 10} more`);
    }

    return lines.join("<br>");
}

/**
 * Extracts attachment info from the event.
 */
function formatAttachments(event) {
    if (!event.attachments || event.attachments.length === 0) return [];
    return event.attachments.map((a) => ({
        title: a.title || "Attachment",
        url: a.fileUrl || "#",
    }));
}

/**
 * Strips basic HTML tags from a string (for event descriptions).
 */
function stripHtml(html) {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}

/**
 * Sets a property expiry flag so old "alerted_" keys can be cleaned
 * up by a separate daily trigger (optional enhancement).
 */
function scheduleKeyCleanup(key, event) {
    // Store expiry timestamp for this key (event start + 1 day)
    const eventStart = event.start.dateTime || event.start.date;
    const expiry = new Date(eventStart).getTime() + 24 * 60 * 60 * 1000;
    PropertiesService.getScriptProperties().setProperty(
        key + "_expiry",
        String(expiry)
    );
}

/**
 * Optional: Run daily to clean up expired alerted_ keys.
 * Add a daily time-trigger pointing to this function if desired.
 */
function cleanupOldAlertedKeys() {
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();
    const now = Date.now();
    let deleted = 0;

    for (const [key, value] of Object.entries(allProps)) {
        if (key.endsWith("_expiry")) {
            const expiry = parseInt(value, 10);
            if (now > expiry) {
                const baseKey = key.replace("_expiry", "");
                props.deleteProperty(baseKey);
                props.deleteProperty(key);
                deleted++;
            }
        }
    }

    Logger.log(`Cleaned up ${deleted} expired alert keys.`);
}