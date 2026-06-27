const state = {
  route: "dashboard",
  user: null,
  authToken: "",
  micOn: false,
  cameraOn: false,
  stream: null,
  audioStream: null,
  screenStream: null,
  screenSharing: false,
  meetingPanel: "",
  attendanceTracking: false,
  transcriptActive: false,
  transcriptSpeechListening: false,
  transcriptSpeechMessage: "",
  handRaised: false,
  backendOnline: false,
  pendingJoinCode: new URLSearchParams(window.location.search).get("meet") || "",
  pendingInviteToken: new URLSearchParams(window.location.search).get("invite") || "",
  inviteRecord: null,
  inviteMessage: "",
  activeMeeting: null,
  activeAttendance: null,
  lastCreatedMeeting: null,
  joinMessage: "",
  leaveMessage: "",
  settings: {
    capacityLimit: 1000,
    candidateTranscriptAccess: true,
  },
  attendanceFilter: {
    from: "",
    to: new Date().toISOString().slice(0, 10),
    role: "all",
  },
  whatsappSendMode: "Immediate",
  whatsappDraftManual: "",
  whatsappDraftMessage: "",
  whatsappDraftScheduledAt: "",
  whatsappMeetingCode: "",
  whatsappCandidateStatus: "all",
};

const config = window.SKILL_ARION_CONFIG || {};

let meetings = [];

let attendanceRows = [];

let transcriptLines = [];

let chatMessages = [];

let guests = [];

let candidates = [];

let whatsappCampaigns = [];

let whatsappDraftRecipients = [];

let socket = null;

let peerConnections = {};
let remoteStreams = {};
let remoteUsers = {};

let currentVideoDeviceId = null;
let videoDevices = [];

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

const navItems = [
  ["dashboard", "D", "Home"],
  ["meeting", "M", "Meeting Room"],
  ["attendance", "A", "Attendance"],
  ["transcripts", "T", "Transcripts"],
  ["candidates", "C", "Candidates"],
  ["whatsapp", "W", "WhatsApp"],
  ["guests", "+", "Guests"],
  ["settings", "S", "Settings"],
];

const roleRoutes = {
  Admin: ["dashboard", "meeting", "attendance", "transcripts", "candidates", "whatsapp", "guests", "settings"],
  Candidate: ["dashboard", "meeting", "transcripts"],
  Guest: ["dashboard", "meeting"],
};

function render() {
  const app = document.querySelector("#app");
  if (state.pendingInviteToken && !state.user) {
    app.innerHTML = renderInvitationPage();
    bindInvitationPage();
    return;
  }
  if (!state.user) {
    app.innerHTML = renderLogin();
    bindLogin();
    return;
  }

  app.innerHTML = `
    <div class="app-shell ${state.route === "meeting" ? "meeting-shell" : ""}">
      <header class="topbar workspace-topbar">
        <div class="brand">
          <img class="brand-logo" src="assets/logo.png" alt="Skill Arion logo" />
          <div>
            <div class="brand-title">SkillArionMeet</div>
            <div class="brand-subtitle">SkillArionDevelopment.in</div>
          </div>
        </div>
        <nav class="nav workspace-nav">
          ${visibleNavItems().map(([route, icon, label]) => `
            <button class="${state.route === route ? "active" : ""}" data-route="${route}">
              <span>${label}</span>
            </button>
          `).join("")}
        </nav>
        <div class="identity">
          <div class="avatar">${initials(state.user.name)}</div>
          <div>
            <div class="name">${state.user.name}</div>
            <div class="muted">${state.user.role} | ${state.user.email}</div>
          </div>
          <button class="btn ghost" id="logoutBtn">Sign out</button>
        </div>
      </header>
      <main class="main">
        <section class="content">
          ${state.leaveMessage ? `<div class="notice success">${state.leaveMessage}</div>` : ""}
          ${routeView()}
        </section>
      </main>
    </div>
  `;
  bindShell();
}

function renderLogin() {
  const joiningMeeting = Boolean(state.pendingJoinCode);
  return `
    <section class="login-screen">
      <div class="login-intro">
        <div class="brand login-brand">
          <img class="brand-logo" src="assets/logo.png" alt="Skill Arion logo" />
          <div>
            <div class="brand-title">SkillArionMeet</div>
            <div class="brand-subtitle">SkillArionDevelopment.in</div>
          </div>
        </div>
        <div>
          <div class="login-kicker">Internal meeting workspace</div>
          <h1>Meetings with attendance and transcript control.</h1>
          <p>Built for Skill Arion teams, candidates, and invited guests with admin-managed access.</p>
        </div>
        <div class="login-highlights">
          <div><strong>No time limit</strong><span>Run long internal sessions without a meeting cutoff.</span></div>
          <div><strong>Attendance reports</strong><span>Admin can track meeting participation and export reports.</span></div>
          <div><strong>Transcript sections</strong><span>Admin and candidate transcript views stay separate.</span></div>
        </div>
      </div>
      <div class="login-panel">
        <div class="login-panel-header">
          <h2>${joiningMeeting ? "Join meeting" : "Choose access"}</h2>
          <p>${joiningMeeting ? `Meeting ${state.pendingJoinCode} is ready. Continue with your approved account.` : "Sign in with your approved company access."}</p>
        </div>
        <div class="role-grid">
          <button class="role-card ${joiningMeeting ? "" : "active"}" data-role="Admin">
            <strong>Admin</strong><br /><span class="muted">Company dashboard access</span>
          </button>
          <button class="role-card ${joiningMeeting ? "active" : ""}" data-role="Candidate">
            <strong>Candidate</strong><br /><span class="muted">Google sign-in</span>
          </button>
          <button class="role-card" data-role="Guest">
            <strong>Guest</strong><br /><span class="muted">Admin-approved email</span>
          </button>
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" value="admin@SkillArionDevelopment.in" />
        </div>
        <div class="field">
          <label for="name">Name</label>
          <input id="name" value="Company Admin" />
        </div>
        <div class="field" id="passwordField">
          <label for="password">Password</label>
          <input id="password" type="password" placeholder="Admin password" />
        </div>
        <div class="google-login-box" id="googleLoginBox">
          <div class="google-login-title">Candidate login</div>
          <div id="googleSignInButton"></div>
          <div class="muted" id="googleLoginStatus"></div>
        </div>
        <button class="btn primary" id="loginBtn">Continue</button>
      </div>
    </section>
  `;
}

function renderInvitationPage() {
  const candidate = state.inviteRecord;
  const accepted = state.inviteMessage.includes("accepted");
  const declined = state.inviteMessage.includes("declined");
  return `
    <section class="login-screen invite-screen">
      <div class="login-intro">
        <div class="brand login-brand">
          <img class="brand-logo" src="assets/logo.png" alt="Skill Arion logo" />
          <div>
            <div class="brand-title">SkillArionMeet</div>
            <div class="brand-subtitle">SkillArionDevelopment.in</div>
          </div>
        </div>
        <div>
          <div class="login-kicker">Candidate invitation</div>
          <h1>Confirm your SkillArionDevelopment meeting invitation.</h1>
          <p>Choose whether you want to receive meeting updates and access meeting sessions through SkillArionMeet.</p>
        </div>
      </div>
      <div class="login-panel">
        <div class="login-panel-header">
          <h2>${candidate ? "Invitation details" : "Loading invitation"}</h2>
          <p>${state.inviteMessage || "Checking the invitation link..."}</p>
        </div>
        ${candidate ? `
          <div class="card">
            <strong>${candidate.name}</strong>
            <div class="muted">${candidate.email} | ${candidate.program || "Candidate"}</div>
            <div class="muted">Status: ${candidate.consentStatus || candidate.status || "Pending"}</div>
          </div>
        ` : ""}
        ${candidate && !accepted && !declined ? `
          <div class="actions" style="margin-top: 14px;">
            <button class="btn primary" id="acceptInviteLinkBtn">Accept invitation</button>
            <button class="btn ghost" id="declineInviteLinkBtn">Decline</button>
          </div>
        ` : ""}
        ${accepted ? `<button class="btn primary" id="continueAfterInviteBtn" style="margin-top: 14px;">Continue to candidate login</button>` : ""}
        ${declined ? `<button class="btn ghost" id="continueAfterInviteBtn" style="margin-top: 14px;">Back to login</button>` : ""}
      </div>
    </section>
  `;
}

function routeView() {
  return {
    dashboard: renderDashboard,
    meeting: renderMeeting,
    attendance: renderAttendance,
    transcripts: renderTranscripts,
    candidates: renderCandidates,
    whatsapp: renderWhatsApp,
    guests: renderGuests,
    settings: renderSettings,
  }[state.route]();
}

function renderDashboard() {
  if (state.user.role === "Admin") {
    return renderAdminDashboard();
  }
  if (state.user.role === "Candidate") {
    return renderCandidateDashboard();
  }
  return renderGuestDashboard();
}

