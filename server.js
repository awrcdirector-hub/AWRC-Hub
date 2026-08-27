const express = require("express");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const webPush = require("web-push");

const app = express();
const port = process.env.PORT || 10000;
const publicDir = __dirname;
const renderDiskStateFile = "/var/data/hub-notifications-state.json";
const stateFile = process.env.HUB_STATE_FILE
  || (fs.existsSync(path.dirname(renderDiskStateFile)) ? renderDiskStateFile : path.join(publicDir, "data", "hub-notifications-state.json"));
const hubBaseUrl = (process.env.HUB_BASE_URL || "https://awrc-hub.onrender.com").replace(/\/$/, "");
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@awrc.local";
const notifySecret = process.env.HUB_NOTIFY_SECRET || "";
const adminPassword = process.env.HUB_ADMIN_PASSWORD || "2852";
const defaultMembers = require("./default-members.json");

const allowedOrigins = new Set([
  "https://awrc-hub.onrender.com",
  "https://awrc-logbook.onrender.com",
  "https://awrc-video-library.onrender.com",
  "https://awrc-training-signup.onrender.com",
  "http://localhost:10000",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:4185",
  "http://localhost:4186",
  "http://localhost:4190",
]);

const appIcons = {
  hub: "/awrc-hub-icon.png",
  logbook: "/logbook-icon-v11.png",
  "video-library": "/video-library-hub-icon.png",
  "training-signup": "/training-signup-icon.png",
};

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Hub-Notify-Secret,X-Admin-Password");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(
  express.static(publicDir, {
    extensions: ["html"],
  }),
);

