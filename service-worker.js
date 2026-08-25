self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_error) {
      payload = { title: "AWRC Hub", body: event.data.text() };
    }
  }

  const title = payload.title || "AWRC Hub";
  const options = {
    body: payload.body || payload.message || "Open AWRC Hub for details.",
    icon: payload.icon || "/awrc-hub-icon.png",
    badge: payload.badge || payload.icon || "/awrc-hub-icon.png",
    tag: payload.tag || "awrc-hub",
    data: payload.url || "https://awrc-hub.onrender.com/#",
    requireInteraction: Boolean(payload.requireInteraction),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || "https://awrc-hub.onrender.com/#";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => client.url === targetUrl);
      if (matchingClient) return matchingClient.focus();
      if (clients.length) return clients[0].navigate(targetUrl).then((client) => client.focus());
      return self.clients.openWindow(targetUrl);
    }),
  );
});