function renderAdminDashboard() {
  const averageAttendance = attendanceRows.length
    ? Math.round(attendanceRows.reduce((sum, row) => sum + Number(row.percent || 0), 0) / attendanceRows.length)
    : 0;
  return `
    <div class="grid">
      <section class="home-hero">
        <div>
          <div class="login-kicker">Admin meeting control</div>
          <h1>Start, manage, and review company meetings.</h1>
          <p>Create rooms, track attendance, manage guests, and control transcripts from one meeting-first workspace.</p>
        </div>
        <div class="actions">
          <button class="btn primary" data-route="meeting">Start meeting</button>
          <button class="btn" data-route="attendance">View attendance</button>
          <button class="btn" data-route="whatsapp">WhatsApp messages</button>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Create meeting link</h2>
          ${state.lastCreatedMeeting ? `<span class="pill ok">${state.lastCreatedMeeting.code}</span>` : ""}
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Meeting title</label>
            <input id="newMeetingTitle" placeholder="Example: Candidate interview round" />
          </div>
          <div class="field">
            <label>Custom meeting code</label>
            <input id="newMeetingCode" placeholder="Optional, example: HR-ROUND-1" />
          </div>
          <div class="field">
            <label>Scheduled time</label>
            <input id="newMeetingStart" type="datetime-local" />
          </div>
          <div class="field">
            <label>Who can join</label>
            <select id="newMeetingAccessMode">
              <option value="all">Candidates and guests</option>
              <option value="candidates">Candidates only</option>
              <option value="guests">Guests only</option>
              <option value="invited">Specific invited emails only</option>
            </select>
          </div>
          <div class="field">
            <label>Invited emails</label>
            <textarea id="newMeetingAllowedEmails" placeholder="Optional: one email per line or comma separated"></textarea>
          </div>
        </div>
        <div class="actions" style="margin-top: 14px;">
          <button class="btn primary" id="createMeetingBtn">Create meeting</button>
          ${state.lastCreatedMeeting ? `<button class="btn" id="copyMeetingCodeBtn">Copy code</button>` : ""}
          ${state.lastCreatedMeeting ? `<button class="btn" id="copyMeetingLinkBtn">Copy link</button>` : ""}
        </div>
        ${state.lastCreatedMeeting ? `
          <div class="muted" style="margin-top: 12px;">Share this code with candidates or guests: <strong>${state.lastCreatedMeeting.code}</strong></div>
          <div class="meeting-link-box">${getMeetingJoinLink(state.lastCreatedMeeting)}</div>
        ` : ""}
      </section>
      <div class="grid cols-3">
        <div class="stat"><div class="stat-value">No limit</div><div class="stat-label">Meeting time limit</div></div>
        <div class="stat"><div class="stat-value">1000</div><div class="stat-label">Target max participants</div></div>
        <div class="stat"><div class="stat-value">${averageAttendance}%</div><div class="stat-label">Average attendance</div></div>
      </div>
      <div class="grid cols-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Recent meetings</h2>
            <button class="btn primary" data-route="meeting">Start meet</button>
          </div>
          <div class="list">
            ${meetings.length ? meetings.map(meetingRow).join("") : `<div class="card">No meetings created yet.</div>`}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2>Admin controls</h2>
            <span class="pill ok">Role based</span>
          </div>
          <div class="list">
            <div class="card"><strong>Attendance reports</strong><div class="muted">Filter company-wide records from date to date.</div></div>
            <div class="card"><strong>Transcript sections</strong><div class="muted">Separate host/admin and candidate transcript views.</div></div>
            <div class="card"><strong>WhatsApp campaigns</strong><div class="muted">Send immediate or scheduled candidate updates to approved recipients.</div></div>
            <div class="card"><strong>Guest access</strong><div class="muted">Assign temporary guests to a specific meeting.</div></div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderCandidateDashboard() {
  const transcriptCount = transcriptLines.filter(line => line.section === "Candidate").length;
  const candidateInvite = currentCandidateRecord();
  return `
    <div class="grid">
      <section class="home-hero">
        <div>
          <div class="login-kicker">Candidate meeting space</div>
          <h1>Join your assigned meetings quickly.</h1>
          <p>Use your meeting room and access transcript entries shared with candidates.</p>
        </div>
        <div class="actions">
          <button class="btn primary" data-route="transcripts">My transcripts</button>
        </div>
      </section>
      <div class="grid cols-3">
        <div class="stat"><div class="stat-value">Join</div><div class="stat-label">Meeting by code or link</div></div>
        <div class="stat"><div class="stat-value">Google</div><div class="stat-label">Candidate sign-in</div></div>
        <div class="stat"><div class="stat-value">${transcriptCount}</div><div class="stat-label">Transcript records</div></div>
      </div>
      ${renderCandidateConsentCard(candidateInvite)}
      <div class="grid cols-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Join meeting</h2>
          </div>
          <div class="field">
            <label>Meeting code or link</label>
            <input id="joinMeetingCode" value="${state.pendingJoinCode}" placeholder="Example: SKM-8F2KQ or meeting link" />
          </div>
          <button class="btn primary" id="joinMeetingBtn" style="margin-top: 12px;">Join meeting</button>
          ${state.joinMessage ? `<div class="muted" style="margin-top: 10px;">${state.joinMessage}</div>` : ""}
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2>My access</h2>
            <span class="pill">Candidate</span>
          </div>
          <div class="list">
            <div class="card"><strong>Candidate transcripts</strong><div class="muted">View transcript entries shared with candidates.</div></div>
            <div class="card"><strong>Meeting controls</strong><div class="muted">Use audio, video, chat, and screen share when allowed.</div></div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function currentCandidateRecord() {
  const email = String(state.user?.email || "").trim().toLowerCase();
  return candidates.find(candidate => String(candidate.email || "").trim().toLowerCase() === email);
}

function renderCandidateConsentCard(candidate) {
  if (!candidate) {
    return `
      <section class="panel consent-panel">
        <div class="panel-header">
          <h2>Invitation status</h2>
          <span class="pill warn">Not invited yet</span>
        </div>
        <div class="notice">
          Your Google login is active, but Admin has not added this email to the candidate list yet.
        </div>
      </section>
    `;
  }

  const consent = candidate.consentStatus || candidate.status || "Consent pending";
  if (consent === "Accepted") {
    return `
      <section class="panel consent-panel">
        <div class="panel-header">
          <h2>Invitation accepted</h2>
          <span class="pill ok">Accepted</span>
        </div>
        <div class="notice success">You accepted SkillArionDevelopment meeting updates. You can join meetings shared by Admin.</div>
      </section>
    `;
  }

  if (consent === "Declined") {
    return `
      <section class="panel consent-panel">
        <div class="panel-header">
          <h2>Invitation declined</h2>
          <span class="pill danger">Declined</span>
        </div>
        <div class="notice">You declined meeting updates. Admin will see your declined status.</div>
      </section>
    `;
  }

  return `
    <section class="panel consent-panel">
      <div class="panel-header">
        <h2>SkillArionDevelopment invitation</h2>
        <span class="pill warn">Consent pending</span>
      </div>
      <div class="notice">
        Admin has added you for ${candidate.program || "the meeting process"}. Please choose whether you want to receive meeting updates and join meeting sessions.
      </div>
      <div class="actions" style="margin-top: 14px;">
        <button class="btn primary" id="acceptCandidateInviteBtn">Accept</button>
        <button class="btn ghost" id="declineCandidateInviteBtn">Decline</button>
      </div>
    </section>
  `;
}

function renderGuestDashboard() {
  return `
    <div class="grid">
      <section class="home-hero">
        <div>
          <div class="login-kicker">Guest access</div>
          <h1>Enter a meeting with limited access.</h1>
          <p>Guests can join assigned rooms only. Admin controls attendance, reports, and transcript access.</p>
        </div>
      </section>
      <div class="grid cols-2">
      <section class="panel">
        <div class="panel-header">
          <h2>Guest meeting access</h2>
          <span class="pill warn">Limited</span>
        </div>
        <div class="field">
          <label>Meeting code or invite link</label>
          <input id="joinMeetingCode" value="${state.pendingJoinCode}" placeholder="Example: SKM-8F2KQ or meeting link" />
        </div>
        <div class="actions" style="margin-top: 14px;">
          <button class="btn primary" id="joinMeetingBtn">Join meeting</button>
        </div>
        ${state.joinMessage ? `<div class="muted" style="margin-top: 10px;">${state.joinMessage}</div>` : ""}
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Guest permissions</h2>
        </div>
        <div class="list">
          <div class="card">Join assigned meetings only</div>
          <div class="card">Use audio and video after host approval</div>
          <div class="card">No admin reports or guest management access</div>
        </div>
      </section>
      </div>
    </div>
  `;
}

function renderMeeting() {
  if (state.user?.role !== "Admin" && !state.activeMeeting) {
    return `
      <div class="join-required">
        <section class="panel">
          <div class="panel-header">
            <h2>Join a meeting</h2>
            <span class="pill">Code or link required</span>
          </div>
          <div class="field">
            <label>Meeting code or link</label>
            <input id="joinMeetingCode" value="${state.pendingJoinCode}" placeholder="Example: SKM-8F2KQ or meeting link" />
          </div>
          <div class="actions" style="margin-top: 12px;">
            <button class="btn primary" id="joinMeetingBtn">Join meeting</button>
            <button class="btn" id="backToHomeBtn">Back to Home</button>
          </div>
          ${state.joinMessage ? `<div class="muted" style="margin-top: 10px;">${state.joinMessage}</div>` : ""}
        </section>
      </div>
    `;
  }

  const meetingTitle = state.activeMeeting?.title || "Meeting Room";
  const meetingCode = state.activeMeeting?.code || "Demo room";
  const people = meetingParticipants();
  const canTrackAttendance = state.user.role === "Admin";

  return `
    <div class="meeting-room">
      <header class="meeting-topnav">
        <div class="meeting-brand">
          <img class="meeting-logo" src="assets/logo.png" alt="Skill Arion logo" />
          <div>
            <div class="meeting-title">SkillArionMeet</div>
            <div class="meeting-subtitle">${meetingTitle} | ${meetingCode}</div>
          </div>
        </div>
        <nav class="meeting-route-nav">
          ${visibleNavItems().filter(([route]) => route !== "meeting").map(([route, icon, label]) => `
            <button class="btn ghost" data-route="${route}">${label}</button>
          `).join("")}
        </nav>
      </header>
      <section class="stage">
        <div class="video-grid">
          <div class="tile" id="selfTile">
            ${state.screenSharing
              ? `<video id="screenVideo" autoplay muted playsinline></video>`
              : state.cameraOn
                ? `<video id="localVideo" autoplay muted playsinline></video>`
                : `<div class="tile-initial">${initials(state.user.name)}</div>`}
            <div class="tile-name">${state.user.name} | ${state.screenSharing ? "Presenting" : "You"}</div>
            ${state.handRaised ? `<div class="hand-raise-badge">✋</div>` : ""}
          </div>
          ${people.filter(person => !person.isSelf && !Object.values(remoteUsers).some(u => u.email === person.email)).map(person => `
            <div class="tile">
              <div class="tile-initial">${initials(person.name)}</div>
              <div class="tile-name">${person.name} | ${person.role}</div>
            </div>
          `).join("")}
          ${Object.keys(remoteStreams).map(socketId => `
            <div class="tile remote-tile" data-socket="${socketId}">
              <video id="remoteVideo-${socketId}" autoplay playsinline></video>
              <div class="tile-name">${remoteUsers[socketId]?.name || 'Participant'}</div>
              ${remoteUsers[socketId]?.handRaised ? `<div class="hand-raise-badge">✋</div>` : ""}
            </div>
          `).join("")}
        </div>
        <div class="controls">
          <button class="control ${!state.micOn ? "danger" : ""}" id="micBtn" title="${state.micOn ? "Microphone on" : "Microphone off"}" aria-label="${state.micOn ? "Microphone on" : "Microphone off"}">${controlIcon(state.micOn ? "mic" : "micOff")}</button>
          <button class="control ${!state.cameraOn ? "danger" : ""}" id="cameraBtn" title="Camera" aria-label="Camera">${controlIcon("camera")}</button>
          ${videoDevices.length > 1 ? `<button class="control" id="switchCameraBtn" title="Switch Camera" aria-label="Switch Camera">${controlIcon("switchCamera")}</button>` : ""}
          <button class="control ${state.screenSharing ? "active-blue" : ""}" id="screenBtn" title="${state.screenSharing ? "Stop presenting" : "Share screen"}" aria-label="${state.screenSharing ? "Stop presenting" : "Share screen"}">${controlIcon("screen")}</button>
          <button class="control ${state.handRaised ? "active" : ""}" id="handBtn" title="Raise hand" aria-label="Raise hand">${controlIcon("hand")}</button>
          ${canTrackAttendance ? `<button class="control track-control ${state.meetingPanel === "attendance" ? "active" : ""}" id="markAttendanceBtn" title="Track attendance">Track attendance</button>` : ""}
          <button class="control ${state.meetingPanel === "chat" ? "active" : ""}" id="chatBtn" title="Chat" aria-label="Chat">${controlIcon("chat")}</button>
          <button class="control ${state.meetingPanel === "participants" ? "active" : ""}" id="peopleBtn" title="Participants" aria-label="Participants">${controlIcon("people")}</button>
          <button class="control" id="moreBtn" title="More options" aria-label="More options">${controlIcon("more")}</button>
          <button class="control end" id="endBtn" title="End meeting" aria-label="End meeting">${controlIcon("phone")}</button>
        </div>
      </section>
      ${state.meetingPanel ? `<aside class="side-stack">
        ${renderMeetingPanel(people)}
      </aside>` : ""}
    </div>
  `;
}

function controlIcon(name) {
  const icons = {
    mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>`,
    micOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9v2a3 3 0 0 0 5 2.24"/><path d="M15 9V6a3 3 0 0 0-5.12-2.12"/><path d="M19 11a7 7 0 0 1-1.7 4.58"/><path d="M5 11a7 7 0 0 0 10.12 6.25"/><path d="M12 18v3"/><path d="M8 21h8"/><path d="M3 3l18 18"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><path d="M17 10l5-3v10l-5-3Z"/></svg>`,
    screen: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M12 16v3"/><path d="M8 19h8"/><path d="M12 13V9"/><path d="M9.5 11.5 12 9l2.5 2.5"/></svg>`,
    chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-1-1.73V8a2 2 0 0 1 2-2Z"/><path d="M8 10h8"/><path d="M8 13h5"/></svg>`,
    people: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 19a4 4 0 0 0-8 0"/><circle cx="12" cy="10" r="3"/><path d="M22 19a3.5 3.5 0 0 0-4-3.45"/><path d="M17 8a2.5 2.5 0 0 1 0 5"/><path d="M2 19a3.5 3.5 0 0 1 4-3.45"/><path d="M7 8a2.5 2.5 0 0 0 0 5"/></svg>`,
    more: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5h.01"/><path d="M12 12h.01"/><path d="M12 19h.01"/></svg>`,
    phone: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 10.5c3.4-2 7.6-2 11 0"/><path d="M8.5 9.5l-2 3.5 3 1.5 1.5-2.5"/><path d="M15.5 9.5l2 3.5-3 1.5-1.5-2.5"/></svg>`,
    hand: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none"><path d="M18.5 10.5V7a1.5 1.5 0 0 0-3 0v1A1.5 1.5 0 0 0 12.5 5v1A1.5 1.5 0 0 0 9.5 4v8A1.5 1.5 0 0 0 6.5 13H6a1.5 1.5 0 0 0-1.5 1.5v2C4.5 20.64 7.86 24 12 24s7.5-3.36 7.5-7.5v-6a1.5 1.5 0 0 0-1-1.4z"/></svg>`,
    switchCamera: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12A9 9 0 0 0 6.64 5.64L3 9M3 12a9 9 0 0 0 14.36 6.36L21 15M21 9v6M3 15V9"/></svg>`,
  };
  return `<span class="control-icon">${icons[name] || icons.more}</span>`;
}

function activeMeetingChatMessages() {
  const code = String(state.activeMeeting?.code || "").toUpperCase();
  return chatMessages
    .filter(message => !code || String(message.meetingCode || "").toUpperCase() === code)
    .sort((first, second) => {
      const firstTime = Date.parse(first.createdAt || "") || 0;
      const secondTime = Date.parse(second.createdAt || "") || 0;
      return firstTime - secondTime;
    });
}

async function loadActiveMeetingChatMessages() {
  if (!state.activeMeeting?.code) {
    return;
  }
  try {
    const messages = await apiRequest(`/api/chat-messages?meetingCode=${encodeURIComponent(state.activeMeeting.code)}`);
    const otherMessages = chatMessages.filter(message => {
      return String(message.meetingCode || "").toUpperCase() !== String(state.activeMeeting.code || "").toUpperCase();
    });
    chatMessages = [...otherMessages, ...messages];
    state.backendOnline = true;
  } catch (error) {
    state.backendOnline = false;
  }
}

function renderMeetingPanel(people) {
  if (state.meetingPanel === "chat") {
    const roomMessages = activeMeetingChatMessages();
    return `
      <section class="panel meeting-chat-panel">
        <div class="panel-header">
          <div>
            <h2>Meeting chat</h2>
            <div class="muted">${state.activeMeeting?.title || "Current room"}</div>
          </div>
          <button class="btn ghost" id="closeMeetingPanelBtn">Close</button>
        </div>
        <div class="chat-thread">
          ${roomMessages.length ? roomMessages.map(message => `
            <div class="chat-bubble ${message.email === state.user.email ? "self" : ""}">
              <div class="chat-meta">
                <strong>${message.sender}</strong>
                <span>${message.time} | ${message.role}</span>
              </div>
              <div class="chat-text">${message.text}</div>
            </div>
          `).join("") : `<div class="chat-empty">No messages in this meeting yet.</div>`}
        </div>
        <div class="chat-compose">
          <input id="chatInput" placeholder="Type a message" />
          <button class="btn primary" id="sendChatBtn">Send</button>
        </div>
      </section>
    `;
  }

  if (state.meetingPanel === "attendance") {
    const roomRows = activeMeetingAttendanceRows();
    return `
      <section class="panel">
        <div class="panel-header">
          <h2>Attendance report</h2>
          <button class="btn ghost" id="closeMeetingPanelBtn">Close</button>
        </div>
        <div class="card"><strong>${state.attendanceTracking ? "Tracking active" : "Tracking started"}</strong><div class="muted">Join, leave, rejoin, duration, and percentage are being recorded.</div></div>
        <div class="list">
          ${roomRows.length ? roomRows.map(row => `
            <div class="person-row">
              <div class="person-meta">
                <div class="name">${row.name}</div>
                <div class="muted">${row.joined} - ${row.left} | ${row.duration}</div>
              </div>
              <span class="pill ${row.percent >= 90 ? "ok" : "warn"}">${row.percent}%</span>
            </div>
          `).join("") : `<div class="empty">No attendance records for this room yet.</div>`}
        </div>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Participants</h2>
        <button class="btn ghost" id="closeMeetingPanelBtn">Close</button>
      </div>
      <div class="list">
        ${people.map(person => personRow(person.name, person.isSelf ? `${person.role} | You` : person.role)).join("")}
      </div>
    </section>
  `;
}

function meetingParticipants() {
  const selfEmail = String(state.user?.email || "").toLowerCase();
  const activeCode = state.activeMeeting?.code || "";
  const participants = new Map();
  participants.set(selfEmail || "self", {
    name: state.user?.name || "You",
    email: selfEmail,
    role: state.user?.role || "User",
    isSelf: true,
  });

  if (!activeCode) {
    return Array.from(participants.values());
  }

  attendanceRows
    .filter(row => {
      if (row.meetingCode !== activeCode) {
        return false;
      }
      return row.left === "In meeting";
    })
    .forEach(row => {
      const email = String(row.email || row.name || "").toLowerCase();
      if (!email) {
        return;
      }
      participants.set(email, {
        name: row.name || "Meeting user",
        email,
        role: row.role || "Participant",
        isSelf: email === selfEmail,
      });
    });

  return Array.from(participants.values());
}

function activeMeetingAttendanceRows() {
  const activeCode = state.activeMeeting?.code || "";
  if (!activeCode) {
    return [];
  }
  return attendanceRows.filter(row => row.meetingCode === activeCode);
}

function renderAttendance() {
  if (state.user?.role !== "Admin") {
    return renderPersonalAttendance();
  }

  const rows = filteredAttendance();
  return `
    <div class="grid">
      <section class="panel">
        <div class="panel-header">
          <h2>Company attendance report</h2>
          <div class="actions">
            <button class="btn" id="exportCsvBtn">Export CSV</button>
          </div>
        </div>
        <div class="filters">
          <input type="date" id="fromDate" value="${state.attendanceFilter.from}" />
          <input type="date" id="toDate" value="${state.attendanceFilter.to}" />
          <select id="roleFilter">
            <option value="all" ${state.attendanceFilter.role === "all" ? "selected" : ""}>All roles</option>
            <option value="Candidate" ${state.attendanceFilter.role === "Candidate" ? "selected" : ""}>Candidates</option>
            <option value="Guest" ${state.attendanceFilter.role === "Guest" ? "selected" : ""}>Guests</option>
          </select>
        </div>
      </section>
      ${renderAttendanceTotals(rows)}
      <section class="panel">
        <div class="panel-header">
          <h2>Detailed attendance</h2>
          <span class="pill">${rows.length} records</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Role</th><th>Meeting</th><th>Joined</th><th>Left</th><th>Duration</th><th>Attended</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map(row => `
                <tr>
                  <td><strong>${row.name}</strong><div class="muted">${row.email}</div></td>
                  <td>${row.role}</td>
                  <td>${row.meeting}</td>
                  <td>${row.joined}</td>
                  <td>${row.left}</td>
                  <td>${row.duration}</td>
                  <td><span class="pill ${row.percent >= 90 ? "ok" : "warn"}">${row.percent}%</span></td>
                </tr>
              `).join("") : `
                <tr>
                  <td colspan="7"><div class="empty">No attendance records found for the selected filters.</div></td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderPersonalAttendance() {
  const rows = filteredAttendance();
  return `
    <div class="grid">
      <section class="panel">
        <div class="panel-header">
          <h2>My attendance</h2>
          <span class="pill">${rows.length} records</span>
        </div>
        <div class="muted">Only your own attendance is visible here. Company-wide tracking is available only to Admin.</div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Attendance history</h2>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Meeting</th><th>Joined</th><th>Left</th><th>Duration</th><th>Attended</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map(row => `
                <tr>
                  <td>${row.meeting}</td>
                  <td>${row.joined}</td>
                  <td>${row.left}</td>
                  <td>${row.duration}</td>
                  <td><span class="pill ${row.percent >= 90 ? "ok" : "warn"}">${row.percent}%</span></td>
                </tr>
              `).join("") : `
                <tr>
                  <td colspan="5"><div class="empty">No attendance records found for this account yet.</div></td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderAttendanceTotals(rows) {
  const summary = buildAttendanceSummary(rows);

  return `
    <section class="grid cols-3">
      <div class="stat"><div class="stat-value">${summary.total}</div><div class="stat-label">Total joins</div></div>
      <div class="stat"><div class="stat-value">${summary.completed}</div><div class="stat-label">Completed attendance</div></div>
      <div class="stat"><div class="stat-value">${summary.averagePercent}%</div><div class="stat-label">Average attended</div></div>
    </section>
  `;
}

function buildAttendanceSummary(rows) {
  const completedRows = rows.filter(row => row.left && row.left !== "In meeting");
  const liveRows = rows.filter(row => row.left === "In meeting");
  const averagePercent = completedRows.length
    ? Math.round(completedRows.reduce((sum, row) => sum + Number(row.percent || 0), 0) / completedRows.length)
    : 0;
  const meetingMap = rows.reduce((map, row) => {
    const key = row.meeting || "Untitled meeting";
    if (!map.has(key)) {
      map.set(key, { meeting: key, total: 0, completed: 0, live: 0, percentTotal: 0 });
    }
    const item = map.get(key);
    item.total += 1;
    if (row.left === "In meeting") {
      item.live += 1;
    } else {
      item.completed += 1;
      item.percentTotal += Number(row.percent || 0);
    }
    return map;
  }, new Map());
  const meetings = Array.from(meetingMap.values()).map(item => ({
    ...item,
    averagePercent: item.completed ? Math.round(item.percentTotal / item.completed) : 0,
  }));
  return {
    total: rows.length,
    completed: completedRows.length,
    live: liveRows.length,
    averagePercent,
    meetings,
  };
}

function renderTranscripts() {
  if (state.user?.role !== "Admin") {
    const candidateLines = visibleTranscriptLines("Candidate");
    return `
      <section class="panel">
        <div class="panel-header">
          <h2>My transcript section</h2>
          <button class="btn" id="downloadTranscriptBtn">Download transcript</button>
        </div>
        <div class="list">
          ${candidateLines.length ? candidateLines.map(transcriptLine).join("") : `<div class="card">No candidate transcript entries yet.</div>`}
        </div>
      </section>
    `;
  }
  const adminLines = visibleTranscriptLines("Admin");
  const candidateLines = visibleTranscriptLines("Candidate");

  return `
    <div class="grid cols-2">
      <section class="panel">
        <div class="panel-header">
          <h2>Admin section</h2>
          <button class="btn primary" id="startTranscriptBtn">${state.transcriptActive ? "Stop transcript" : "Start transcript"}</button>
        </div>
        <div class="notice ${state.transcriptActive ? "success" : ""}">
          ${transcriptStatusText()}
        </div>
        <div class="list">
          ${adminLines.length ? adminLines.map(transcriptLine).join("") : `<div class="card">No admin transcript entries yet.</div>`}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Candidate section</h2>
          <button class="btn" id="downloadTranscriptBtn">Download transcript</button>
        </div>
        <div class="list">
          ${candidateLines.length ? candidateLines.map(transcriptLine).join("") : `<div class="card">No candidate transcript entries yet.</div>`}
        </div>
      </section>
    </div>
  `;
}

function transcriptStatusText() {
  if (!state.transcriptActive) {
    return "Transcript capture is paused. Start it to save meeting chat messages and supported voice speech into transcripts.";
  }
  if (state.transcriptSpeechListening) {
    return "Transcript capture is active. Chat messages and your microphone speech are being added here.";
  }
  return state.transcriptSpeechMessage || "Transcript capture is active. Chat messages will be added here.";
}

function visibleTranscriptLines(section) {
  return transcriptLines.filter(line => {
    return line.section === section && !isTranscriptStatusLine(line);
  });
}

function isTranscriptStatusLine(line) {
  const text = String(line.text || "").toLowerCase();
  return text.includes("transcript capture is now active") || text.includes("transcript capture is paused");
}

function renderCandidates() {
  if (state.user.role !== "Admin") {
    return `<section class="panel"><h2>Admin access required</h2></section>`;
  }

  return `
    <div class="grid cols-2">
      <section class="panel">
        <div class="panel-header">
          <h2>Add candidate</h2>
          <span class="pill ok">WhatsApp ready</span>
        </div>
        <div class="grid">
          <div class="field"><label>Name</label><input id="candidateName" placeholder="Candidate name" /></div>
          <div class="field"><label>Email</label><input id="candidateEmail" placeholder="candidate@gmail.com" /></div>
          <div class="field"><label>WhatsApp number</label><input id="candidatePhone" placeholder="9876543210" /></div>
          <div class="grid cols-2">
            <div class="field">
              <label>Program</label>
              <select id="candidateProgram">
                <option>Internship</option>
                <option>Training</option>
                <option>Hiring</option>
              </select>
            </div>
            <div class="field">
              <label>Status</label>
              <select id="candidateStatus">
                <option>Consent pending</option>
                <option>Shortlisted</option>
                <option>Interview pending</option>
                <option>Selected</option>
                <option>Rejected</option>
                <option>Active</option>
              </select>
            </div>
          </div>
          <button class="btn primary" id="addCandidateBtn">Add candidate</button>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Candidate list</h2>
          <span class="pill">${candidates.length} candidates</span>
        </div>
        <div class="list">
          ${candidates.map(candidate => `
            <div class="person-row">
              <div class="person-meta">
                <div class="name">${candidate.name}</div>
                <div class="muted">${candidate.email} | ${candidate.phone} | ${candidate.program}</div>
                <div class="muted">Consent: ${candidate.consentStatus || candidate.status || "Pending"}</div>
              </div>
              <div class="candidate-actions">
                <span class="pill ${candidateStatusClass(candidate)}">${candidate.status}</span>
                ${candidate.invitationToken ? `<button class="btn ghost compact-btn" data-copy-invite="${candidate.email}">Copy invite</button>` : ""}
              </div>
            </div>
          `).join("") || `<div class="card">No candidates added yet.</div>`}
        </div>
      </section>
    </div>
  `;
}

function candidateStatusClass(candidate) {
  const status = candidate.consentStatus || candidate.status || "";
  if (status === "Accepted" || status === "Selected" || status === "Active") {
    return "ok";
  }
  if (status === "Declined" || status === "Rejected") {
    return "danger";
  }
  return "warn";
}

function getCandidateInvitationLink(candidate) {
  if (!candidate?.invitationToken) {
    return "";
  }
  return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(candidate.invitationToken)}`;
}

async function copyCandidateInvitation(email) {
  const candidate = candidates.find(item => String(item.email || "").trim().toLowerCase() === String(email || "").trim().toLowerCase());
  const inviteLink = getCandidateInvitationLink(candidate);
  if (!candidate || !inviteLink) {
    alert("Invitation link is not available for this candidate.");
    return;
  }
  try {
    await navigator.clipboard.writeText(inviteLink);
    alert("Candidate invitation link copied.");
  } catch (error) {
    alert(`Invitation link: ${inviteLink}`);
  }
}

function renderWhatsApp() {
  if (state.user.role !== "Admin") {
    return `<section class="panel"><h2>Admin access required</h2></section>`;
  }

  const latest = whatsappCampaigns[0];
  const isScheduled = state.whatsappSendMode === "Scheduled";
  return `
    <div class="grid">
      <section class="home-hero">
        <div>
          <div class="login-kicker">Candidate communication</div>
          <h1>Send WhatsApp updates to shortlisted candidates.</h1>
          <p>Choose saved candidates, upload a CSV, or enter recipients manually.</p>
        </div>
        <div class="actions">
          <span class="pill ok">Candidates only</span>
        </div>
      </section>
      <div class="grid cols-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Create recipients</h2>
            <span class="pill">${latest ? whatsappCampaigns.length : 0} campaigns</span>
          </div>
          <div class="field">
            <label>Saved candidates</label>
            <select id="whatsappCandidateStatus">
              <option value="eligible">Eligible candidates</option>
              <option value="Accepted">Accepted only</option>
              <option value="Pending">Consent pending</option>
              <option value="Shortlisted">Shortlisted only</option>
              <option value="Interview pending">Interview pending</option>
              <option value="Selected">Selected</option>
              <option value="Active">Active</option>
              <option value="all">All except declined</option>
            </select>
          </div>
          <div class="saved-candidate-picker">
            ${renderWhatsappCandidatePicker()}
          </div>
          <div class="actions" style="margin-top: 12px;">
            <button class="btn" id="addSelectedCandidatesBtn">Add selected candidates</button>
          </div>
          <div class="field">
            <label>Upload CSV</label>
            <input id="whatsappCsv" type="file" accept=".csv,text/csv" />
            <div class="muted">CSV columns can be name, phone. Example: Charitha, 919876543210</div>
          </div>
          <div class="field" style="margin-top: 14px;">
            <label>Manual candidate list</label>
            <textarea id="whatsappManualRecipients" placeholder="One candidate per line&#10;Charitha, 919876543210&#10;Aarav Mehta, 919812345678">${state.whatsappDraftManual}</textarea>
          </div>
          <div class="actions" style="margin-top: 12px;">
            <button class="btn" id="previewWhatsappRecipientsBtn">Preview recipients</button>
            <button class="btn" id="clearWhatsappRecipientsBtn">Clear preview</button>
          </div>
          <div id="whatsappPreview" class="recipient-preview">${renderWhatsappPreviewMarkup()}</div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2>Message details</h2>
          </div>
          <div class="field">
            <label>Attach meeting link</label>
            <select id="whatsappMeetingCode">
              <option value="">No meeting selected</option>
              ${meetings.filter(meeting => meeting.code).map(meeting => `
                <option value="${meeting.code}" ${state.whatsappMeetingCode === meeting.code ? "selected" : ""}>${meeting.title} | ${meeting.code}</option>
              `).join("")}
            </select>
            ${state.whatsappMeetingCode ? `<div class="muted">${getMeetingJoinLink({ code: state.whatsappMeetingCode })}</div>` : ""}
          </div>
          <div class="field">
            <label>Message</label>
            <textarea id="whatsappMessage" placeholder="Type the WhatsApp message for shortlisted internship candidates">${state.whatsappDraftMessage}</textarea>
          </div>
          <div class="grid cols-2" style="margin-top: 14px;">
            <div class="field">
              <label>Send mode</label>
              <select id="whatsappSendMode">
                <option value="Immediate" ${state.whatsappSendMode === "Immediate" ? "selected" : ""}>Send immediately</option>
                <option value="Scheduled" ${isScheduled ? "selected" : ""}>Schedule for later</option>
              </select>
            </div>
            <div class="field ${isScheduled ? "" : "hidden-field"}" id="whatsappScheduleField">
              <label>Schedule time</label>
              <input id="whatsappScheduledAt" type="datetime-local" value="${state.whatsappDraftScheduledAt}" />
            </div>
          </div>
          <div class="actions" style="margin-top: 14px;">
            <button class="btn primary" id="saveWhatsappCampaignBtn">${isScheduled ? "Schedule message" : "Send message"}</button>
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-header">
          <h2>WhatsApp campaign history</h2>
          <span class="pill">${whatsappCampaigns.length} saved</span>
        </div>
        <div class="list">
          ${whatsappCampaigns.map(campaign => `
            <div class="card campaign-card">
              <div>
                <strong>${campaign.sendMode}${campaign.scheduledAt ? ` | ${campaign.scheduledAt}` : ""}</strong>
                <div class="muted">${campaign.recipients.length} candidates | ${campaign.status} | ${campaign.createdAt}</div>
                <div class="campaign-message">${campaign.message}</div>
                ${renderWhatsappDeliveryResults(campaign)}
              </div>
              <span class="pill ${campaign.status && campaign.status.includes("Sent") ? "ok" : ""}">${campaign.status || campaign.sendMode}</span>
            </div>
          `).join("") || `<div class="card">No WhatsApp campaigns saved yet.</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderGuests() {
  return `
    <div class="grid cols-2">
      <section class="panel">
        <div class="panel-header">
          <h2>Add guest</h2>
          <span class="pill">Meeting assignment</span>
        </div>
        <div class="grid">
          <div class="field"><label>Name</label><input id="guestName" placeholder="Guest name" /></div>
          <div class="field"><label>Email</label><input id="guestEmail" placeholder="guest@example.com" /></div>
          <div class="field"><label>Assigned meeting</label><select id="guestMeeting" class="input-field"><option value="">General access (No specific meeting)</option>${meetings.map(m => `<option value="${m.code}">${m.title} (${m.code})</option>`).join("")}</select></div>
          <button class="btn primary" id="addGuestBtn">Add guest</button>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Guest list</h2>
          <span class="pill">${guests.length} guests</span>
        </div>
        <div class="list" id="guestList">
          ${guests.length ? guests.map(guest => `
            <div class="person-row">
              <div class="person-meta">
                <div class="name">${guest.name}</div>
                <div class="muted">${guest.email} | ${guest.meeting}</div>
              </div>
              <span class="pill">${guest.status}</span>
            </div>
          `).join("") : `<div class="card">No guests added yet.</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderSettings() {
  if (state.user?.role !== "Admin") {
    return `
      <section class="panel">
        <div class="panel-header"><h2>Settings</h2></div>
        <div class="empty">Settings are available only to Admin.</div>
      </section>
    `;
  }

  return `
    <div class="grid">
      <div class="grid cols-2">
        <section class="panel">
          <div class="panel-header">
            <h2>Meeting controls</h2>
            <button class="btn primary" id="saveSettingsBtn">Save settings</button>
          </div>
          <div class="grid">
            <div class="field">
              <label>Company domain</label>
              <input value="SkillArionDevelopment.in" disabled />
            </div>
            <div class="field">
              <label>Meeting time limit</label>
              <input value="No fixed time limit" disabled />
            </div>
            <div class="field">
              <label>Target participant capacity</label>
              <input id="capacityLimit" type="number" min="1" max="1000" value="${state.settings.capacityLimit}" />
            </div>
            <div class="field"><label>Guest access method</label><input value="Admin-assigned meeting link" disabled /></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header"><h2>Reports and transcripts</h2></div>
          <div class="grid">
            <div class="field"><label>Transcript mode</label><input value="Manual start" disabled /></div>
            <div class="field">
              <label>Candidate transcript access</label>
              <select id="candidateTranscriptAccess">
                <option value="yes" ${state.settings.candidateTranscriptAccess ? "selected" : ""}>Allowed</option>
                <option value="no" ${!state.settings.candidateTranscriptAccess ? "selected" : ""}>Admin only</option>
              </select>
            </div>
            <div class="field"><label>Attendance export</label><input value="CSV" disabled /></div>
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-header">
          <h2>Data cleanup</h2>
          <span class="pill warn">Admin only</span>
        </div>
        <div class="actions">
          <button class="btn danger" data-clear-history="attendance">Clear attendance</button>
          <button class="btn danger" data-clear-history="meetings">Clear meetings</button>
          <button class="btn danger" data-clear-history="candidates">Clear candidates</button>
          <button class="btn danger" data-clear-history="transcripts">Clear transcripts</button>
          <button class="btn danger" data-clear-history="chat-messages">Clear meeting chat</button>
          <button class="btn danger" data-clear-history="whatsapp-campaigns">Clear WhatsApp history</button>
        </div>
        <div class="muted" style="margin-top: 10px;">These actions permanently remove the selected records. Guests are managed from the Guests page.</div>
      </section>
    </div>
  `;
}

function meetingRow(meeting) {
  return `
    <div class="meeting-row">
      <div class="meeting-meta">
        <div class="name">${meeting.title}</div>
        <div class="muted">${meeting.code || meeting.id} | ${meeting.host} | ${meeting.start}</div>
        <div class="muted">${meetingAccessLabel(meeting)}</div>
      </div>
      <div class="actions">
        ${meeting.code ? `<button class="btn" style="padding: 4px 8px; font-size: 12px;" onclick="navigator.clipboard.writeText(window.location.origin + '/?meet=' + '${meeting.code}').then(()=>alert('Link copied!'))">Copy Link</button>` : ""}
        <span class="pill ${meeting.status === "Live" ? "ok" : ""}">${meeting.status}</span>
        <span class="pill">${meeting.participants}</span>
      </div>
    </div>
  `;
}

function personRow(name, role) {
  return `
    <div class="person-row">
      <div class="person-meta">
        <div class="name">${name}</div>
        <div class="muted">${role}</div>
      </div>
      <span class="pill ok">Present</span>
    </div>
  `;
}

function transcriptLine(line) {
  return `
    <div class="transcript-line">
      <div><strong>${line.speaker}</strong> <span class="muted">${line.time}</span></div>
      <div>${line.text}</div>
    </div>
  `;
}

function filteredAttendance() {
  let rows = attendanceRows;
  if (state.user?.role === "Candidate") {
    rows = rows.filter(row => row.email.toLowerCase() === state.user.email.toLowerCase());
  }
  if (state.user?.role === "Guest") {
    rows = rows.filter(row => row.email.toLowerCase() === state.user.email.toLowerCase());
  }
  const fromTime = state.attendanceFilter.from ? new Date(`${state.attendanceFilter.from}T00:00:00`).getTime() : 0;
  const toTime = state.attendanceFilter.to ? new Date(`${state.attendanceFilter.to}T23:59:59`).getTime() : Infinity;
  return rows
    .filter(row => state.attendanceFilter.role === "all" || row.role === state.attendanceFilter.role)
    .filter(row => {
      const rowTime = getAttendanceRowTime(row);
      return !rowTime || (rowTime >= fromTime && rowTime <= toTime);
    })
    .sort((a, b) => {
      const bTime = new Date(b.leftAt || b.joinedAt || 0).getTime();
      const aTime = new Date(a.leftAt || a.joinedAt || 0).getTime();
      return bTime - aTime;
    });
}

function getAttendanceRowTime(row) {
  const timestamp = row.leftAt || row.joinedAt;
  if (timestamp) {
    const parsed = new Date(timestamp).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function visibleNavItems() {
  const allowedRoutes = roleRoutes[state.user.role] || roleRoutes.Guest;
  if (!allowedRoutes.includes(state.route)) {
    state.route = "dashboard";
  }
  return navItems.filter(([route]) => allowedRoutes.includes(route));
}

async function loadBootstrapData() {
  try {
    const data = await apiRequest("/api/bootstrap");
    meetings = data.meetings || meetings;
    guests = data.guests || guests;
    candidates = data.candidates || candidates;
    attendanceRows = data.attendance || attendanceRows;
    transcriptLines = data.transcripts || transcriptLines;
    chatMessages = data.chatMessages || chatMessages;
    whatsappCampaigns = data.whatsappCampaigns || whatsappCampaigns;
    state.settings = { ...state.settings, ...(data.settings || {}) };
    state.backendOnline = true;
  } catch (error) {
    state.backendOnline = false;
  }
}

async function loadInvitationDetails() {
  if (!state.pendingInviteToken || state.inviteRecord) {
    return;
  }
  try {
    state.inviteRecord = await apiRequest(`/api/candidate-invitations/${encodeURIComponent(state.pendingInviteToken)}`);
    state.inviteMessage = "Please accept or decline this invitation.";
    state.backendOnline = true;
  } catch (error) {
    state.inviteMessage = error.message || "Invitation link was not found.";
    state.backendOnline = false;
  }
}

async function respondToInvitation(decision) {
  try {
    const updated = await apiRequest(`/api/candidate-invitations/${encodeURIComponent(state.pendingInviteToken)}`, {
      method: "PUT",
      body: JSON.stringify({ decision }),
    });
    state.inviteRecord = updated;
    state.inviteMessage = decision === "accepted"
      ? "Invitation accepted. You can now continue to candidate login."
      : "Invitation declined. Admin will see your declined status.";
    state.backendOnline = true;
    render();
  } catch (error) {
    alert(error.message || "Could not update invitation.");
    state.backendOnline = false;
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

function bindLogin() {
  let selectedRole = state.pendingJoinCode ? "Candidate" : "Admin";
  const email = document.querySelector("#email");
  const name = document.querySelector("#name");
  const password = document.querySelector("#password");
  const passwordField = document.querySelector("#passwordField");
  const loginBtn = document.querySelector("#loginBtn");
  const googleLoginBox = document.querySelector("#googleLoginBox");
  const googleLoginStatus = document.querySelector("#googleLoginStatus");

  function updateLoginMode() {
    const isCandidate = selectedRole === "Candidate";
    googleLoginBox.hidden = !isCandidate;
    email.closest(".field").hidden = isCandidate;
    name.closest(".field").hidden = isCandidate;
    passwordField.hidden = selectedRole !== "Admin";
    loginBtn.hidden = isCandidate;
    loginBtn.textContent = "Continue";

    if (isCandidate) {
      renderGoogleSignIn();
    }
  }

  document.querySelectorAll(".role-card").forEach(card => {
    card.addEventListener("click", () => {
      selectedRole = card.dataset.role;
      document.querySelectorAll(".role-card").forEach(item => item.classList.remove("active"));
      card.classList.add("active");
      const defaults = {
        Admin: ["admin@SkillArionDevelopment.in", "Company Admin"],
        Candidate: ["candidate@gmail.com", "Candidate User"],
        Guest: ["guest@example.com", "Guest User"],
      };
      email.value = defaults[selectedRole][0];
      name.value = defaults[selectedRole][1];
      updateLoginMode();
    });
  });

  loginBtn.addEventListener("click", async () => {
    if (selectedRole === "Admin") {
      try {
        const authentication = await apiRequest("/api/auth/admin", {
          method: "POST",
          body: JSON.stringify({
            name: name.value.trim() || "Company Admin",
            email: email.value.trim(),
            password: password.value,
          }),
        });
        state.authToken = authentication.token;
        state.user = withoutAuthToken(authentication);
        state.backendOnline = true;
      } catch (error) {
        state.backendOnline = false;
        alert(error.message);
        return;
      }
    } else if (selectedRole === "Guest") {
      try {
        const authentication = await apiRequest("/api/auth/guest", {
          method: "POST",
          body: JSON.stringify({
            name: name.value.trim() || "Guest User",
            email: email.value.trim(),
          }),
        });
        state.authToken = authentication.token;
        state.user = withoutAuthToken(authentication);
        state.backendOnline = true;
      } catch (error) {
        state.backendOnline = false;
        alert(error.message);
        return;
      }
    } else {
      state.user = {
        name: name.value.trim() || "Company User",
        email: email.value.trim() || "candidate@gmail.com",
        role: selectedRole,
      };
    }
    await loadBootstrapData();
    if (state.pendingJoinCode) {
      await joinMeetingWithCode(state.pendingJoinCode);
      return;
    }
    render();
  });

  function renderGoogleSignIn() {
    const buttonHost = document.querySelector("#googleSignInButton");
    const clientId = config.googleClientId || "";
    const isConfigured = clientId && !clientId.includes("PASTE_GOOGLE_CLIENT_ID_HERE");

    buttonHost.innerHTML = "";

    if (!isConfigured) {
      buttonHost.innerHTML = `
        <button class="google-signin-placeholder" type="button" disabled>
          <span class="google-g">G</span>
          Continue with Google
        </button>
      `;
      googleLoginStatus.textContent = "Google sign-in is currently unavailable. Contact the administrator.";
      return;
    }

    if (!window.google?.accounts?.id) {
      buttonHost.innerHTML = `
        <button class="google-signin-placeholder" type="button" disabled>
          <span class="google-g">G</span>
          Continue with Google
        </button>
      `;
      googleLoginStatus.textContent = "Google sign-in is temporarily unavailable. Refresh the page and try again.";
      return;
    }

    googleLoginStatus.textContent = "Use your Google account. Password is entered only on Google, not inside this app.";
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredential,
    });
    window.google.accounts.id.renderButton(buttonHost, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      width: 320,
    });
  }

  updateLoginMode();
}

function bindInvitationPage() {
  if (!state.inviteRecord && !state.inviteMessage) {
    loadInvitationDetails().then(() => render());
  }
  document.querySelector("#acceptInviteLinkBtn")?.addEventListener("click", () => respondToInvitation("accepted"));
  document.querySelector("#declineInviteLinkBtn")?.addEventListener("click", () => respondToInvitation("declined"));
  document.querySelector("#continueAfterInviteBtn")?.addEventListener("click", () => {
    state.pendingInviteToken = "";
    state.inviteRecord = null;
    state.inviteMessage = "";
    window.history.replaceState({}, "", window.location.pathname);
    render();
  });
}

async function handleGoogleCredential(response) {
  try {
    const authentication = await apiRequest("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential }),
    });
    state.authToken = authentication.token;
    state.user = withoutAuthToken(authentication);
  } catch (error) {
    alert(error.message || "Google sign-in could not be verified.");
    return;
  }
  await loadBootstrapData();
  if (state.pendingJoinCode) {
    await joinMeetingWithCode(state.pendingJoinCode);
    return;
  }
  render();
}

function withoutAuthToken(authentication) {
  const { token, ...user } = authentication;
  return user;
}

async function navigateTo(route, options = {}) {
  state.route = route;
  state.leaveMessage = "";
  if (!options.skipHistory) {
    window.history.pushState({ route }, "", window.location.pathname);
  }
  if (state.route === "attendance" || state.route === "dashboard" || state.route === "meeting") {
    await loadBootstrapData();
  }
  render();
}

function bindShell() {
  document.querySelectorAll("[data-route]").forEach(button => {
    button.addEventListener("click", async () => {
      await navigateTo(button.dataset.route);
    });
  });

  document.querySelector("#backToHomeBtn")?.addEventListener("click", async () => {
    await navigateTo("dashboard");
  });

  document.querySelector("#logoutBtn")?.addEventListener("click", async () => {
    stopAllMedia();
    await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {});
    state.authToken = "";
    state.user = null;
    state.route = "dashboard";
    render();
  });

  document.querySelector("#micBtn")?.addEventListener("click", toggleMicrophone);

  document.querySelector("#cameraBtn")?.addEventListener("click", toggleCamera);
  document.querySelector("#switchCameraBtn")?.addEventListener("click", switchCamera);
  document.querySelector("#screenBtn")?.addEventListener("click", shareScreen);
  document.querySelector("#handBtn")?.addEventListener("click", () => {
    state.handRaised = !state.handRaised;
    if (socket && state.activeMeeting?.code) {
      socket.emit("hand-raise", state.handRaised);
    }
    render();
  });
  document.querySelector("#chatBtn")?.addEventListener("click", async () => {
    state.meetingPanel = state.meetingPanel === "chat" ? "" : "chat";
    if (state.meetingPanel === "chat") {
      await loadActiveMeetingChatMessages();
    }
    render();
  });
  document.querySelector("#peopleBtn")?.addEventListener("click", () => {
    state.meetingPanel = state.meetingPanel === "participants" ? "" : "participants";
    render();
  });
  document.querySelector("#markAttendanceBtn")?.addEventListener("click", () => {
    state.attendanceTracking = true;
    state.meetingPanel = state.meetingPanel === "attendance" ? "" : "attendance";
    render();
  });
  document.querySelector("#closeMeetingPanelBtn")?.addEventListener("click", () => {
    state.meetingPanel = "";
    render();
  });
  document.querySelector("#sendChatBtn")?.addEventListener("click", () => {
    const input = document.querySelector("#chatInput");
    if (input?.value.trim()) {
      sendChatMessage(input.value.trim());
    }
  });
  document.querySelector("#chatInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const input = event.currentTarget;
      if (input?.value.trim()) {
        sendChatMessage(input.value.trim());
      }
    }
  });
  document.querySelector("#endBtn")?.addEventListener("click", () => {
    endMeeting();
  });

  document.querySelector("#fromDate")?.addEventListener("change", event => {
    state.attendanceFilter.from = event.target.value;
    render();
  });
  document.querySelector("#toDate")?.addEventListener("change", event => {
    state.attendanceFilter.to = event.target.value;
    render();
  });
  document.querySelector("#roleFilter")?.addEventListener("change", event => {
    state.attendanceFilter.role = event.target.value;
    render();
  });
  document.querySelector("#exportCsvBtn")?.addEventListener("click", exportAttendanceCsv);
  document.querySelectorAll("[data-clear-history]").forEach(button => {
    button.addEventListener("click", () => clearHistory(button.dataset.clearHistory));
  });
  document.querySelector("#addCandidateBtn")?.addEventListener("click", addCandidate);
  document.querySelectorAll("[data-copy-invite]").forEach(button => {
    button.addEventListener("click", () => copyCandidateInvitation(button.dataset.copyInvite));
  });
  document.querySelector("#acceptCandidateInviteBtn")?.addEventListener("click", () => updateCandidateConsent("accepted"));
  document.querySelector("#declineCandidateInviteBtn")?.addEventListener("click", () => updateCandidateConsent("declined"));
  document.querySelector("#addGuestBtn")?.addEventListener("click", addGuest);
  document.querySelector("#createMeetingBtn")?.addEventListener("click", createMeeting);
  document.querySelector("#copyMeetingCodeBtn")?.addEventListener("click", copyMeetingCode);
  document.querySelector("#copyMeetingLinkBtn")?.addEventListener("click", copyMeetingLink);
  document.querySelector("#joinMeetingBtn")?.addEventListener("click", joinMeetingByCode);
  document.querySelector("#startTranscriptBtn")?.addEventListener("click", toggleTranscript);
  document.querySelector("#downloadTranscriptBtn")?.addEventListener("click", downloadTranscript);
  document.querySelector("#saveSettingsBtn")?.addEventListener("click", saveSettings);
  document.querySelector("#whatsappCsv")?.addEventListener("change", previewWhatsappCsv);
  document.querySelector("#whatsappCandidateStatus")?.addEventListener("change", event => {
    state.whatsappCandidateStatus = event.target.value;
    render();
  });
  document.querySelector("#addSelectedCandidatesBtn")?.addEventListener("click", addSelectedCandidatesToWhatsapp);
  document.querySelector("#whatsappSendMode")?.addEventListener("change", event => {
    captureWhatsappDraft();
    state.whatsappSendMode = event.target.value;
    render();
  });
  document.querySelector("#whatsappMeetingCode")?.addEventListener("change", event => {
    captureWhatsappDraft();
    state.whatsappMeetingCode = event.target.value;
    render();
  });
  document.querySelector("#previewWhatsappRecipientsBtn")?.addEventListener("click", previewWhatsappRecipients);
  document.querySelector("#clearWhatsappRecipientsBtn")?.addEventListener("click", clearWhatsappRecipients);
  document.querySelector("#saveWhatsappCampaignBtn")?.addEventListener("click", saveWhatsappCampaign);

  attachLocalVideo();
  attachScreenVideo();
  attachRemoteVideos();
}

function attachRemoteVideos() {
  Object.keys(remoteStreams).forEach(socketId => {
    const video = document.querySelector(`#remoteVideo-${socketId}`);
    if (video && video.srcObject !== remoteStreams[socketId]) {
      video.srcObject = remoteStreams[socketId];
    }
  });
}

function detectActiveSpeaker(stream, tileId) {
  if (!stream || stream.getAudioTracks().length === 0) return;
  
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const updateVolume = () => {
      if (!stream.active) return;
      
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for(let i=0; i<dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      
      let tile = null;
      if (tileId === "selfTile") {
         tile = document.getElementById("selfTile");
      } else {
         const videoEl = document.getElementById(tileId);
         if (videoEl) tile = videoEl.closest('.tile');
      }
      
      if (tile) {
        if (avg > 15) {
          tile.classList.add("active-speaker");
        } else {
          tile.classList.remove("active-speaker");
        }
      }
      requestAnimationFrame(updateVolume);
    };
    updateVolume();
  } catch(e) {
    console.error("Audio context for active speaker failed", e);
  }
}

async function toggleMicrophone() {
  if (state.micOn) {
    stopMicrophone();
    syncLocalTracksToPeers();
    const btn = document.getElementById("micBtn");
    if (btn) {
      btn.classList.add("danger");
      btn.innerHTML = controlIcon("micOff");
    }
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Microphone access is not available in this browser.");
    return;
  }
  try {
    state.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.micOn = true;
    detectActiveSpeaker(state.audioStream, "selfTile");
    syncLocalTracksToPeers();
    const btn = document.getElementById("micBtn");
    if (btn) {
      btn.classList.remove("danger");
      btn.innerHTML = controlIcon("mic");
    }
  } catch (error) {
    alert("Microphone permission was not available in this browser session.");
  }
}

function stopMicrophone() {
  state.audioStream?.getTracks().forEach(track => track.stop());
  state.audioStream = null;
  state.micOn = false;
}

async function toggleCamera() {
  if (state.cameraOn) {
    stopCamera();
    syncLocalTracksToPeers();
    const btn = document.getElementById("cameraBtn");
    if (btn) btn.classList.add("danger");
    attachLocalVideo();
    return;
  }
  try {
    const constraints = currentVideoDeviceId ? { video: { deviceId: { exact: currentVideoDeviceId } }, audio: false } : { video: true, audio: false };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.cameraOn = true;
    detectActiveSpeaker(state.stream, "selfTile");
    syncLocalTracksToPeers();
    
    if (!videoDevices.length) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (videoDevices.length > 0 && !currentVideoDeviceId) {
        const currentStreamTrack = state.stream.getVideoTracks()[0];
        const activeDevice = videoDevices.find(d => d.label === currentStreamTrack.label);
        currentVideoDeviceId = activeDevice ? activeDevice.deviceId : videoDevices[0].deviceId;
      }
    }
    
    const btn = document.getElementById("cameraBtn");
    if (btn) btn.classList.remove("danger");
    attachLocalVideo();
  } catch (error) {
    alert("Camera permission was not available in this browser session.");
  }
}

async function switchCamera() {
  if (videoDevices.length <= 1) return;
  const currentIndex = videoDevices.findIndex(d => d.deviceId === currentVideoDeviceId);
  const nextIndex = (currentIndex + 1) % videoDevices.length;
  currentVideoDeviceId = videoDevices[nextIndex].deviceId;
  
  if (state.cameraOn) {
    stopCamera();
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ 
        video: { deviceId: { exact: currentVideoDeviceId } }, 
        audio: false 
      });
      state.cameraOn = true;
      detectActiveSpeaker(state.stream, "selfTile");
      syncLocalTracksToPeers();
      render();
    } catch(e) {
      console.error(e);
      alert("Could not switch camera.");
    }
  }
}