function readState() {
  try {
    const raw = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      members: normaliseMembers(parsed.members),
    };
  } catch (_error) {
    return { subscriptions: [], members: normaliseMembers(defaultMembers) };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function stateStorageStatus() {
  const usingPersistentDisk = stateFile.startsWith("/var/data/");
  return {
    stateFile,
    usingPersistentDisk,
    persistentMountExists: fs.existsSync("/var/data"),
    memberCount: readState().members.length,
    subscriptionCount: readState().subscriptions.length,
  };
}

function normaliseName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function memberSlug(name) {
  return normaliseName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normaliseDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

const validRoles = ["Athlete", "Coach", "Admin", "Coxswain"];

function normaliseRoles(value) {
  const rawRoles = Array.isArray(value)
    ? value
    : String(value || "").split(/[,/]/);
  const roles = rawRoles
    .map(normaliseName)
    .flatMap((role) => role === "Coach/Admin" ? ["Coach", "Admin"] : [role])
    .filter((role) => validRoles.includes(role));
  return [...new Set(roles.length ? roles : ["Athlete"])];
}

function hasBodyField(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function nonBlankBodyValue(body, keys, fallback = "") {
  for (const key of keys) {
    if (!hasBodyField(body, key)) continue;
    const value = normaliseName(body[key]);
    if (value) return value;
  }
  return fallback;
}

function validBodyDate(body, keys, fallback = "") {
  for (const key of keys) {
    if (!hasBodyField(body, key)) continue;
    const value = normaliseDate(body[key]);
    if (value) return value;
  }
  return fallback;
}

function ageInSeasonYear(dateOfBirth, seasonYear = new Date().getFullYear()) {
  const dob = normaliseDate(dateOfBirth);
  if (!dob) return null;
  const [birthYear] = dob.split("-").map(Number);
  const age = seasonYear - birthYear;
  return age >= 0 && age < 130 ? age : null;
}

function mastersAgeGroup(age) {
  if (age === null || age < 27) return "";
  if (age <= 35) return "Masters A";
  if (age <= 42) return "Masters B";
  if (age <= 49) return "Masters C";
  if (age <= 54) return "Masters D";
  if (age <= 59) return "Masters E";
  if (age <= 64) return "Masters F";
  if (age <= 69) return "Masters G";
  if (age <= 74) return "Masters H";
  if (age <= 79) return "Masters I";
  if (age <= 82) return "Masters J";
  if (age <= 85) return "Masters K";
  if (age <= 88) return "Masters L";
  return "Masters M";
}

function calculatedAgeGroup(profile) {
  const age = ageInSeasonYear(profile.dateOfBirth);
  if (age === null) return profile.ageGroup || "";
  if (age < 23) return `U${age + 1}`;
  if (age < 27) return "Open";
  return mastersAgeGroup(age);
}

function normaliseMemberProfile(member) {
  const source = typeof member === "string" ? { name: member } : member || {};
  const name = normaliseName(source.name);
  if (!name) return null;

  const profile = {
    id: normaliseName(source.id) || memberSlug(name),
    name,
    grade: normaliseName(source.grade),
    gender: normaliseName(source.gender),
    ageGroup: normaliseName(source.ageGroup || source.age),
    dateOfBirth: normaliseDate(source.dateOfBirth || source.dob),
    roles: normaliseRoles(source.roles || source.role),
    active: source.active === false ? false : true,
  };
  return { ...profile, role: profile.roles.join(", "), ageGroup: calculatedAgeGroup(profile) };
}

function normaliseMembers(members) {
  const source = Array.isArray(members) && members.length ? members : defaultMembers;
  const membersByName = new Map();
  source.forEach((member) => {
    const profile = normaliseMemberProfile(member);
    if (!profile) return;
    membersByName.set(profile.name.toLowerCase(), { ...membersByName.get(profile.name.toLowerCase()), ...profile });
  });
  return [...membersByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function memberNames(members) {
  return normaliseMembers(members).map((member) => member.name);
}

function membersPayload(members) {
  const normalisedMembers = normaliseMembers(members);
  return { members: normalisedMembers, names: normalisedMembers.map((member) => member.name) };
}

function subscriptionKey(item) {
  return item?.subscription?.endpoint || "";
}

function absoluteIcon(appName) {
  const src = appIcons[appName] || appIcons.hub;
  return `${hubBaseUrl}${src}`;
}

function authorised(req) {
  if (!notifySecret) return true;
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer === notifySecret || req.headers["x-hub-notify-secret"] === notifySecret;
}

function adminAuthorised(req) {
  return req.headers["x-admin-password"] === adminPassword;
}

app.get("/api/push/public-key", (_req, res) => {
  res.json({
    publicKey: vapidPublicKey,
    configured: Boolean(vapidPublicKey && vapidPrivateKey),
  });
});

app.get("/api/push/status", (req, res) => {
  const userName = normaliseName(req.query.userName);
  const endpoint = normaliseName(req.query.endpoint);
  const state = readState();
  const users = [...new Set(state.subscriptions.map((item) => item.userName).filter(Boolean))].sort();
  const userRegistered = userName
    ? state.subscriptions.some((item) => item.userName.toLowerCase() === userName.toLowerCase())
    : null;
  const deviceRegistered = endpoint
    ? state.subscriptions.some((item) => item.subscription?.endpoint === endpoint)
    : null;
  res.json({
    configured: Boolean(vapidPublicKey && vapidPrivateKey),
    subscriptionCount: state.subscriptions.length,
    users,
    userRegistered,
    deviceRegistered,
    registered: Boolean(userRegistered && (deviceRegistered ?? true)),
  });
});

app.get("/api/members", (_req, res) => {
  const state = readState();
  res.json(membersPayload(state.members));
});

app.get("/api/storage/status", (_req, res) => {
  res.json(stateStorageStatus());
});

app.post("/api/members", (req, res) => {
  if (!adminAuthorised(req)) {
    res.status(401).json({ error: "Admin password required" });
    return;
  }

  const name = normaliseName(req.body.name);
  if (!name) {
    res.status(400).json({ error: "Member name is required" });
    return;
  }

  const state = readState();
  const members = normaliseMembers(state.members);
  const bodyId = normaliseName(req.body.id);
  const existing = members.find((member) => bodyId && member.id === bodyId)
    || members.find((member) => member.name.toLowerCase() === name.toLowerCase());
  const incomingRoles = hasBodyField(req.body, "roles")
    ? req.body.roles
    : hasBodyField(req.body, "role")
      ? req.body.role
      : existing?.roles ?? existing?.role;
  const nextProfile = normaliseMemberProfile({
    ...(existing || {}),
    name,
    grade: nonBlankBodyValue(req.body, ["grade"], existing?.grade),
    gender: nonBlankBodyValue(req.body, ["gender"], existing?.gender),
    ageGroup: nonBlankBodyValue(req.body, ["ageGroup", "age"], existing?.ageGroup),
    dateOfBirth: validBodyDate(req.body, ["dateOfBirth", "dob"], existing?.dateOfBirth),
    roles: incomingRoles,
    active: hasBodyField(req.body, "active") ? req.body.active : existing?.active,
  });
  const nextMembers = existing
    ? members.map((member) => (member.id === existing.id ? nextProfile : member))
    : [...members, nextProfile];
  state.members = normaliseMembers(nextMembers);
  writeState(state);
  res.json({ ok: true, ...membersPayload(state.members) });
});

app.delete("/api/members", (req, res) => {
  if (!adminAuthorised(req)) {
    res.status(401).json({ error: "Admin password required" });
    return;
  }

  const name = normaliseName(req.body.name);
  if (!name) {
    res.status(400).json({ error: "Member name is required" });
    return;
  }

  const state = readState();
  state.members = normaliseMembers(state.members).filter((member) => member.name.toLowerCase() !== name.toLowerCase());
  state.subscriptions = state.subscriptions.filter((item) => item.userName?.toLowerCase() !== name.toLowerCase());
  writeState(state);
  res.json({ ok: true, ...membersPayload(state.members) });
});

app.post("/api/push/subscribe", (req, res) => {
  const userName = normaliseName(req.body.userName);
  const subscription = req.body.subscription;
  const endpoint = subscription?.endpoint;

  if (!userName || !subscription || !endpoint) {
    res.status(400).json({ error: "userName and subscription are required" });
    return;
  }

  const state = readState();
  state.subscriptions = state.subscriptions.filter((item) => {
    const sameEndpoint = item.subscription?.endpoint === endpoint;
    const sameUser = item.userName?.toLowerCase() === userName.toLowerCase();
    return !sameEndpoint && !sameUser;
  });
  state.subscriptions.push({
    id: randomUUID(),
    userName,
    subscription,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  writeState(state);

  res.json({ ok: true, userName, subscriptionCount: state.subscriptions.length });
});

app.post("/api/notifications/send", async (req, res) => {
  if (!authorised(req)) {
    res.status(401).json({ error: "Not authorised" });
    return;
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    res.status(503).json({ error: "Hub notifications are not configured" });
    return;
  }

  const appName = String(req.body.app || "hub").trim();
  const recipients = Array.isArray(req.body.recipients)
    ? req.body.recipients.map(normaliseName).filter(Boolean)
    : [normaliseName(req.body.recipient)].filter(Boolean);

  if (!recipients.length) {
    res.status(400).json({ error: "At least one recipient is required" });
    return;
  }

  const recipientSet = new Set(recipients.map((name) => name.toLowerCase()));
  const state = readState();
  const targets = state.subscriptions.filter((item) => recipientSet.has(item.userName?.toLowerCase()));
  const payload = {
    title: req.body.title || "AWRC Hub",
    body: req.body.body || req.body.message || "Open AWRC Hub for details.",
    url: req.body.url || `${hubBaseUrl}/#`,
    icon: absoluteIcon(appName),
    badge: absoluteIcon(appName),
    tag: req.body.tag || `awrc-${appName}`,
    app: appName,
    requireInteraction: Boolean(req.body.requireInteraction),
  };

  const expiredEndpoints = new Set();
  const results = await Promise.allSettled(
    targets.map((item) =>
      webPush.sendNotification(item.subscription, JSON.stringify(payload)).catch((error) => {
        if (error.statusCode === 404 || error.statusCode === 410) {
          expiredEndpoints.add(subscriptionKey(item));
        }
        throw error;
      }),
    ),
  );

  if (expiredEndpoints.size) {
    state.subscriptions = state.subscriptions.filter((item) => !expiredEndpoints.has(subscriptionKey(item)));
    writeState(state);
  }

  res.json({
    ok: true,
    app: appName,
    requestedRecipients: recipients,
    matchedDevices: targets.length,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    removedExpired: expiredEndpoints.size,
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`AWRC Hub running on port ${port}`);
});
