const HUB_NOTIFY_NAME_KEY = "awrc-hub-notify-name";

const form = document.querySelector("#hubNotifyForm");
const nameInput = document.querySelector("#hubNotifyName");
const statusText = document.querySelector("#hubNotifyStatus");
const enableButton = document.querySelector("#hubEnableNotifications");

if (nameInput) {
  nameInput.value = localStorage.getItem(HUB_NOTIFY_NAME_KEY) || "";
}

function setStatus(message, kind = "neutral") {
  if (!statusText) return;
  statusText.textContent = message;
  statusText.dataset.kind = kind;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function getPublicKey() {
  const response = await fetch("/api/push/public-key");
  if (!response.ok) throw new Error("Could not load notification key.");
  const data = await response.json();
  if (!data.configured || !data.publicKey) {
    throw new Error("Hub notifications need VAPID keys on Render first.");
  }
  return data.publicKey;
}

async function enableHubNotifications(event) {
  event.preventDefault();

  const userName = nameInput?.value.trim();
  if (!userName) {
    setStatus("Enter your name first.", "error");
    nameInput?.focus();
    return;
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    setStatus("This browser does not support web push notifications.", "error");
    return;
  }

  enableButton.disabled = true;
  setStatus("Setting up Hub notifications...", "neutral");

  try {
    const publicKey = await getPublicKey();
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Notifications were not allowed on this device.", "error");
      return;
    }

    const registration = await navigator.serviceWorker.register("/service-worker.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName, subscription }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Could not save this device.");
    }

    localStorage.setItem(HUB_NOTIFY_NAME_KEY, userName);
    setStatus(`${userName} is set up for Hub notifications on this device.`, "success");
  } catch (error) {
    setStatus(error.message || "Hub notifications could not be set up.", "error");
  } finally {
    enableButton.disabled = false;
  }
}

form?.addEventListener("submit", enableHubNotifications);
