const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns");
const { Server } = require("socket.io");
const { buildTemplateComponents, validateTemplateDefinition } = require("./whatsapp-template");

loadEnvFile();

let MongoClient = null;
try {
  ({ MongoClient } = require("mongodb"));
} catch (error) {
  MongoClient = null;
}

const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";
const root = __dirname;
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");
const configuredMongoUri = process.env.MONGODB_URI || "";
const mongoUri = isPlaceholderMongoUri(configuredMongoUri) ? "" : configuredMongoUri;
const mongoDbName = process.env.MONGODB_DB || "skillarion_meet";
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
const mongoDnsServers = String(process.env.MONGODB_DNS_SERVERS || "")
  .split(",")
  .map(server => server.trim())
  .filter(Boolean);
const adminEmail = (process.env.ADMIN_EMAIL || "admin@SkillArionDevelopment.in").toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "SkillArionAdmin123";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const whatsappGraphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v25.0";
const whatsappBusinessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
const whatsappTemplateName = process.env.WHATSAPP_TEMPLATE_NAME || "";
const whatsappTemplateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US";
const whatsappSchedulerEnabled = process.env.WHATSAPP_SCHEDULER_ENABLED === "true";
const whatsappSchedulerIntervalMs = Math.max(30000, Number(process.env.WHATSAPP_SCHEDULER_INTERVAL_MS) || 60000);
const collectionNames = ["meetings", "guests", "candidates", "whatsappCampaigns", "attendance", "transcripts", "chatMessages"];
let mongoClient = null;
let mongoDb = null;
const sessions = new Map();
const sessionTtlMs = 12 * 60 * 60 * 1000;
const whatsappTemplateCacheTtlMs = 5 * 60 * 1000;
let whatsappTemplateCache = null;
let whatsappSchedulerTimer = null;
let whatsappSchedulerRunning = false;

if (mongoDnsServers.length) {
  dns.setServers(mongoDnsServers);
}

validateRuntimeConfig();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const seedDb = {
  settings: {
    companyDomain: "SkillArionDevelopment.in",
    capacityLimit: 1000,
    candidateTranscriptAccess: true,
  },
  meetings: [],
  guests: [],
  candidates: [],
  whatsappCampaigns: [],
  attendance: [],
  chatMessages: [],
  transcripts: [],
};

ensureDb();

const server = http.createServer(async (request, response) => {
  try {
    const requestedUrl = new URL(request.url, `http://${request.headers.host}`);

    if (requestedUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestedUrl);
      return;
    }

    serveStatic(requestedUrl, response);
  } catch (error) {
    if (isDatabaseError(error)) {
      sendJson(response, 503, { error: "Database temporarily unavailable. Please try again shortly." });
      return;
    }
    sendJson(response, 500, { error: "The server could not complete this request." });
  }
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing server or set a different PORT.`);
    process.exit(1);
  }
  throw error;
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  socket.on("join-room", (roomId, userPayload) => {
    socket.join(roomId);
    socket.to(roomId).emit("user-connected", userPayload, socket.id);

    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-disconnected", userPayload, socket.id);
    });

    socket.on("chat-message", (message) => {
      io.to(roomId).emit("chat-message", message);
    });
    
    socket.on("hand-raise", (isRaised) => {
      socket.to(roomId).emit("hand-raise", socket.id, isRaised);
    });

    socket.on("webrtc-offer", (targetSocketId, offer) => {
      socket.to(targetSocketId).emit("webrtc-offer", socket.id, offer, userPayload);
    });

    socket.on("webrtc-answer", (targetSocketId, answer) => {
      socket.to(targetSocketId).emit("webrtc-answer", socket.id, answer);
    });

    socket.on("webrtc-ice-candidate", (targetSocketId, candidate) => {
      socket.to(targetSocketId).emit("webrtc-ice-candidate", socket.id, candidate);
    });
  });
});

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`SkillArionMeet running at http://${displayHost}:${port}`);
  startWhatsappScheduler();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopWhatsappScheduler();
    server.close(async () => {
      if (mongoClient) {
        await mongoClient.close().catch(() => {});
      }
      process.exit(0);
    });
  });
}