function attachLocalVideo() {
  const video = document.querySelector("#localVideo");
  if (video && state.stream) {
    video.srcObject = state.stream;
  }
}

function attachScreenVideo() {
  const video = document.querySelector("#screenVideo");
  if (video && state.screenStream) {
    video.srcObject = state.screenStream;
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
  }
  state.stream = null;
  state.cameraOn = false;
}

async function shareScreen() {
  if (state.screenSharing) {
    stopScreenShare();
    syncLocalTracksToPeers();
    const btn = document.getElementById("screenBtn");
    if (btn) btn.classList.remove("active-blue");
    attachLocalVideo();
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    alert("Screen sharing is not available in this browser.");
    return;
  }
  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    state.screenSharing = true;
    state.screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      stopScreenShare();
      syncLocalTracksToPeers();
      const btn = document.getElementById("screenBtn");
      if (btn) btn.classList.remove("active-blue");
      attachLocalVideo();
    }, { once: true });
    syncLocalTracksToPeers();
    const btn = document.getElementById("screenBtn");
    if (btn) btn.classList.add("active-blue");
    attachLocalVideo();
  } catch (error) {
    alert("Screen sharing was cancelled or blocked.");
  }
}

function stopScreenShare() {
  state.screenStream?.getTracks().forEach(track => track.stop());
  state.screenStream = null;
  state.screenSharing = false;
}

