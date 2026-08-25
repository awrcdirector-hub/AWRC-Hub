const express = require("express");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const webPush = require("web-push");

const app = express();
const port = process.env.PORT || 10000;
const publicDir = __dirname;
const stateFile = process.env.HUB_STATE_FILE || path.join(publicDir, "data", "hub-notifications-state.json");
const hubBaseUrl = (process.env.HUB_BASE_URL || "https://awrc-hub.onrender.com").replace(/\/$/, "");
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@awrc.local";
const notifySecret = process.env.HUB_NOTIFY_SECRET || "";

const allowedOrigins = new Set([
  "https://awrc-hub.onrender.com",
  "https://awrc-logbook.onrender.com",
  "https://awrc-video-library.onrender.com",
  "https://awrc-training-signup.onrender.com",
  "http://localhost:10000",
  "http://localhost:3000",
  "http://localhost:4173",
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Hub-Notify-Secret");
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
    };
  } catch (_error) {
    return { subscriptions: [] };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function normaliseName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
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

app.get("/api/push/public-key", (_req, res) => {
  res.json({
    publicKey: vapidPublicKey,
    configured: Boolean(vapidPublicKey && vapidPrivateKey),
  });
});

app.get("/api/push/status", (req, res) => {
  const userName = normaliseName(req.query.userName);
  const state = readState();
  const users = [...new Set(state.subscriptions.map((item) => item.userName).filter(Boolean))].sort();
  res.json({
    configured: Boolean(vapidPublicKey && vapidPrivateKey),
    subscriptionCount: state.subscriptions.length,
    users,
    userRegistered: userName
      ? state.subscriptions.some((item) => item.userName.toLowerCase() === userName.toLowerCase())
      : null,
  });
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