async function handleApi(request, response, requestedUrl) {
  const method = request.method;
  const pathname = requestedUrl.pathname;

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true, app: "SkillArionMeet", mode: storageMode() });
    return;
  }

  const db = await readDb();
  if (ensureCandidateInvitationTokens(db)) {
    await writeDb(db);
  }

  if (method === "POST" && pathname === "/api/auth/admin") {
    const body = await readJsonBody(request);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (email !== adminEmail || !secureEqual(password, adminPassword)) {
      sendJson(response, 401, { error: "Invalid admin email or password." });
      return;
    }
    const user = {
      name: body.name || "Company Admin",
      email: adminEmail,
      role: "Admin",
    };
    sendJson(response, 200, { ...user, token: createSession(user) });
    return;
    return;
  }

  if (method === "POST" && pathname === "/api/auth/guest") {
    const body = await readJsonBody(request);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    if (!email) {
      sendJson(response, 400, { error: "Email is required to join." });
      return;
    }
    const user = {
      name: name || "Guest User",
      email: email,
      role: "Guest",
      status: "Joined",
      meeting: "General access",
    };
    sendJson(response, 200, { ...user, token: createSession(user) });
    return;
  }

  if (method === "POST" && pathname === "/api/auth/google") {
    const body = await readJsonBody(request);
    let profile;
    try {
      profile = await verifyGoogleCredential(body.credential);
    } catch (error) {
      sendJson(response, 401, { error: error.message || "Google sign-in could not be verified." });
      return;
    }
    const candidate = (db.candidates || []).find(item => {
      return String(item.email || "").trim().toLowerCase() === profile.email;
    });
    if (!candidate) {
      sendJson(response, 403, { error: "Admin has not added this Google account to the candidate list." });
      return;
    }
    if ((candidate.consentStatus || candidate.status) !== "Accepted") {
      sendJson(response, 403, { error: "Accept the candidate invitation before signing in." });
      return;
    }
    const user = {
      name: profile.name || candidate.name || "Candidate User",
      email: profile.email,
      role: "Candidate",
      picture: profile.picture || "",
    };
    sendJson(response, 200, { ...user, token: createSession(user) });
    return;
  }

  const isPublicInvitation = /^\/api\/candidate-invitations\/[^/]+$/.test(pathname)
    && ["GET", "PUT"].includes(method);
  const session = isPublicInvitation ? null : getSession(request);
  if (!isPublicInvitation && !session) {
    sendJson(response, 401, { error: "Your session is missing or expired. Please sign in again." });
    return;
  }
  if (session && isAdminOnlyRoute(method, pathname) && session.user.role !== "Admin") {
    sendJson(response, 403, { error: "Admin access is required." });
    return;
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    sessions.delete(session.token);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && pathname === "/api/bootstrap") {
    sendJson(response, 200, buildBootstrapForUser(db, session.user));
    return;
  }

  if (method === "GET" && pathname === "/api/meetings") {
    const visibleMeetings = session.user.role === "Admin"
      ? db.meetings
      : (db.meetings || []).filter(meeting => !getMeetingAccessError(db, meeting, session.user));
    sendJson(response, 200, visibleMeetings);
    return;
  }

  if (method === "POST" && pathname === "/api/meetings/join") {
    const body = withSessionIdentity(await readJsonBody(request), session.user);
    const meeting = findMeeting(db, body.code || body.link || body.meeting);
    if (!meeting) {
      sendJson(response, 404, { error: "Meeting not found" });
      return;
    }
    const accessError = getMeetingAccessError(db, meeting, body);
    if (accessError) {
      sendJson(response, 403, { error: accessError });
      return;
    }
    const result = joinMeeting(db, meeting, body);
    await writeDb(db);
    sendJson(response, 200, result);
    return;
  }

  const meetingMatch = pathname.match(/^\/api\/meetings\/([^/]+)$/);
  if (method === "GET" && meetingMatch) {
    const meeting = findMeeting(db, meetingMatch[1]);
    if (!meeting) {
      sendJson(response, 404, { error: "Meeting not found" });
      return;
    }
    if (session.user.role !== "Admin") {
      const accessError = getMeetingAccessError(db, meeting, session.user);
      if (accessError) {
        sendJson(response, 403, { error: accessError });
        return;
      }
    }
    sendJson(response, 200, meeting);
    return;
  }

  const joinMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/join$/);
  if (method === "POST" && joinMatch) {
    const meeting = findMeeting(db, joinMatch[1]);
    if (!meeting) {
      sendJson(response, 404, { error: "Meeting not found" });
      return;
    }
    const body = withSessionIdentity(await readJsonBody(request), session.user);
    const accessError = getMeetingAccessError(db, meeting, body);
    if (accessError) {
      sendJson(response, 403, { error: accessError });
      return;
    }
    const result = joinMeeting(db, meeting, body);
    await writeDb(db);
    sendJson(response, 200, result);
    return;
  }

  const leaveMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/leave$/);
  if (method === "POST" && leaveMatch) {
    const meeting = findMeeting(db, leaveMatch[1]);
    if (!meeting) {
      sendJson(response, 404, { error: "Meeting not found" });
      return;
    }
    const body = withSessionIdentity(await readJsonBody(request), session.user);
    const leftAt = new Date();
    const attendance = findOpenAttendance(db, meeting, body);
    if (!attendance) {
      sendJson(response, 404, { error: "Open attendance record not found" });
      return;
    }

    attendance.leftAt = leftAt.toISOString();
    attendance.left = leftAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const joinedAt = new Date(attendance.joinedAt || leftAt);
    attendance.duration = formatDuration(joinedAt, leftAt);
    attendance.attendedSeconds = diffSeconds(joinedAt, leftAt);
    attendance.meetingElapsedSeconds = getMeetingElapsedSeconds(meeting, leftAt);
    attendance.percent = calculateAttendancePercent(attendance.attendedSeconds, attendance.meetingElapsedSeconds);
    meeting.participants = countLiveMeetingParticipants(db, meeting);
    await writeDb(db);
    sendJson(response, 200, { meeting, attendance });
    return;
  }

  if (method === "POST" && pathname === "/api/meetings") {
    const body = await readJsonBody(request);
    const requestedCode = normalizeMeetingCode(body.code);
    if (requestedCode && findMeeting(db, requestedCode)) {
      sendJson(response, 409, { error: "Meeting code already exists." });
      return;
    }
    const code = requestedCode || createMeetingCode(db);
    const meeting = {
      id: body.id || code,
      code,
      title: body.title || "Untitled meeting",
      host: session.user.name || "Company Admin",
      start: body.start || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      duration: body.duration || "0m",
      participants: Number(body.participants) || 0,
      status: body.status || "Live",
      accessMode: normalizeAccessMode(body.accessMode),
      allowedEmails: normalizeEmailList(body.allowedEmails),
    };
    db.meetings.unshift(meeting);
    await writeDb(db);
    sendJson(response, 201, meeting);
    return;
  }

  if (method === "GET" && pathname === "/api/guests") {
    sendJson(response, 200, db.guests);
    return;
  }

  if (method === "POST" && pathname === "/api/guests") {
    const body = await readJsonBody(request);
    if (!body.name || !body.email) {
      sendJson(response, 400, { error: "Guest name and email are required." });
      return;
    }
    const email = String(body.email || "").trim().toLowerCase();
    const guest = {
      name: String(body.name || "").trim(),
      email,
      meeting: body.meeting || "General access",
      status: body.status || "Invited",
      updatedAt: new Date().toISOString(),
    };
    db.guests = db.guests || [];
    const existingIndex = db.guests.findIndex(item => String(item.email || "").trim().toLowerCase() === email);
    if (existingIndex >= 0) {
      db.guests.splice(existingIndex, 1);
    }
    db.guests.unshift(guest);
    await writeDb(db);
    sendJson(response, 201, guest);
    return;
  }

  if (method === "GET" && pathname === "/api/candidates") {
    db.candidates = db.candidates || [];
    sendJson(response, 200, db.candidates);
    return;
  }

  if (method === "POST" && pathname === "/api/candidates") {
    const body = await readJsonBody(request);
    const phone = normalizePhone(body.phone);
    if (!body.name || !body.email || !phone) {
      sendJson(response, 400, { error: "Candidate name, email, and phone are required." });
      return;
    }
    const candidate = {
      name: String(body.name || "").trim(),
      email: String(body.email || "").trim().toLowerCase(),
      phone,
      program: body.program || "Internship",
      status: body.status || "Consent pending",
      consentStatus: body.consentStatus || "Pending",
      invitationToken: body.invitationToken || createInvitationToken(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.candidates = db.candidates || [];
    const existingIndex = db.candidates.findIndex(item => String(item.email || "").trim().toLowerCase() === candidate.email);
    if (existingIndex >= 0) {
      const existing = db.candidates[existingIndex];
      db.candidates.splice(existingIndex, 1);
      candidate.createdAt = existing.createdAt || candidate.createdAt;
      candidate.invitationToken = existing.invitationToken || candidate.invitationToken;
    }
    db.candidates.unshift(candidate);
    await writeDb(db);
    sendJson(response, 201, candidate);
    return;
  }

  if (method === "DELETE" && pathname === "/api/candidates") {
    db.candidates = [];
    await writeDb(db);
    sendJson(response, 200, { ok: true, cleared: "candidates" });
    return;
  }

  const candidateConsentMatch = pathname.match(/^\/api\/candidates\/(.+)\/consent$/);
  if (method === "PUT" && candidateConsentMatch) {
    const email = decodeURIComponent(candidateConsentMatch[1]).trim().toLowerCase();
    const body = withSessionIdentity(await readJsonBody(request), session.user);
    const decision = String(body.decision || "").toLowerCase();
    if (!["accepted", "declined"].includes(decision)) {
      sendJson(response, 400, { error: "Consent decision must be accepted or declined." });
      return;
    }
    db.candidates = db.candidates || [];
    const candidate = db.candidates.find(item => String(item.email || "").trim().toLowerCase() === email);
    if (!candidate) {
      sendJson(response, 404, { error: "Candidate invitation was not found." });
      return;
    }
    candidate.consentStatus = decision === "accepted" ? "Accepted" : "Declined";
    candidate.status = candidate.consentStatus;
    candidate.consentUpdatedAt = new Date().toISOString();
    candidate.updatedAt = candidate.consentUpdatedAt;
    await writeDb(db);
    sendJson(response, 200, candidate);
    return;
  }

  const invitationMatch = pathname.match(/^\/api\/candidate-invitations\/([^/]+)$/);
  if (method === "GET" && invitationMatch) {
    const candidate = findCandidateByInvitationToken(db, invitationMatch[1]);
    if (!candidate) {
      sendJson(response, 404, { error: "Invitation link was not found." });
      return;
    }
    sendJson(response, 200, publicCandidateInvitation(candidate));
    return;
  }

  if (method === "PUT" && invitationMatch) {
    const candidate = findCandidateByInvitationToken(db, invitationMatch[1]);
    if (!candidate) {
      sendJson(response, 404, { error: "Invitation link was not found." });
      return;
    }
    const body = await readJsonBody(request);
    const decision = String(body.decision || "").toLowerCase();
    if (!["accepted", "declined"].includes(decision)) {
      sendJson(response, 400, { error: "Consent decision must be accepted or declined." });
      return;
    }
    candidate.consentStatus = decision === "accepted" ? "Accepted" : "Declined";
    candidate.status = candidate.consentStatus;
    candidate.consentUpdatedAt = new Date().toISOString();
    candidate.updatedAt = candidate.consentUpdatedAt;
    await writeDb(db);
    sendJson(response, 200, publicCandidateInvitation(candidate));
    return;
  }

  if (method === "GET" && pathname === "/api/whatsapp-campaigns") {
    db.whatsappCampaigns = db.whatsappCampaigns || [];
    sendJson(response, 200, db.whatsappCampaigns);
    return;
  }

  if (method === "GET" && pathname === "/api/whatsapp/status") {
    sendJson(response, 200, getWhatsappStatus());
    return;
  }

  if (method === "POST" && pathname === "/api/whatsapp-campaigns") {
    const body = await readJsonBody(request);
    const recipients = normalizeWhatsappRecipients(body.recipients);
    if (!recipients.length) {
      sendJson(response, 400, { error: "At least one candidate recipient is required." });
      return;
    }
    if (!body.message) {
      sendJson(response, 400, { error: "Message is required." });
      return;
    }
    const meetingCode = normalizeMeetingCode(body.meetingCode || "");
    const meeting = meetingCode ? findMeeting(db, meetingCode) : null;
    if (meetingCode && !meeting) {
      sendJson(response, 404, { error: "The selected meeting was not found." });
      return;
    }
    const meetingLink = meeting ? createPublicMeetingLink(request, meeting.code) : "";
    const campaignMessage = meetingLink
      ? `${String(body.message || "").trim()}\n\nJoin meeting: ${meetingLink}`
      : String(body.message || "").trim();
    const sendMode = body.sendMode === "Scheduled" ? "Scheduled" : "Immediate";
    const scheduledAt = sendMode === "Scheduled" ? normalizeScheduledAt(body.scheduledAt) : "";
    if (sendMode === "Scheduled" && !scheduledAt) {
      sendJson(response, 400, { error: "Select a valid future schedule time." });
      return;
    }
    const campaign = {
      id: `WA-${Date.now()}`,
      message: campaignMessage,
      meetingCode: meeting?.code || "",
      meetingLink,
      recipients,
      sendMode,
      scheduledAt,
      status: sendMode === "Scheduled" ? "Scheduled" : "Sending",
      createdAt: body.createdAt || new Date().toLocaleString(),
      deliveryResults: [],
    };

    if (campaign.sendMode === "Immediate") {
      const whatsappStatus = getWhatsappStatus();
      if (whatsappStatus.configured) {
        const delivery = await sendWhatsappCampaign(campaign);
        campaign.deliveryResults = delivery.results;
        campaign.status = delivery.status;
      } else {
        campaign.status = "Messaging unavailable";
        campaign.deliveryResults = recipients.map(person => ({
          name: person.name,
          phone: person.phone,
          status: "Not sent",
          detail: "The messaging service is currently unavailable.",
        }));
      }
    }

    db.whatsappCampaigns = db.whatsappCampaigns || [];
    db.whatsappCampaigns.unshift(campaign);
    await writeDb(db);
    sendJson(response, 201, campaign);
    return;
  }

  if (method === "GET" && pathname === "/api/attendance") {
    sendJson(response, 200, db.attendance);
    return;
  }

  if (method === "POST" && pathname === "/api/attendance") {
    const body = await readJsonBody(request);
    db.attendance.unshift(body);
    await writeDb(db);
    sendJson(response, 201, body);
    return;
  }

  if (method === "DELETE" && pathname === "/api/attendance") {
    db.attendance = [];
    await writeDb(db);
    sendJson(response, 200, { ok: true, cleared: "attendance" });
    return;
  }

  if (method === "DELETE" && pathname === "/api/meetings") {
    db.meetings = [];
    await writeDb(db);
    sendJson(response, 200, { ok: true, cleared: "meetings" });
    return;
  }

  if (method === "DELETE" && pathname === "/api/whatsapp-campaigns") {
    db.whatsappCampaigns = [];
    await writeDb(db);
    sendJson(response, 200, { ok: true, cleared: "whatsappCampaigns" });
    return;
  }

  if (method === "DELETE" && pathname === "/api/chat-messages") {
    db.chatMessages = [];
    await writeDb(db);
    sendJson(response, 200, { ok: true, cleared: "chatMessages" });
    return;
  }

  if (method === "GET" && pathname === "/api/chat-messages") {
    const meetingCode = normalizeMeetingCode(requestedUrl.searchParams.get("meetingCode") || "");
    const messages = (db.chatMessages || []).filter(message => {
      const messageCode = normalizeMeetingCode(message.meetingCode || "");
      if (meetingCode && messageCode !== meetingCode) {
        return false;
      }
      if (session.user.role === "Admin") {
        return true;
      }
      const meeting = findMeeting(db, messageCode);
      return Boolean(meeting && !getMeetingAccessError(db, meeting, session.user));
    });
    sendJson(response, 200, messages);
    return;
  }

  if (method === "POST" && pathname === "/api/chat-messages") {
    const body = await readJsonBody(request);
    const meetingCode = normalizeMeetingCode(body.meetingCode || "");
    if (!meetingCode) {
      sendJson(response, 400, { error: "Meeting code is required for chat messages." });
      return;
    }
    const message = {
      id: `CHAT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      meetingCode,
      meetingTitle: body.meetingTitle || "",
      sender: session.user.name || "Meeting user",
      email: session.user.email || "",
      role: session.user.role,
      text: String(body.text || "").trim(),
      time: body.time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      createdAt: body.createdAt || new Date().toISOString(),
    };
    if (!message.text) {
      sendJson(response, 400, { error: "Message text is required." });
      return;
    }
    db.chatMessages = db.chatMessages || [];
    db.chatMessages.unshift(message);
    await writeDb(db);
    sendJson(response, 201, message);
    return;
  }

  if (method === "GET" && pathname === "/api/transcripts") {
    const lines = session.user.role === "Admin"
      ? db.transcripts
      : session.user.role === "Candidate"
        ? (db.transcripts || []).filter(line => {
          return String(line.email || "").trim().toLowerCase() === session.user.email
            || String(line.speaker || "").trim().toLowerCase() === String(session.user.name || "").trim().toLowerCase();
        })
        : [];
    sendJson(response, 200, lines);
    return;
  }

  if (method === "POST" && pathname === "/api/transcripts") {
    const body = await readJsonBody(request);
    const line = {
      time: body.time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      speaker: session.user.name || "Unknown",
      email: session.user.email || "",
      section: session.user.role,
      meetingCode: normalizeMeetingCode(body.meetingCode || ""),
      meetingTitle: body.meetingTitle || "",
      text: body.text || "",
    };
    db.transcripts.unshift(line);
    await writeDb(db);
    sendJson(response, 201, line);
    return;
  }

  if (method === "DELETE" && pathname === "/api/transcripts") {
    db.transcripts = [];
    await writeDb(db);
    sendJson(response, 200, { ok: true, cleared: "transcripts" });
    return;
  }

  if (method === "GET" && pathname === "/api/settings") {
    sendJson(response, 200, db.settings);
    return;
  }

  if (method === "PUT" && pathname === "/api/settings") {
    const body = await readJsonBody(request);
    db.settings = { ...db.settings, ...body };
    await writeDb(db);
    sendJson(response, 200, db.settings);
    return;
  }

  sendJson(response, 404, { error: "API route not found" });
}

function serveStatic(requestedUrl, response) {
  const requestedPath = requestedUrl.pathname === "/" ? "/index.html" : requestedUrl.pathname;
  const safePath = path
    .normalize(decodeURIComponent(requestedPath))
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(seedDb, null, 2));
  }
}

async function readDb() {
  if (shouldUseMongo()) {
    return readMongoDb();
  }
  return readJsonDb();
}

async function writeDb(db) {
  if (shouldUseMongo()) {
    await writeMongoDb(db);
    return;
  }
  writeJsonDb(db);
}

function readJsonDb() {
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeJsonDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function shouldUseMongo() {
  return Boolean(mongoUri && MongoClient);
}

function storageMode() {
  if (mongoUri && !MongoClient) {
    return "mongodb-driver-missing";
  }
  return shouldUseMongo() ? "mongodb" : "local-json";
}

async function getMongoDb() {
  if (mongoDb) {
    return mongoDb;
  }
  mongoClient = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  await mongoClient.connect();
  mongoDb = mongoClient.db(mongoDbName);
  await seedMongoIfEmpty(mongoDb);
  return mongoDb;
}

async function readMongoDb() {
  const database = await getMongoDb();
  const db = { settings: await readMongoSettings(database) };
  for (const name of collectionNames) {
    db[name] = await database.collection(name).find({}, { projection: { _id: 0 } }).toArray();
  }
  return db;
}

async function writeMongoDb(db) {
  const database = await getMongoDb();
  await database.collection("settings").deleteMany({});
  await database.collection("settings").insertOne({ ...(db.settings || seedDb.settings), key: "singleton" });
  for (const name of collectionNames) {
    const collection = database.collection(name);
    await collection.deleteMany({});
    if (Array.isArray(db[name]) && db[name].length) {
      await collection.insertMany(db[name]);
    }
  }
}

async function readMongoSettings(database) {
  const settings = await database.collection("settings").findOne({ key: "singleton" }, { projection: { _id: 0, key: 0 } });
  return settings || seedDb.settings;
}

async function seedMongoIfEmpty(database) {
  const existing = await database.collection("settings").findOne({ key: "singleton" });
  if (existing) {
    return;
  }
  await database.collection("settings").insertOne({ ...seedDb.settings, key: "singleton" });
  for (const name of collectionNames) {
    if (Array.isArray(seedDb[name]) && seedDb[name].length) {
      await database.collection(name).insertMany(seedDb[name]);
    }
  }
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, {
    token,
    user: { ...user },
    expiresAt: Date.now() + sessionTtlMs,
  });
  return token;
}

function startWhatsappScheduler() {
  if (!whatsappSchedulerEnabled || whatsappSchedulerTimer) {
    return;
  }
  whatsappSchedulerTimer = setInterval(() => {
    processScheduledWhatsappCampaigns().catch(() => {});
  }, whatsappSchedulerIntervalMs);
  setTimeout(() => {
    processScheduledWhatsappCampaigns().catch(() => {});
  }, 5000);
}

function stopWhatsappScheduler() {
  if (whatsappSchedulerTimer) {
    clearInterval(whatsappSchedulerTimer);
    whatsappSchedulerTimer = null;
  }
}

async function processScheduledWhatsappCampaigns() {
  if (!whatsappSchedulerEnabled || whatsappSchedulerRunning) {
    return;
  }
  whatsappSchedulerRunning = true;
  try {
    const db = await readDb();
    const campaigns = db.whatsappCampaigns || [];
    const dueCampaigns = campaigns.filter(campaign => isCampaignDue(campaign, new Date()));
    for (const campaign of dueCampaigns) {
      campaign.status = "Sending";
      campaign.processingStartedAt = new Date().toISOString();
      await writeDb(db);
      const delivery = await sendWhatsappCampaign(campaign);
      campaign.status = delivery.status;
      campaign.deliveryResults = delivery.results;
      campaign.sentAt = new Date().toISOString();
      delete campaign.processingStartedAt;
      await writeDb(db);
    }
  } finally {
    whatsappSchedulerRunning = false;
  }
}

function isCampaignDue(campaign, now) {
  if (campaign.sendMode !== "Scheduled" || campaign.status !== "Scheduled") {
    return false;
  }
  const scheduledAt = new Date(campaign.scheduledAt || "");
  return !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() <= now.getTime();
}

function normalizeScheduledAt(value) {
  const scheduledAt = new Date(String(value || ""));
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    return "";
  }
  return scheduledAt.toISOString();
}

function getSession(request) {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const session = token ? sessions.get(token) : null;
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionTtlMs;
  return session;
}

function secureEqual(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function verifyGoogleCredential(credential) {
  if (!googleClientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured on the server.");
  }
  if (!credential) {
    throw new Error("Google credential is required.");
  }
  const endpoint = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
  const verificationResponse = await fetch(endpoint);
  const profile = await verificationResponse.json().catch(() => ({}));
  if (!verificationResponse.ok || profile.aud !== googleClientId || profile.email_verified !== "true") {
    throw new Error("Google sign-in could not be verified.");
  }
  return {
    name: profile.name || "",
    email: String(profile.email || "").trim().toLowerCase(),
    picture: profile.picture || "",
  };
}

function isAdminOnlyRoute(method, pathname) {
  if (method === "POST" && pathname === "/api/meetings") return true;
  if (pathname === "/api/guests" || pathname === "/api/candidates") return true;
  if (/^\/api\/candidates\/.+\/consent$/.test(pathname)) return true;
  if (pathname.startsWith("/api/whatsapp")) return true;
  if (pathname === "/api/attendance") return true;
  if (method === "PUT" && pathname === "/api/settings") return true;
  if (method === "DELETE") return true;
  return false;
}

function withSessionIdentity(body, user) {
  return {
    ...body,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function buildBootstrapForUser(db, user) {
  if (user.role === "Admin") {
    return db;
  }

  const email = String(user.email || "").trim().toLowerCase();
  const identity = { name: user.name, email, role: user.role };
  const meetings = (db.meetings || []).filter(meeting => !getMeetingAccessError(db, meeting, identity));
  const meetingCodes = new Set(meetings.map(meeting => normalizeMeetingCode(meeting.code || meeting.id)));
  const attendance = (db.attendance || []).filter(row => String(row.email || "").trim().toLowerCase() === email);
  const transcripts = user.role === "Candidate" && db.settings?.candidateTranscriptAccess !== false
    ? (db.transcripts || []).filter(line => {
      return String(line.email || "").trim().toLowerCase() === email
        || String(line.speaker || "").trim().toLowerCase() === String(user.name || "").trim().toLowerCase();
    })
    : [];

  return {
    settings: db.settings || {},
    meetings,
    guests: user.role === "Guest" ? findGuestRecordsByEmail(db, email) : [],
    candidates: user.role === "Candidate"
      ? (db.candidates || []).filter(candidate => String(candidate.email || "").trim().toLowerCase() === email)
      : [],
    whatsappCampaigns: [],
    attendance,
    transcripts,
    chatMessages: (db.chatMessages || []).filter(message => meetingCodes.has(normalizeMeetingCode(message.meetingCode))),
  };
}

function findMeeting(db, codeOrId) {
  const normalized = normalizeMeetingCode(codeOrId);
  return db.meetings.find(meeting => {
    return String(meeting.code || "").toUpperCase() === normalized || String(meeting.id || "").toUpperCase() === normalized;
  });
}

function createMeetingCode(db) {
  let code = "";
  do {
    code = `SKM-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  } while (findMeeting(db, code));
  return code;
}

function joinMeeting(db, meeting, body) {
  const existingAttendance = findOpenAttendance(db, meeting, body);
  if (existingAttendance) {
    return { meeting, attendance: existingAttendance };
  }

  const joined = new Date();
  const attendance = {
    id: `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    name: body.name || "Meeting user",
    email: body.email || "",
    role: body.role || "Candidate",
    meeting: meeting.title,
    meetingId: meeting.id,
    meetingCode: meeting.code,
    joinedAt: joined.toISOString(),
    leftAt: "",
    joined: joined.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    left: "In meeting",
    duration: "Live",
    attendedSeconds: 0,
    meetingElapsedSeconds: getMeetingElapsedSeconds(meeting, joined),
    percent: 0,
  };
  db.attendance.unshift(attendance);
  meeting.participants = countLiveMeetingParticipants(db, meeting);
  meeting.status = "Live";
  return { meeting, attendance };
}

function getMeetingAccessError(db, meeting, body) {
  const accessMode = normalizeAccessMode(meeting.accessMode);
  const role = String(body.role || "").toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const allowedEmails = normalizeEmailList(meeting.allowedEmails);
  const existingAttendance = findOpenAttendance(db, meeting, body);
  const capacity = Math.max(1, Number(db.settings?.capacityLimit) || 1000);

  if (!existingAttendance && countLiveMeetingParticipants(db, meeting) >= capacity) {
    return `This meeting has reached its participant limit of ${capacity}.`;
  }

  if (accessMode === "candidates" && role !== "candidate") {
    return "You are not allowed to join this meeting. This meeting is for candidates only.";
  }

  if (role === "candidate") {
    const candidate = (db.candidates || []).find(item => String(item.email || "").trim().toLowerCase() === email);
    if (!candidate) {
      return "Candidate invitation was not found. Please contact the admin.";
    }
    if ((candidate.consentStatus || candidate.status) !== "Accepted") {
      return "Please accept the SkillArionDevelopment invitation before joining meetings.";
    }
  }

  if (accessMode === "guests" && role !== "guest") {
    return "You are not allowed to join this meeting. This meeting is for guests only.";
  }

  if (role === "guest") {
    if (accessMode === "candidates") {
      return "This meeting is for candidates only.";
    }
    if (accessMode === "invited" && (!email || !allowedEmails.includes(email))) {
      return "You are not invited to this meeting. Please contact the admin.";
    }
  }

  if (accessMode === "invited" && (!email || !allowedEmails.includes(email))) {
    return "You are not invited to this meeting. Please contact the admin.";
  }

  return "";
}

function countLiveMeetingParticipants(db, meeting) {
  const identities = new Set();
  (db.attendance || []).forEach(row => {
    if (row.meetingCode !== meeting.code || row.left !== "In meeting") {
      return;
    }
    const identity = String(row.email || row.name || row.id || "").trim().toLowerCase();
    if (identity) {
      identities.add(identity);
    }
  });
  return identities.size;
}

function createPublicMeetingLink(request, meetingCode) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (request.socket.encrypted ? "https" : "http");
  const baseUrl = publicBaseUrl || `${protocol}://${request.headers.host}`;
  return `${baseUrl}/?meet=${encodeURIComponent(meetingCode)}`;
}

function findGuestByEmail(db, email) {
  return findGuestRecordsByEmail(db, email)[0];
}

function findGuestRecordsByEmail(db, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return (db.guests || [])
    .filter(item => String(item.email || "").trim().toLowerCase() === normalizedEmail)
    .sort((first, second) => {
      const firstTime = Date.parse(first.updatedAt || first.createdAt || "") || 0;
      const secondTime = Date.parse(second.updatedAt || second.createdAt || "") || 0;
      return secondTime - firstTime;
    });
}

function guestCanJoinMeeting(guest, meeting) {
  const assigned = String(guest.meeting || "").trim().toLowerCase();
  if (!assigned || assigned === "general access") {
    return true;
  }
  const assignedCode = normalizeMeetingCode(guest.meeting).toLowerCase();
  const code = String(meeting.code || "").trim().toLowerCase();
  const title = String(meeting.title || "").trim().toLowerCase();
  const id = String(meeting.id || "").trim().toLowerCase();
  return assigned === code || assigned === title || assigned === id || assignedCode === code || assignedCode === id;
}

function normalizeAccessMode(mode) {
  const value = String(mode || "all").toLowerCase();
  return ["all", "candidates", "guests", "invited"].includes(value) ? value : "all";
}

function normalizeEmailList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  return source
    .map(email => String(email || "").trim().toLowerCase())
    .filter(Boolean);
}

function normalizeWhatsappRecipients(value) {
  const source = Array.isArray(value) ? value : [];
  const byPhone = new Map();
  source.forEach(person => {
    const name = String(person.name || "").trim();
    const phone = normalizePhone(person.phone);
    if (name && phone) {
      byPhone.set(phone, { name, phone });
    }
  });
  return Array.from(byPhone.values());
}

function createInvitationToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function ensureCandidateInvitationTokens(db) {
  let changed = false;
  db.candidates = db.candidates || [];
  db.candidates.forEach(candidate => {
    if (!candidate.invitationToken) {
      candidate.invitationToken = createInvitationToken();
      candidate.updatedAt = candidate.updatedAt || new Date().toISOString();
      changed = true;
    }
    if (!candidate.consentStatus) {
      candidate.consentStatus = candidate.status === "Accepted" || candidate.status === "Declined" ? candidate.status : "Pending";
      changed = true;
    }
  });
  return changed;
}

function findCandidateByInvitationToken(db, token) {
  const normalizedToken = String(token || "").trim();
  return (db.candidates || []).find(candidate => candidate.invitationToken === normalizedToken);
}

function publicCandidateInvitation(candidate) {
  return {
    name: candidate.name,
    email: candidate.email,
    program: candidate.program,
    status: candidate.status,
    consentStatus: candidate.consentStatus || candidate.status || "Pending",
  };
}

function getWhatsappStatus() {
  const configured = Boolean(whatsappPhoneNumberId && whatsappAccessToken && whatsappTemplateName);
  return {
    configured,
    status: configured ? "Configured" : "Not configured",
    graphVersion: whatsappGraphVersion,
    phoneNumberId: whatsappPhoneNumberId ? maskValue(whatsappPhoneNumberId) : "",
    templateName: whatsappTemplateName,
    templateLanguage: whatsappTemplateLanguage,
    requirement: configured
      ? "WhatsApp messaging is ready."
      : "WhatsApp messaging is not available yet.",
  };
}

function maskValue(value) {
  const text = String(value || "");
  if (text.length <= 4) {
    return text ? "****" : "";
  }
  return `${"*".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
}

async function sendWhatsappCampaign(campaign) {
  let templateDefinition;
  try {
    templateDefinition = await getValidatedWhatsappTemplate();
  } catch (error) {
    return {
      status: "WhatsApp configuration error",
      results: campaign.recipients.map(recipient => ({
        name: recipient.name,
        phone: recipient.phone,
        status: "Failed",
        detail: error.message,
      })),
    };
  }

  const results = [];
  for (const recipient of campaign.recipients) {
    const result = await sendWhatsappTemplateMessage(recipient, campaign.message, templateDefinition);
    results.push(result);
  }

  const sentCount = results.filter(result => result.status === "Sent").length;
  if (sentCount === results.length) {
    return { status: "Sent via WhatsApp API", results };
  }
  if (sentCount > 0) {
    return { status: "Partially sent via WhatsApp API", results };
  }
  return { status: "WhatsApp API failed", results };
}

async function sendWhatsappTemplateMessage(recipient, message, templateDefinition) {
  const endpoint = `https://graph.facebook.com/${whatsappGraphVersion}/${whatsappPhoneNumberId}/messages`;
  const template = {
    name: whatsappTemplateName,
    language: { code: whatsappTemplateLanguage },
  };

  const components = buildTemplateComponents(templateDefinition, recipient.name, message);
  if (components) {
    template.components = components;
  }

  const payload = {
    messaging_product: "whatsapp",
    to: recipient.phone,
    type: "template",
    template,
  };

  try {
    const apiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsappAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      return {
        name: recipient.name,
        phone: recipient.phone,
        status: "Failed",
        detail: data.error?.message || `WhatsApp API returned ${apiResponse.status}`,
      };
    }
    return {
      name: recipient.name,
      phone: recipient.phone,
      status: "Sent",
      messageId: data.messages?.[0]?.id || "",
    };
  } catch (error) {
    return {
      name: recipient.name,
      phone: recipient.phone,
      status: "Failed",
      detail: error.message,
    };
  }
}

async function getValidatedWhatsappTemplate() {
  if (whatsappTemplateName === "hello_world") {
    return validateTemplateDefinition({
      name: "hello_world",
      status: "APPROVED",
      language: whatsappTemplateLanguage,
      components: [{ type: "BODY", text: "Hello World" }],
    }, whatsappTemplateName, whatsappTemplateLanguage);
  }
  if (!whatsappBusinessAccountId) {
    throw new Error("WhatsApp Business Account ID is missing from the server configuration.");
  }
  const cacheKey = `${whatsappTemplateName}:${whatsappTemplateLanguage}`;
  if (whatsappTemplateCache?.key === cacheKey && whatsappTemplateCache.expiresAt > Date.now()) {
    return whatsappTemplateCache.definition;
  }

  const query = new URLSearchParams({
    name: whatsappTemplateName,
    fields: "name,status,language,components",
  });
  const endpoint = `https://graph.facebook.com/${whatsappGraphVersion}/${whatsappBusinessAccountId}/message_templates?${query}`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${whatsappAccessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || "Meta could not verify the WhatsApp template.");
  }
  const template = (data.data || []).find(item => {
    return item.name === whatsappTemplateName && item.language === whatsappTemplateLanguage;
  });
  const definition = validateTemplateDefinition(template, whatsappTemplateName, whatsappTemplateLanguage);
  whatsappTemplateCache = {
    key: cacheKey,
    definition,
    expiresAt: Date.now() + whatsappTemplateCacheTtlMs,
  };
  return definition;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return digits.startsWith("91") ? digits : `91${digits}`;
}