function stopAllMedia() {
  stopMicrophone();
  stopCamera();
  stopScreenShare();
}

function exportAttendanceCsv() {
  const rows = filteredAttendance();
  const summary = buildAttendanceSummary(rows);
  const reportRows = [
    ["SkillArionMeet Attendance Report"],
    ["Generated at", new Date().toLocaleString()],
    ["Date from", state.attendanceFilter.from || "All"],
    ["Date to", state.attendanceFilter.to || "All"],
    ["Role filter", state.attendanceFilter.role === "all" ? "All roles" : state.attendanceFilter.role],
    [],
    ["Summary"],
    ["Total joins", summary.total],
    ["Completed attendance", summary.completed],
    ["Live records", summary.live],
    ["Average attended", `${summary.averagePercent}%`],
    [],
    ["Meeting-wise summary"],
    ["Meeting", "Total joined", "Completed", "Live", "Average attended"],
    ...summary.meetings.map(item => [item.meeting, item.total, item.completed, item.live, `${item.averagePercent}%`]),
    [],
    ["Detailed attendance"],
    ["Name", "Email", "Role", "Meeting", "Joined", "Left", "Duration", "Attendance %"],
    ...rows.map(row => [row.name, row.email, row.role, row.meeting, row.joined, row.left, row.duration, `${row.percent}%`]),
  ];
  const csv = reportRows.map(csvLine).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-report-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvLine(values) {
  return values.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",");
}

