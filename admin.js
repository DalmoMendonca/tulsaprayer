const passwordInput = document.querySelector("#adminPassword");
const loginForm = document.querySelector("#loginForm");
const adminTools = document.querySelector("#adminTools");
const adminList = document.querySelector("#adminList");
const adminSummary = document.querySelector("#adminSummary");
const refreshAdmin = document.querySelector("#refreshAdmin");

let adminPassword = "";
let areas = [];

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminPassword = passwordInput.value;
  if (!adminPassword) return;
  adminTools.hidden = false;
  await loadAdmin();
});

refreshAdmin.addEventListener("click", loadAdmin);

async function loadAdmin() {
  const [geojson, prayers] = await Promise.all([
    fetch("./data/tulsa-nsa.geojson").then((response) => response.json()),
    fetch(apiUrl()).then((response) => response.json()),
  ]);

  areas = geojson.features
    .map((feature) => ({
      id: `nsa-${feature.properties.Map_ID}`,
      mapId: feature.properties.Map_ID,
      name: feature.properties.Neighorhood,
    }))
    .sort((a, b) => a.mapId - b.mapId);

  const activeAreas = areas.filter((area) => (prayers[area.id] || []).length);
  const total = Object.values(prayers).flat().length;
  adminSummary.textContent = `${total} ${total === 1 ? "prayer" : "prayers"}`;

  if (!activeAreas.length) {
    adminList.innerHTML = `<div class="empty-state">No prayers registered.</div>`;
    return;
  }

  adminList.innerHTML = activeAreas
    .map((area) => {
      const entries = prayers[area.id] || [];
      return `
        <article class="admin-area">
          <header>
            <div>
              <h2>${escapeHtml(area.name)}</h2>
              <p>Area ${area.mapId} - ${entries.length} ${entries.length === 1 ? "prayer" : "prayers"}</p>
            </div>
            <button type="button" data-clear="${area.id}">Clear</button>
          </header>
          ${entries
            .map(
              (entry) => `
                <div class="admin-prayer">
                  <div>
                    <strong>${escapeHtml(entry.name)}</strong>
                    <time datetime="${escapeAttribute(entry.createdAt)}">${formatDate(entry.createdAt)}</time>
                  </div>
                  <p>${escapeHtml(entry.text)}</p>
                  ${
                    entry.audioUrl
                      ? `<audio controls preload="none" src="${escapeAttribute(entry.audioUrl)}"></audio>`
                      : ""
                  }
                  <button type="button" class="admin-delete-prayer" data-area="${escapeAttribute(area.id)}" data-prayer="${escapeAttribute(entry.id)}">Delete prayer</button>
                </div>
              `,
            )
            .join("")}
        </article>
      `;
    })
    .join("");

  adminList.querySelectorAll("[data-clear]").forEach((button) => {
    button.addEventListener("click", () => clearArea(button.dataset.clear));
  });
  adminList.querySelectorAll("[data-prayer]").forEach((button) => {
    button.addEventListener("click", () => deletePrayer(button.dataset.area, button.dataset.prayer));
  });
}

async function clearArea(areaId) {
  const response = await fetch(apiUrl(), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ areaId, password: adminPassword }),
  });
  if (!response.ok) {
    alert("Admin password rejected.");
    return;
  }
  await loadAdmin();
}

async function deletePrayer(areaId, prayerId) {
  const response = await fetch(apiUrl(), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ areaId, prayerId, password: adminPassword }),
  });
  if (!response.ok) {
    alert("Prayer could not be deleted. Check the admin password and try again.");
    return;
  }
  await loadAdmin();
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function apiUrl() {
  return "/api/prayers";
}