function normalizeMeetingCode(code) {
  let value = "";
  try {
    value = decodeURIComponent(String(code || "").trim());
  } catch (error) {
    value = String(code || "").trim();
  }
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    value = url.searchParams.get("meet") || value;
  } catch (error) {
    const match = value.toUpperCase().match(/SKM-[A-Z0-9-]+/);
    if (match) {
      value = match[0];
    }
  }

  value = value.toUpperCase();
  const clean = value.replace(/[^A-Z0-9-]/g, "");
  const withPrefix = clean.startsWith("SKM-") ? clean : `SKM-${clean}`;
  return withPrefix.slice(0, 24);
}

function findOpenAttendance(db, meeting, body) {
  const email = String(body.email || "").toLowerCase();
  if (body.attendanceId) {
    const byId = db.attendance.find(row => {
      return row.id === body.attendanceId
        && row.meetingCode === meeting.code
        && String(row.email || "").toLowerCase() === email
        && row.left === "In meeting";
    });
    if (byId) {
      return byId;
    }
  }

  return db.attendance.find(row => {
    return row.meetingCode === meeting.code && String(row.email || "").toLowerCase() === email && row.left === "In meeting";
  });
}

function formatDuration(start, end) {
  const totalSeconds = diffSeconds(start, end);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function diffSeconds(start, end) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

function getMeetingElapsedSeconds(meeting, now) {
  const startDate = parseMeetingStart(meeting);
  return Math.max(1, diffSeconds(startDate, now));
}

function parseMeetingStart(meeting) {
  const candidates = [meeting.createdAt, meeting.start].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function calculateAttendancePercent(attendedSeconds, meetingElapsedSeconds) {
  if (!meetingElapsedSeconds) {
    return 0;
  }
  return Math.min(100, Math.round((attendedSeconds / meetingElapsedSeconds) * 100));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      return;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

function validateRuntimeConfig() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a number between 1 and 65535.");
  }

  if (!isProduction) {
    return;
  }

  const errors = [];
  if (!mongoUri) {
    errors.push("MONGODB_URI is required in production");
  }
  if (!googleClientId) {
    errors.push("GOOGLE_CLIENT_ID is required in production");
  }
  if (!publicBaseUrl || publicBaseUrl.includes("127.0.0.1") || publicBaseUrl.includes("localhost")) {
    errors.push("PUBLIC_BASE_URL must be the deployed application URL in production");
  }
  if (!process.env.ADMIN_PASSWORD || adminPassword === "SkillArionAdmin123" || adminPassword === "change-this-admin-password") {
    errors.push("ADMIN_PASSWORD must be changed for production");
  }
  if (host === "127.0.0.1" || host === "localhost") {
    errors.push("HOST must be 0.0.0.0 in production");
  }

  if (errors.length) {
    throw new Error(`Invalid production configuration:\n- ${errors.join("\n- ")}`);
  }
}

function isPlaceholderMongoUri(value) {
  const uri = String(value || "").toLowerCase();
  return uri.includes("<password>") || uri.includes("example.mongodb.net");
}

function isDatabaseError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "").toLowerCase();
  return name.startsWith("Mongo")
    || message.includes("mongodb")
    || message.includes("querysrv")
    || message.includes("server selection")
    || message.includes("ssl routines");
}