async function createMeeting() {
  const title = document.querySelector("#newMeetingTitle")?.value.trim();
  const customCode = document.querySelector("#newMeetingCode")?.value.trim();
  const startValue = document.querySelector("#newMeetingStart")?.value;
  const accessMode = document.querySelector("#newMeetingAccessMode")?.value || "all";
  const allowedEmails = parseEmailList(document.querySelector("#newMeetingAllowedEmails")?.value || "");
  if (!title) {
    alert("Meeting title is required.");
    return;
  }
  if (accessMode === "invited" && !allowedEmails.length) {
    alert("Add at least one invited email for this access mode.");
    return;
  }

  try {
    const meeting = await apiRequest("/api/meetings", {
      method: "POST",
      body: JSON.stringify({
        title,
        code: customCode,
        host: state.user.name,
        start: startValue ? new Date(startValue).toLocaleString() : new Date().toLocaleString(),
        status: "Live",
        accessMode,
        allowedEmails,
      }),
    });
    meetings.unshift(meeting);
    state.lastCreatedMeeting = meeting;
    state.activeMeeting = meeting;
    state.backendOnline = true;
    render();
  } catch (error) {
    alert(`Meeting could not be created: ${error.message}`);
  }
}

async function copyMeetingCode() {
  if (!state.lastCreatedMeeting?.code) {
    return;
  }
  try {
    await navigator.clipboard.writeText(state.lastCreatedMeeting.code);
    alert("Meeting code copied.");
  } catch (error) {
    alert(`Meeting code: ${state.lastCreatedMeeting.code}`);
  }
}

