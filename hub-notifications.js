const HUB_NOTIFY_NAME_KEY = "awrc-hub-notify-name";

let members = [];
let adminPassword = "";

const form = document.querySelector("#hubNotifyForm");
const nameInput = document.querySelector("#hubNotifyName");
const memberOptions = document.querySelector("#memberOptions");
const statusText = document.querySelector("#hubNotifyStatus");
const enableButton = document.querySelector("#hubEnableNotifications");
const adminLogin = document.querySelector("#hubAdminLogin");
const adminPasswordInput = document.querySelector("#hubAdminPassword");
const adminTools = document.querySelector("#hubAdminTools");
const adminStatus = document.querySelector("#hubAdminStatus");
const memberAddForm = document.querySelector("#hubMemberAddForm");
const memberAddName = document.querySelector("#hubMemberAddName");
const memberRemoveForm = document.querySelector("#hubMemberRemoveForm");
const memberRemoveName = document.querySelector("#hubMemberRemoveName");

function savedNotificationName() {
  return localStorage.getItem(HUB_NOTIFY_NAME_KEY) || "";
}

if (nameInput) {
  nameInput.value = savedNotificationName();
}

function setEnabledButton(userName) {
  if (!enableButton) return;
  enableButton.textContent = userName ? "Enabled" : "Enable";
  enableButton.dataset.enabled = userName ? "true" : "false";
  enableButton.setAttribute("aria-label", userName ? `Notifications enabled for ${userName}` : "Enable notifications");
}

if (nameInput?.value) {
  setEnabledButton(nameInput.value);
}

function syncEnabledButtonToName() {
  const selectedName = registeredName(nameInput?.value);
  const savedName = savedNotificationName();
  const stillEnabled = selectedName && savedName && selectedName.toLowerCase() === savedName.toLowerCase();
  setEnabledButton(stillEnabled ? selectedName : "");
}

function setStatus(message, kind = "neutral") {
  if (!statusText) return;
  statusText.textContent = message;
  statusText.dataset.kind = kind;
}

function setAdminStatus(message, kind = "neutral") {
  if (!adminStatus) return;
  adminStatus.textContent = message;
  adminStatus.dataset.kind = kind;
}

function normaliseName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function renderMembers() {
  if (!memberOptions) return;
  memberOptions.innerHTML = members.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
}

async function loadMembers() {
  try {
    const response = await fetch("/api/members", { cache: "no-store" });
    if (!response.ok) throw new Error("Member list could not be loaded.");
    const data = await response.json();
    members = Array.isArray(data.members) ? data.members : [];
    renderMembers();
  } catch (error) {
    setStatus(error.message || "Member list could not be loaded.", "error");
  }
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

function registeredName(input) {
  const userName = normaliseName(input);
  return members.find((member) => member.toLowerCase() === userName.toLowerCase()) || "";
}

async function enableHubNotifications(event) {
  event.preventDefault();

  const userName = registeredName(nameInput?.value);
  if (!userName) {
    setStatus("Choose a name from the member list first.", "error");
    nameInput?.focus();
    return;
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    setStatus("This browser does not support web push notifications.", "error");
    return;
  }

  enableButton.disabled = true;
  setStatus("Setting up notifications...", "neutral");

  try {
    const publicKey = await getPublicKey();
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Notifications were not allowed on this device.", "error");
      return;
    }

    await navigator.serviceWorker.register("/service-worker.js");
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) {
      throw new Error("Notifications are not ready yet. Refresh the Hub and try once more.");
    }
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
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

    nameInput.value = userName;
    localStorage.setItem(HUB_NOTIFY_NAME_KEY, userName);
    setEnabledButton(userName);
    setStatus(`${userName} is set up for Hub notifications on this device.`, "success");
  } catch (error) {
    setStatus(error.message || "Hub notifications could not be set up.", "error");
  } finally {
    enableButton.disabled = false;
  }
}

function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Admin-Password": adminPassword,
  };
}

function unlockAdmin(event) {
  event.preventDefault();
  adminPassword = adminPasswordInput?.value || "";
  if (!adminPassword) {
    setAdminStatus("Enter the admin password.", "error");
    return;
  }
  adminTools.hidden = false;
  setAdminStatus("Admin tools unlocked.", "success");
}

async function addMember(event) {
  event.preventDefault();
  const name = normaliseName(memberAddName?.value);
  if (!name) {
    setAdminStatus("Enter a member name to add.", "error");
    return;
  }

  const response = await fetch("/api/members", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ name }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    setAdminStatus(data.error || "Member could not be added.", "error");
    return;
  }
  members = data.members || members;
  renderMembers();
  memberAddName.value = "";
  setAdminStatus(`${name} added to the Hub register.`, "success");
}

async function removeMember(event) {
  event.preventDefault();
  const name = registeredName(memberRemoveName?.value);
  if (!name) {
    setAdminStatus("Choose a member from the list to remove.", "error");
    return;
  }

  const response = await fetch("/api/members", {
    method: "DELETE",
    headers: adminHeaders(),
    body: JSON.stringify({ name }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    setAdminStatus(data.error || "Member could not be removed.", "error");
    return;
  }
  members = data.members || members;
  renderMembers();
  memberRemoveName.value = "";
  setAdminStatus(`${name} removed from the Hub register.`, "success");
}

form?.addEventListener("submit", enableHubNotifications);
nameInput?.addEventListener("input", syncEnabledButtonToName);
nameInput?.addEventListener("change", syncEnabledButtonToName);
adminLogin?.addEventListener("submit", unlockAdmin);
memberAddForm?.addEventListener("submit", addMember);
memberRemoveForm?.addEventListener("submit", removeMember);
void loadMembers();
