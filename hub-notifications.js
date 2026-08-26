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
const memberAddGrade = document.querySelector("#hubMemberAddGrade");
const memberAddDateOfBirth = document.querySelector("#hubMemberAddDateOfBirth");
const memberAddRole = document.querySelector("#hubMemberAddRole");
const memberRemoveForm = document.querySelector("#hubMemberRemoveForm");
const memberRemoveName = document.querySelector("#hubMemberRemoveName");
const rosterBody = document.querySelector("#hubRosterBody");
const rosterSearch = document.querySelector("#hubRosterSearch");
const roleOptions = ["Athlete", "Coach", "Admin", "Coxswain"];

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

setEnabledButton("");

function syncEnabledButtonToName() {
  const selectedName = registeredName(nameInput?.value);
  const savedName = savedNotificationName();
  const stillEnabled = selectedName && savedName && selectedName.toLowerCase() === savedName.toLowerCase();
  if (!stillEnabled) setEnabledButton("");
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

function normaliseMember(member) {
  const source = typeof member === "string" ? { name: member } : member || {};
  const name = normaliseName(source.name);
  if (!name) return null;
  const roles = normaliseRoles(source.roles || source.role);

  return {
    id: normaliseName(source.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    name,
    grade: normaliseName(source.grade),
    ageGroup: normaliseName(source.ageGroup || source.age),
    dateOfBirth: normaliseName(source.dateOfBirth || source.dob),
    roles,
    role: roles.join(", "),
    active: source.active === false ? false : true,
  };
}

function normaliseRoles(value) {
  const rawRoles = Array.isArray(value)
    ? value
    : String(value || "").split(/[,/]/);
  const roles = rawRoles
    .map(normaliseName)
    .flatMap((role) => role === "Coach/Admin" ? ["Coach", "Admin"] : [role])
    .filter((role) => roleOptions.includes(role));
  return [...new Set(roles.length ? roles : ["Athlete"])];
}

function normaliseMemberList(nextMembers) {
  return (Array.isArray(nextMembers) ? nextMembers : [])
    .map(normaliseMember)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function memberNames() {
  return members.map((member) => member.name);
}

function renderMembers() {
  if (!memberOptions) return;
  memberOptions.innerHTML = memberNames().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  renderRoster();
}

function memberGaps(member) {
  return [
    member.grade ? "" : "grade",
    member.dateOfBirth ? "" : "DOB",
    member.roles?.length ? "" : "role",
  ].filter(Boolean);
}

function rosterRow(member) {
  const gaps = memberGaps(member);
  const missingText = gaps.length ? `Missing ${gaps.join(", ")}` : "Complete";
  return `
    <tr data-member-id="${escapeHtml(member.id)}">
      <td><input data-field="name" value="${escapeHtml(member.name)}" /></td>
      <td><input data-field="grade" value="${escapeHtml(member.grade)}" placeholder="Ability grade" /></td>
      <td><input data-field="dateOfBirth" type="date" value="${escapeHtml(member.dateOfBirth)}" /></td>
      <td><span class="age-group">${escapeHtml(member.ageGroup || "Set DOB")}</span></td>
      <td>
        <div class="role-checkboxes" data-field="roles">
          ${roleOptions.map((role) => (
            `<label><input type="checkbox" value="${escapeHtml(role)}"${member.roles.includes(role) ? " checked" : ""} /> ${escapeHtml(role)}</label>`
          )).join("")}
        </div>
      </td>
      <td>
        <select data-field="active">
          <option value="true"${member.active ? " selected" : ""}>Active</option>
          <option value="false"${member.active ? "" : " selected"}>Inactive</option>
        </select>
        <small class="${gaps.length ? "missing" : "complete"}">${escapeHtml(missingText)}</small>
      </td>
      <td class="roster-actions">
        <button class="roster-save" data-roster-save="${escapeHtml(member.id)}" type="button">Save</button>
        <button class="roster-delete" data-roster-delete="${escapeHtml(member.name)}" type="button">Delete</button>
      </td>
    </tr>
  `;
}

function renderRoster() {
  if (!rosterBody) return;
  const search = normaliseName(rosterSearch?.value).toLowerCase();
  const visibleMembers = search
    ? members.filter((member) => [member.name, member.grade, member.ageGroup, member.role].join(" ").toLowerCase().includes(search))
    : members;

  rosterBody.innerHTML = visibleMembers.map(rosterRow).join("");
}

async function loadMembers() {
  try {
    const response = await fetch("/api/members", { cache: "no-store" });
    if (!response.ok) throw new Error("Member list could not be loaded.");
    const data = await response.json();
    members = normaliseMemberList(data.members || data.names);
    renderMembers();
    await verifySavedNotificationStatus();
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

async function currentPushEndpoint() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint || "";
}

async function verifySavedNotificationStatus() {
  const savedName = registeredName(savedNotificationName());
  if (!savedName) {
    setEnabledButton("");
    return;
  }

  nameInput.value = savedName;
  try {
    const endpoint = await currentPushEndpoint();
    const params = new URLSearchParams({ userName: savedName });
    if (endpoint) params.set("endpoint", endpoint);
    const response = await fetch(`/api/push/status?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not check notification status.");
    const data = await response.json();
    if (data.registered) {
      setEnabledButton(savedName);
      setStatus(`${savedName} is set up for Hub notifications on this device.`, "success");
      return;
    }
    setEnabledButton("");
    setStatus(`${savedName} needs notifications enabled again on this device.`, "error");
  } catch {
    setEnabledButton("");
  }
}

function registeredName(input) {
  const userName = normaliseName(input);
  return members.find((member) => member.name.toLowerCase() === userName.toLowerCase())?.name || "";
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
    body: JSON.stringify({
      name,
      grade: memberAddGrade?.value || "",
      dateOfBirth: memberAddDateOfBirth?.value || "",
      roles: [...(memberAddRole?.querySelectorAll("input:checked") || [])].map((option) => option.value),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    setAdminStatus(data.error || "Member could not be added.", "error");
    return;
  }
  members = normaliseMemberList(data.members || data.names || members);
  renderMembers();
  memberAddForm?.reset();
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
  members = normaliseMemberList(data.members || data.names || members);
  renderMembers();
  memberRemoveName.value = "";
  setAdminStatus(`${name} removed from the Hub register.`, "success");
}

async function saveRosterRow(button) {
  const row = button.closest("tr");
  if (!row) return;
  const originalId = button.dataset.rosterSave;
  const existing = members.find((member) => member.id === originalId);
  const fields = Object.fromEntries(
    [...row.querySelectorAll("[data-field]:not([multiple])")].map((field) => [field.dataset.field, field.value])
  );
  fields.roles = [...row.querySelectorAll("[data-field='roles'] input:checked")].map((option) => option.value);
  const name = normaliseName(fields.name);
  if (!name) {
    setAdminStatus("Roster row needs a name before saving.", "error");
    return;
  }

  button.disabled = true;
  const response = await fetch("/api/members", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      id: existing?.id || originalId,
      name,
      grade: fields.grade || "",
      dateOfBirth: fields.dateOfBirth || "",
      roles: fields.roles,
      active: fields.active !== "false",
    }),
  });
  const data = await response.json().catch(() => ({}));
  button.disabled = false;
  if (!response.ok) {
    setAdminStatus(data.error || "Roster row could not be saved.", "error");
    return;
  }
  members = normaliseMemberList(data.members || data.names || members);
  renderMembers();
  setAdminStatus(`${name} saved in the Hub register.`, "success");
}

async function deleteRosterRow(button) {
  const name = normaliseName(button.dataset.rosterDelete);
  if (!name) return;
  if (!window.confirm(`Delete ${name} from the Hub register?`)) return;

  button.disabled = true;
  const response = await fetch("/api/members", {
    method: "DELETE",
    headers: adminHeaders(),
    body: JSON.stringify({ name }),
  });
  const data = await response.json().catch(() => ({}));
  button.disabled = false;
  if (!response.ok) {
    setAdminStatus(data.error || "Member could not be deleted.", "error");
    return;
  }
  members = normaliseMemberList(data.members || data.names || members);
  renderMembers();
  setAdminStatus(`${name} deleted from the Hub register.`, "success");
}

form?.addEventListener("submit", enableHubNotifications);
nameInput?.addEventListener("input", syncEnabledButtonToName);
nameInput?.addEventListener("change", syncEnabledButtonToName);
adminLogin?.addEventListener("submit", unlockAdmin);
memberAddForm?.addEventListener("submit", addMember);
memberRemoveForm?.addEventListener("submit", removeMember);
rosterSearch?.addEventListener("input", renderRoster);
rosterBody?.addEventListener("click", (event) => {
  const saveButton = event.target.closest("[data-roster-save]");
  if (saveButton) void saveRosterRow(saveButton);
  const deleteButton = event.target.closest("[data-roster-delete]");
  if (deleteButton) void deleteRosterRow(deleteButton);
});
void loadMembers();