async function copyMeetingLink() {
  if (!state.lastCreatedMeeting?.code) {
    return;
  }
  const link = getMeetingJoinLink(state.lastCreatedMeeting);
  try {
    await navigator.clipboard.writeText(link);
    alert("Meeting link copied.");
  } catch (error) {
    alert(`Meeting link: ${link}`);
  }
}

function getMeetingJoinLink(meeting) {
  return `${window.location.origin}${window.location.pathname}?meet=${encodeURIComponent(meeting.code)}`;
}

async function joinMeetingByCode() {
  const input = document.querySelector("#joinMeetingCode");
  const code = extractMeetingCode(input?.value.trim());
  await joinMeetingWithCode(code);
}

async function joinMeetingWithCode(codeValue) {
  const code = extractMeetingCode(codeValue);
  if (!code) {
    state.joinMessage = "Enter a meeting code first.";
    render();
    return;
  }

  try {
    const result = await apiRequest("/api/meetings/join", {
      method: "POST",
      body: JSON.stringify({
        code,
        name: state.user.name,
        email: state.user.email,
        role: state.user.role,
      }),
    });
    state.activeMeeting = result.meeting;
    state.activeAttendance = result.attendance;
    state.pendingJoinCode = "";
    state.joinMessage = "";
    window.history.replaceState({}, "", window.location.pathname);
    attendanceRows.unshift(result.attendance);
    meetings = meetings.map(meeting => meeting.id === result.meeting.id ? result.meeting : meeting);
    state.route = "meeting";
    state.backendOnline = true;

    if (!socket) {
      socket = io();
      socket.on("chat-message", (message) => {
        if (!chatMessages.find(m => m.id === message.id)) {
          chatMessages.push(message);
          if (state.meetingPanel === "chat") {
            render();
          }
        }
      });
      
      socket.on("user-connected", async (userPayload, socketId) => {
        remoteUsers[socketId] = userPayload;
        const pc = createPeerConnection(socketId, userPayload);
        
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.addTransceiver('video', { direction: 'recvonly' });

        const streamToShare = state.screenSharing ? state.screenStream : new MediaStream();
        if (!state.screenSharing) {
           if (state.stream) state.stream.getTracks().forEach(t => streamToShare.addTrack(t));
           if (state.audioStream) state.audioStream.getTracks().forEach(t => streamToShare.addTrack(t));
        }
        streamToShare.getTracks().forEach(track => pc.addTrack(track, streamToShare));
        render();
      });

      socket.on("hand-raise", (socketId, isRaised) => {
        if (remoteUsers[socketId]) {
          remoteUsers[socketId].handRaised = isRaised;
          render();
        }
      });

      socket.on("webrtc-offer", async (socketId, offer, userPayload) => {
        let pc = peerConnections[socketId];
        if (!pc) {
          remoteUsers[socketId] = userPayload;
          pc = createPeerConnection(socketId, userPayload);
          
          const streamToShare = state.screenSharing ? state.screenStream : new MediaStream();
          if (!state.screenSharing) {
             if (state.stream) state.stream.getTracks().forEach(t => streamToShare.addTrack(t));
             if (state.audioStream) state.audioStream.getTracks().forEach(t => streamToShare.addTrack(t));
          }
          streamToShare.getTracks().forEach(track => pc.addTrack(track, streamToShare));
        }
        
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc-answer", socketId, answer);
      });

      socket.on("webrtc-answer", async (socketId, answer) => {
        const pc = peerConnections[socketId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      socket.on("webrtc-ice-candidate", async (socketId, candidate) => {
        const pc = peerConnections[socketId];
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      socket.on("user-disconnected", (userPayload, socketId) => {
        if (peerConnections[socketId]) {
          peerConnections[socketId].close();
          delete peerConnections[socketId];
        }
        delete remoteStreams[socketId];
        delete remoteUsers[socketId];
        render();
      });
    }
    socket.emit("join-room", code, { email: state.user.email, name: state.user.name, role: state.user.role });

    await loadActiveMeetingChatMessages();
    render();
  } catch (error) {
    state.joinMessage = error.message || "Meeting code was not found. Please check the code and try again.";
    render();
  }
}

function parseEmailList(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function meetingAccessLabel(meeting) {
  const labels = {
    all: "Access: candidates and guests",
    candidates: "Access: candidates only",
    guests: "Access: guests only",
    invited: `Access: invited emails only${meeting.allowedEmails?.length ? ` (${meeting.allowedEmails.length})` : ""}`,
  };
  return labels[meeting.accessMode || "all"] || labels.all;
}

function extractMeetingCode(value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    return url.searchParams.get("meet") || value;
  } catch (error) {
    const match = value.toUpperCase().match(/SKM-[A-Z0-9-]+/);
    return match ? match[0] : value;
  }
}

async function endMeeting() {
  stopAllMedia();
  if (state.transcriptActive) {
    state.transcriptActive = false;
    stopSpeechTranscript();
  }

  if (state.activeMeeting?.code) {
    try {
      const result = await apiRequest(`/api/meetings/${encodeURIComponent(state.activeMeeting.code)}/leave`, {
        method: "POST",
        body: JSON.stringify({
          attendanceId: state.activeAttendance?.id || "",
          email: state.user.email,
        }),
      });
      const replaced = attendanceRows.some(row => row.id === result.attendance.id);
      attendanceRows = replaced
        ? attendanceRows.map(row => row.id === result.attendance.id ? result.attendance : row)
        : [result.attendance, ...attendanceRows];
      state.backendOnline = true;
      state.leaveMessage = `You left ${result.meeting.title}. Attendance saved.`;
    } catch (error) {
      state.backendOnline = false;
      state.leaveMessage = "You left the meeting, but attendance leave time could not be saved.";
    }
  } else {
    state.leaveMessage = state.user.role === "Admin" ? "" : "You left the meeting. No attendance was saved because this room was not joined through a meeting code or link.";
  }

  state.activeMeeting = null;
  state.activeAttendance = null;
  state.route = "dashboard";
  
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
  remoteStreams = {};
  remoteUsers = {};

  await loadBootstrapData();
  if (state.user.role !== "Admin" && state.leaveMessage) {
    alert(state.leaveMessage);
  }
  render();
}

async function sendChatMessage(text) {
  const createdAt = new Date().toISOString();
  const message = {
    id: `CHAT-${Date.now()}`,
    meetingCode: state.activeMeeting?.code || "",
    meetingTitle: state.activeMeeting?.title || "",
    sender: state.user.name,
    email: state.user.email,
    role: state.user.role,
    text,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    createdAt,
  };
  chatMessages.push(message);
  if (message.meetingCode) {
    apiRequest("/api/chat-messages", {
      method: "POST",
      body: JSON.stringify(message),
    }).then(saved => {
      chatMessages = chatMessages.map(item => item.id === message.id ? saved : item);
      state.backendOnline = true;
    }).catch(() => {
      state.backendOnline = false;
    });
  }

  if (socket && state.activeMeeting?.code) {
    socket.emit("chat-message", message);
  }

  if (state.transcriptActive) {
    saveTranscriptLine({
      time: message.time,
      speaker: message.sender,
      section: state.user.role === "Admin" ? "Admin" : "Candidate",
      text,
    });
  }

  state.meetingPanel = "chat";
  render();
}

function saveTranscriptLine(line) {
  const transcript = {
    time: line.time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    speaker: line.speaker || state.user?.name || "Meeting user",
    section: line.section || (state.user?.role === "Admin" ? "Admin" : "Candidate"),
    text: String(line.text || "").trim(),
  };
  if (!transcript.text) {
    return;
  }
  transcriptLines.unshift(transcript);
  apiRequest("/api/transcripts", {
    method: "POST",
    body: JSON.stringify(transcript),
  }).catch(() => {
    state.backendOnline = false;
  });
}

function toggleTranscript() {
  state.transcriptActive = !state.transcriptActive;
  if (state.transcriptActive) {
    startSpeechTranscript();
  } else {
    stopSpeechTranscript();
  }
  render();
}

function startSpeechTranscript() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    state.transcriptSpeechListening = false;
    state.transcriptSpeechMessage = "Transcript capture is active for chat messages. Voice speech-to-text is not supported in this browser.";
    return;
  }

  stopSpeechTranscript();
  transcriptRecognition = new SpeechRecognition();
  transcriptRecognition.continuous = true;
  transcriptRecognition.interimResults = false;
  transcriptRecognition.lang = "en-IN";

  transcriptRecognition.onstart = () => {
    state.transcriptSpeechListening = true;
    state.transcriptSpeechMessage = "Voice transcript is listening through this browser microphone.";
    render();
  };

  transcriptRecognition.onresult = event => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result.isFinal) {
        continue;
      }
      const text = result[0]?.transcript?.trim();
      if (text) {
        saveTranscriptLine({
          speaker: state.user?.name || "Meeting user",
          section: state.user?.role === "Admin" ? "Admin" : "Candidate",
          text,
        });
      }
    }
    render();
  };

  transcriptRecognition.onerror = event => {
    state.transcriptSpeechListening = false;
    state.transcriptSpeechMessage = event.error === "not-allowed"
      ? "Microphone permission was blocked. Chat messages will still be saved into transcripts."
      : "Voice transcript paused by the browser. Chat messages will still be saved.";
    render();
  };

  transcriptRecognition.onend = () => {
    state.transcriptSpeechListening = false;
    if (state.transcriptActive) {
      try {
        transcriptRecognition.start();
      } catch (error) {
        state.transcriptSpeechMessage = "Voice transcript paused. Chat messages will still be saved.";
        render();
      }
    } else {
      render();
    }
  };

  try {
    transcriptRecognition.start();
  } catch (error) {
    state.transcriptSpeechListening = false;
    state.transcriptSpeechMessage = "Voice transcript could not start. Chat messages will still be saved.";
  }
}

function stopSpeechTranscript() {
  if (transcriptRecognition) {
    const recognition = transcriptRecognition;
    transcriptRecognition = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch (error) {
      // Browser may already have stopped listening.
    }
  }
  state.transcriptSpeechListening = false;
  if (!state.transcriptActive) {
    state.transcriptSpeechMessage = "";
  }
}

function downloadTranscript() {
  const allowedSection = state.user?.role === "Admin" ? null : "Candidate";
  const lines = transcriptLines
    .filter(line => (!allowedSection || line.section === allowedSection) && !isTranscriptStatusLine(line))
    .map(line => `[${line.time}] ${line.speaker}: ${line.text}`)
    .join("\n");
  const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = state.user?.role === "Admin" ? "meeting-transcript.txt" : "my-transcript.txt";
  link.click();
  URL.revokeObjectURL(url);
}

function previewWhatsappCsv(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    whatsappDraftRecipients = mergeRecipients(whatsappDraftRecipients, parseWhatsappRecipients(reader.result));
    updateWhatsappPreview();
  };
  reader.readAsText(file);
}

function renderWhatsappCandidatePicker() {
  const filtered = candidates.filter(candidate => {
    return candidateMatchesWhatsappFilter(candidate);
  });
  if (!filtered.length) {
    return `<div class="muted">No saved candidates match this status.</div>`;
  }
  return filtered.map(candidate => `
    <label class="candidate-check">
      <input type="checkbox" class="whatsappCandidateCheck" value="${candidate.email}" />
      <span>
        <strong>${candidate.name}</strong>
        <small>${candidate.phone} | ${candidate.status} | Consent: ${candidate.consentStatus || "Pending"}</small>
      </span>
    </label>
  `).join("");
}

function candidateMatchesWhatsappFilter(candidate) {
  const consent = candidate.consentStatus || (candidate.status === "Consent pending" ? "Pending" : candidate.status);
  if (consent === "Declined" || candidate.status === "Rejected") {
    return false;
  }
  if (state.whatsappCandidateStatus === "eligible" || state.whatsappCandidateStatus === "all") {
    return true;
  }
  if (state.whatsappCandidateStatus === "Pending") {
    return consent === "Pending" || candidate.status === "Consent pending";
  }
  if (state.whatsappCandidateStatus === "Accepted") {
    return consent === "Accepted";
  }
  return candidate.status === state.whatsappCandidateStatus || consent === state.whatsappCandidateStatus;
}

function addSelectedCandidatesToWhatsapp() {
  const selectedEmails = Array.from(document.querySelectorAll(".whatsappCandidateCheck:checked"))
    .map(input => input.value.toLowerCase());
  if (!selectedEmails.length) {
    alert("Select at least one saved candidate.");
    return;
  }
  const selected = candidates
    .filter(candidate => selectedEmails.includes(String(candidate.email || "").toLowerCase()))
    .map(candidate => ({ name: candidate.name, phone: normalizePhone(candidate.phone) }));
  whatsappDraftRecipients = mergeRecipients(whatsappDraftRecipients, selected);
  updateWhatsappPreview();
}

function previewWhatsappRecipients() {
  captureWhatsappDraft();
  const manual = document.querySelector("#whatsappManualRecipients")?.value || "";
  whatsappDraftRecipients = mergeRecipients(whatsappDraftRecipients, parseWhatsappRecipients(manual));
  updateWhatsappPreview();
}

function clearWhatsappRecipients() {
  whatsappDraftRecipients = [];
  state.whatsappDraftManual = "";
  const manual = document.querySelector("#whatsappManualRecipients");
  const csv = document.querySelector("#whatsappCsv");
  if (manual) {
    manual.value = "";
  }
  if (csv) {
    csv.value = "";
  }
  updateWhatsappPreview();
}

function captureWhatsappDraft() {
  const manual = document.querySelector("#whatsappManualRecipients");
  const message = document.querySelector("#whatsappMessage");
  const scheduledAt = document.querySelector("#whatsappScheduledAt");
  const meetingCode = document.querySelector("#whatsappMeetingCode");
  if (manual) {
    state.whatsappDraftManual = manual.value;
  }
  if (message) {
    state.whatsappDraftMessage = message.value;
  }
  if (scheduledAt) {
    state.whatsappDraftScheduledAt = scheduledAt.value;
  }
  if (meetingCode) {
    state.whatsappMeetingCode = meetingCode.value;
  }
}

function updateWhatsappPreview() {
  const preview = document.querySelector("#whatsappPreview");
  if (!preview) {
    return;
  }
  preview.innerHTML = renderWhatsappPreviewMarkup();
}

function renderWhatsappPreviewMarkup() {
  if (!whatsappDraftRecipients.length) {
    return `<div class="muted">No candidate numbers previewed yet.</div>`;
  }
  return `
    <div class="panel-header compact">
      <strong>${whatsappDraftRecipients.length} candidates ready</strong>
      <span class="pill ok">Preview</span>
    </div>
    <div class="list">
      ${whatsappDraftRecipients.slice(0, 8).map(person => `
        <div class="recipient-row">
          <strong>${person.name}</strong>
          <span>${person.phone}</span>
        </div>
      `).join("")}
      ${whatsappDraftRecipients.length > 8 ? `<div class="muted">+${whatsappDraftRecipients.length - 8} more candidates</div>` : ""}
    </div>
  `;
}

function renderWhatsappDeliveryResults(campaign) {
  if (!Array.isArray(campaign.deliveryResults) || !campaign.deliveryResults.length) {
    return "";
  }
  const sent = campaign.deliveryResults.filter(result => result.status === "Sent").length;
  const failed = campaign.deliveryResults.filter(result => result.status === "Failed").length;
  const pending = campaign.deliveryResults.length - sent - failed;
  const firstFailure = campaign.deliveryResults.find(result => result.status === "Failed" && result.detail);
  return `
    <div class="muted" style="margin-top: 8px;">
      Delivery: ${sent} sent${failed ? `, ${failed} failed` : ""}${pending ? `, ${pending} pending` : ""}
    </div>
    ${firstFailure ? `<div class="muted">Reason: ${firstFailure.detail}</div>` : ""}
  `;
}

function parseWhatsappRecipients(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return lines
    .map(line => {
      const columns = line.split(",").map(part => part.trim()).filter(Boolean);
      if (columns.length < 2 || columns[0].toLowerCase() === "name") {
        return null;
      }
      return {
        name: columns[0],
        phone: normalizePhone(columns[1]),
      };
    })
    .filter(person => person?.name && person.phone);
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return digits.startsWith("91") ? digits : `91${digits}`;
}

function mergeRecipients(existing, next) {
  const byPhone = new Map();
  [...existing, ...next].forEach(person => {
    if (person.phone) {
      byPhone.set(person.phone, person);
    }
  });
  return Array.from(byPhone.values());
}

async function saveWhatsappCampaign() {
  captureWhatsappDraft();
  previewWhatsappRecipients();
  const message = state.whatsappDraftMessage.trim();
  const sendMode = state.whatsappSendMode;
  const scheduleValue = state.whatsappDraftScheduledAt;
  const meetingCode = state.whatsappMeetingCode;

  if (!whatsappDraftRecipients.length) {
    alert("Add candidate names and WhatsApp numbers first.");
    return;
  }
  if (!message) {
    alert("Message is required.");
    return;
  }
  if (sendMode === "Scheduled" && !scheduleValue) {
    alert("Select schedule date and time.");
    return;
  }

  const campaign = {
    message,
    recipients: whatsappDraftRecipients,
    meetingCode,
    sendMode,
    scheduledAt: scheduleValue ? new Date(scheduleValue).toISOString() : "",
    status: sendMode === "Scheduled" ? "Scheduled" : "Sending",
    createdAt: new Date().toLocaleString(),
  };

  try {
    const saved = await apiRequest("/api/whatsapp-campaigns", {
      method: "POST",
      body: JSON.stringify(campaign),
    });
    whatsappCampaigns.unshift(saved);
    state.backendOnline = true;
    campaign.status = saved.status || campaign.status;
    campaign.deliveryResults = saved.deliveryResults || [];
  } catch (error) {
    state.backendOnline = false;
    alert(error.message || "The WhatsApp message could not be sent. Please try again.");
    return;
  }

  whatsappDraftRecipients = [];
  state.whatsappDraftManual = "";
  state.whatsappDraftMessage = "";
  state.whatsappDraftScheduledAt = "";
  state.whatsappMeetingCode = "";
  state.whatsappSendMode = "Immediate";
  const failedDelivery = campaign.deliveryResults?.find(result => result.status === "Failed" && result.detail);
  const immediateStatus = failedDelivery ? `${campaign.status}: ${failedDelivery.detail}` : campaign.status;
  alert(sendMode === "Scheduled" ? "Message scheduled." : immediateStatus);
  render();
}

async function addGuest() {
  const name = document.querySelector("#guestName").value.trim();
  const email = document.querySelector("#guestEmail").value.trim();
  const meeting = document.querySelector("#guestMeeting").value.trim();
  if (!name || !email) {
    alert("Guest name and email are required.");
    return;
  }
  const guest = { name, email, meeting: meeting || "General access", status: "Invited" };
  guests.unshift(guest);
  apiRequest("/api/guests", {
    method: "POST",
    body: JSON.stringify(guest),
  }).catch(() => {
    state.backendOnline = false;
  });
  render();
}

async function addCandidate() {
  const name = document.querySelector("#candidateName")?.value.trim();
  const email = document.querySelector("#candidateEmail")?.value.trim();
  const phone = normalizePhone(document.querySelector("#candidatePhone")?.value);
  const program = document.querySelector("#candidateProgram")?.value || "Internship";
  const status = document.querySelector("#candidateStatus")?.value || "Consent pending";

  if (!name || !email || !phone) {
    alert("Candidate name, email, and WhatsApp number are required.");
    return;
  }

  const candidate = { name, email, phone, program, status, consentStatus: status === "Consent pending" ? "Pending" : status };
  try {
    const saved = await apiRequest("/api/candidates", {
      method: "POST",
      body: JSON.stringify(candidate),
    });
    candidates.unshift(saved);
    state.backendOnline = true;
  } catch (error) {
    candidates.unshift(candidate);
    state.backendOnline = false;
  }
  render();
}

async function updateCandidateConsent(decision) {
  const email = String(state.user?.email || "").trim().toLowerCase();
  if (!email) {
    alert("Candidate email was not found.");
    return;
  }
  try {
    const updated = await apiRequest(`/api/candidates/${encodeURIComponent(email)}/consent`, {
      method: "PUT",
      body: JSON.stringify({ decision }),
    });
    candidates = candidates.map(candidate => {
      return String(candidate.email || "").trim().toLowerCase() === email ? updated : candidate;
    });
    state.backendOnline = true;
    render();
  } catch (error) {
    alert(error.message || "Could not update invitation status.");
    state.backendOnline = false;
  }
}

async function saveSettings() {
  state.settings.capacityLimit = Number(document.querySelector("#capacityLimit")?.value) || 1000;
  state.settings.candidateTranscriptAccess = document.querySelector("#candidateTranscriptAccess")?.value === "yes";
  try {
    await apiRequest("/api/settings", {
      method: "PUT",
      body: JSON.stringify(state.settings),
    });
    state.backendOnline = true;
    alert("Settings saved.");
  } catch (error) {
    state.backendOnline = false;
    alert("Settings could not be saved. Please try again.");
  }
  render();
}

async function clearHistory(type) {
  const labels = {
    attendance: "attendance records",
    meetings: "meeting history",
    candidates: "candidate list",
    transcripts: "transcript history",
    "chat-messages": "meeting chat history",
    "whatsapp-campaigns": "WhatsApp campaign history",
  };
  if (!confirm(`Clear ${labels[type] || "history"}? This cannot be undone.`)) {
    return;
  }
  try {
    await apiRequest(`/api/${type}`, { method: "DELETE" });
    clearLocalHistoryState(type);
    await loadBootstrapData();
    state.backendOnline = true;
    alert(`${labels[type] || "History"} cleared.`);
  } catch (error) {
    state.backendOnline = false;
    alert(error.message);
  }
  render();
}

function clearLocalHistoryState(type) {
  if (type === "attendance") {
    attendanceRows = [];
  } else if (type === "meetings") {
    meetings = [];
    state.activeMeeting = null;
    state.activeAttendance = null;
  } else if (type === "candidates") {
    candidates = [];
  } else if (type === "transcripts") {
    transcriptLines = [];
  } else if (type === "chat-messages") {
    chatMessages = [];
  } else if (type === "whatsapp-campaigns") {
    whatsappCampaigns = [];
  }
}

function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join("");
}

function createPeerConnection(socketId, userPayload) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[socketId] = pc;
  
  pc.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.emit("webrtc-ice-candidate", socketId, event.candidate);
    }
  };
  
  pc.onnegotiationneeded = async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (socket) socket.emit("webrtc-offer", socketId, offer);
    } catch(e) {
      console.error(e);
    }
  };

  pc.ontrack = (event) => {
    if (!remoteStreams[socketId]) {
      remoteStreams[socketId] = new MediaStream();
      render();
      setTimeout(() => {
        detectActiveSpeaker(remoteStreams[socketId], `remoteVideo-${socketId}`);
      }, 500);
    }
    remoteStreams[socketId].addTrack(event.track);
  };
  
  return pc;
}

function syncLocalTracksToPeers() {
  const streamToShare = state.screenSharing ? state.screenStream : new MediaStream();
  if (!state.screenSharing) {
    if (state.stream) state.stream.getTracks().forEach(t => streamToShare.addTrack(t));
    if (state.audioStream) state.audioStream.getTracks().forEach(t => streamToShare.addTrack(t));
  }

  Object.values(peerConnections).forEach(pc => {
    const senders = pc.getSenders();
    
    streamToShare.getTracks().forEach(track => {
      const existingSender = senders.find(s => s.track === track);
      if (!existingSender) {
         const senderToReplace = senders.find(s => s.track && s.track.kind === track.kind && !streamToShare.getTracks().includes(s.track));
         if (senderToReplace) {
           senderToReplace.replaceTrack(track);
         } else {
           pc.addTrack(track, streamToShare);
         }
      }
    });

    pc.getSenders().forEach(sender => {
      if (sender.track && !streamToShare.getTracks().includes(sender.track)) {
        pc.removeTrack(sender);
      }
    });
  });
}

async function initApp() {
  await loadBootstrapData();
  window.history.replaceState({ route: state.route }, "", window.location.pathname + window.location.search);
  window.addEventListener("popstate", async event => {
    const route = event.state?.route || "dashboard";
    if (!state.user) {
      render();
      return;
    }
    await navigateTo(route, { skipHistory: true });
  });
  render();
}

initApp();
