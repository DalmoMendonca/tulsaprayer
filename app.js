import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const storageKey = "tulsa-prayer-map:v2";
const dataUrl = "./data/tulsa-nsa.geojson";
const canvas = document.querySelector("#scene");
const totalPrayers = document.querySelector("#totalPrayers");
const totalAreas = document.querySelector("#totalAreas");
const selectedName = document.querySelector("#selectedName");
const selectedMeta = document.querySelector("#selectedMeta");
const selectedScore = document.querySelector("#selectedScore");
const selectedPopulation = document.querySelector("#selectedPopulation");
const selectedArea = document.querySelector("#selectedArea");
const prayerCount = document.querySelector("#prayerCount");
const prayerForm = document.querySelector("#prayerForm");
const prayerName = document.querySelector("#prayerName");
const prayerText = document.querySelector("#prayerText");
const prayerFeed = document.querySelector("#prayerFeed");
const recordButton = document.querySelector("#recordButton");
const discardRecording = document.querySelector("#discardRecording");
const recordDuration = document.querySelector("#recordDuration");
const audioPreview = document.querySelector("#audioPreview");
const formStatus = document.querySelector("#formStatus");
const tiltButton = document.querySelector("#tiltButton");
const resetButton = document.querySelector("#resetButton");
const hoverLabel = document.querySelector("#hoverLabel");
const openAllPrayers = document.querySelector("#openAllPrayers");
const closePanel = document.querySelector("#closePanel");
const reopenPanel = document.querySelector("#reopenPanel");
const expandAreaWall = document.querySelector("#expandAreaWall");
const prayerOverlay = document.querySelector("#prayerOverlay");
const overlayKicker = document.querySelector("#overlayKicker");
const overlayTitle = document.querySelector("#overlayTitle");
const overlayContent = document.querySelector("#overlayContent");
const closeOverlay = document.querySelector("#closeOverlay");

const state = {
  areas: [],
  selectedId: null,
  hoveredId: null,
  prayers: loadLocalPrayers(),
  apiReady: false,
  meshes: new Map(),
  outlines: new Map(),
  pins: new Map(),
  bounds: null,
  projection: null,
  tiltIndex: 0,
  viewTween: null,
  mediaRecorder: null,
  recordedChunks: [],
  recordedBlob: null,
  recordingStartedAt: 0,
  recordedDurationSeconds: 0,
  recordingTimer: null,
  discardingRecording: false,
  isSubmitting: false,
  pointerDown: null,
  panelDismissed: false,
  activeStreams: [],
  mapOffsetZ: 0,
};

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x071013, 30, 58);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
camera.position.set(5.2, 24, 12);
camera.zoom = 0.7;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = true;
controls.panSpeed = 0.62;
controls.screenSpacePanning = false;
controls.minZoom = 0.72;
controls.maxZoom = 1.65;
controls.minPolarAngle = 0.72;
controls.maxPolarAngle = 0.9;
controls.minAzimuthAngle = -0.28;
controls.maxAzimuthAngle = 0.28;
controls.target.set(5.2, 0, 0.35);
controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.touches.ONE = THREE.TOUCH.PAN;
controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mapGroup = new THREE.Group();
const pinGroup = new THREE.Group();
scene.add(mapGroup, pinGroup);

scene.add(new THREE.HemisphereLight(0xf9f6ec, 0x123034, 3.1));

const sun = new THREE.DirectionalLight(0xffdf9a, 3.8);
sun.position.set(-8, 14, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const rim = new THREE.DirectionalLight(0x61d9d4, 2.2);
rim.position.set(9, 6, -8);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 128),
  new THREE.MeshStandardMaterial({
    color: 0x0b1515,
    roughness: 0.92,
    metalness: 0.05,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
ground.receiveShadow = true;
scene.add(ground);

init();

window.addEventListener("resize", resize);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerleave", () => setHoveredArea(null));
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointerup", onPointerUp);
prayerForm.addEventListener("submit", onSubmitPrayer);
recordButton.addEventListener("click", toggleRecording);
discardRecording.addEventListener("click", clearRecording);
tiltButton.addEventListener("click", cycleTilt);
resetButton.addEventListener("click", resetView);
openAllPrayers.addEventListener("click", openAllPrayerWall);
closePanel.addEventListener("click", dismissPanel);
reopenPanel.addEventListener("click", showPanel);
expandAreaWall.addEventListener("click", openSelectedPrayerWall);
closeOverlay.addEventListener("click", closePrayerOverlay);
prayerOverlay.addEventListener("click", (event) => {
  if (event.target === prayerOverlay) closePrayerOverlay();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePrayerOverlay();
});

async function init() {
  const geojson = await fetchJson(dataUrl);
  state.areas = normalizeAreas(geojson);
  state.bounds = computeBounds(state.areas);
  state.projection = createProjection(state.bounds);
  totalAreas.textContent = state.areas.length;

  buildMap();
  selectArea(state.areas.find((area) => area.name === "Downtown")?.id || state.areas[0].id, false, false);
  resize();
  animate();
  hydratePrayers();

  if (window.lucide) window.lucide.createIcons();
}

function normalizeAreas(geojson) {
  return geojson.features
    .map((feature) => {
      const props = feature.properties;
      const name = props.Neighorhood || props.Neighborhood || `Area ${props.Map_ID}`;
      return {
        id: `nsa-${props.Map_ID}`,
        objectId: props.OBJECTID,
        mapId: props.Map_ID,
        name,
        score: Number(props.Overall_Score ?? 0),
        rank: Number(props.Overall_Rank ?? 0),
        population: Number(props.Population ?? 0),
        areaSqMiles: Number(props.Area_Sq_Miles ?? 0),
        density: Number(props.Pop_Density ?? 0),
        medianIncome: Number(props.Median_Household_Income ?? 0),
        geometry: feature.geometry,
      };
    })
    .sort((a, b) => a.mapId - b.mapId);
}

function buildMap() {
  state.areas.forEach((area) => {
    const color = new THREE.Color("#777777");
    const height = 0.22;
    const group = new THREE.Group();

    getPolygons(area.geometry).forEach((polygon) => {
      const shape = polygonToShape(polygon);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.012,
        bevelSegments: 1,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color,
          emissive: new THREE.Color(color).multiplyScalar(0.16),
          roughness: 0.68,
          metalness: 0.03,
        }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.areaId = area.id;
      group.add(mesh);

      const outline = makeOutline(polygon, height + 0.012);
      outline.userData.areaId = area.id;
      group.add(outline);
    });

    const centroid = projectedCentroid(area.geometry);
    const pin = makePrayerPin();
    pin.position.set(centroid.x, height + 0.22, centroid.z);
    pin.visible = getPrayers(area.id).length > 0;
    pinGroup.add(pin);

    group.userData.areaId = area.id;
    group.userData.lift = 0;
    group.userData.targetLift = 0;
    mapGroup.add(group);
    state.meshes.set(area.id, group);
    state.pins.set(area.id, pin);
  });

  addCardinalMarkers();
  updateAreaColors();
}

function polygonToShape(polygon) {
  const [outer, ...holes] = polygon;
  const shape = new THREE.Shape();
  outer.forEach((coord, index) => {
    const point = state.projection(coord);
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });

  holes.forEach((ring) => {
    const hole = new THREE.Path();
    ring.forEach((coord, index) => {
      const point = state.projection(coord);
      if (index === 0) hole.moveTo(point.x, point.y);
      else hole.lineTo(point.x, point.y);
    });
    shape.holes.push(hole);
  });

  return shape;
}

function makeOutline(polygon, height) {
  const points = polygon[0].map((coord) => {
    const point = state.projection(coord);
    return new THREE.Vector3(point.x, height, -point.y);
  });
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xf9f6ec,
    transparent: true,
    opacity: 0.28,
  });
  return new THREE.LineLoop(geometry, material);
}

function makePrayerPin() {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, 0.35, 10),
    new THREE.MeshStandardMaterial({ color: 0xf9f6ec, roughness: 0.38 }),
  );
  base.position.y = 0.16;
  const top = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 18, 18),
    new THREE.MeshStandardMaterial({
      color: 0xffc857,
      emissive: 0xffb21c,
      emissiveIntensity: 1.5,
      roughness: 0.26,
    }),
  );
  top.position.y = 0.38;
  group.add(base, top);
  return group;
}

function addCardinalMarkers() {
  const north = makeTextSprite("N");
  north.position.set(0, 0.1, -9.8);
  north.scale.set(0.45, 0.45, 1);
  scene.add(north);
}

function makeTextSprite(text) {
  const labelCanvas = document.createElement("canvas");
  const context = labelCanvas.getContext("2d");
  labelCanvas.width = 128;
  labelCanvas.height = 128;
  context.fillStyle = "rgba(12,20,22,0.7)";
  context.beginPath();
  context.arc(64, 64, 44, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(255,255,255,0.4)";
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = "#f9f6ec";
  context.font = "800 58px Inter, Segoe UI, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 64, 67);
  return new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(labelCanvas),
      transparent: true,
      depthWrite: false,
    }),
  );
}

function selectArea(id, focusForm = true, focusMap = true) {
  const area = getArea(id);
  if (!area) return;
  showPanel();
  state.selectedId = id;
  const prayers = getPrayers(id);

  selectedName.textContent = area.name;
  selectedMeta.textContent = `Area ${area.mapId} - Conditions rank ${area.rank || "N/A"}`;
  selectedScore.textContent = area.score ? area.score.toFixed(1) : "N/A";
  selectedPopulation.textContent = formatNumber(area.population);
  selectedArea.textContent = `${area.areaSqMiles.toFixed(2)} sq mi`;
  prayerCount.textContent = formatPrayerCount(prayers.length);
  renderPrayerFeed(prayers);
  updateMapState();
  updateCounts();

  if (focusMap) {
    const centroid = projectedCentroid(area.geometry);
    animateViewTo(new THREE.Vector3(centroid.x + 2.4, 0, centroid.z + state.mapOffsetZ), 760);
  }
  if (focusForm) prayerText.focus({ preventScroll: true });
}

function updateMapState() {
  state.meshes.forEach((group, id) => {
    const selected = id === state.selectedId;
    const hovered = id === state.hoveredId;
    group.userData.targetLift = selected ? 0.42 : hovered ? 0.12 : 0;
    group.children.forEach((child) => {
      if (child.isMesh) {
        child.material.emissiveIntensity = selected ? 1.05 : hovered ? 0.58 : 0.22;
        child.material.opacity = selected || hovered ? 1 : 0.92;
      }
      if (child.isLine) {
        child.material.opacity = selected ? 1 : hovered ? 0.68 : 0.22;
        child.material.color.set(selected ? 0xffffff : 0xf9f6ec);
      }
    });
  });

}

function updateCounts() {
  totalPrayers.textContent = Object.values(state.prayers).flat().length;
  state.pins.forEach((pin, id) => {
    const count = getPrayers(id).length;
    pin.visible = count > 0;
    pin.scale.setScalar(0.85 + Math.min(count, 18) * 0.04);
  });
  updateAreaColors();
}

function updateAreaColors() {
  const values = state.areas.map((area) => effectiveAreaScore(area));
  const min = Math.min(...values);
  const max = Math.max(...values);

  state.areas.forEach((area) => {
    const color = prayerScoreColor(effectiveAreaScore(area), min, max);
    const group = state.meshes.get(area.id);
    group?.children.forEach((child) => {
      if (!child.isMesh) return;
      child.material.color.copy(color);
      child.material.emissive.copy(color).multiplyScalar(0.18);
    });
  });
}

function onPointerMove(event) {
  const hitAreaId = getHitAreaId(event);
  setHoveredArea(hitAreaId, event.clientX, event.clientY);
}

function getHitAreaId(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);

  const meshes = [...state.meshes.values()].flatMap((group) => group.children.filter((child) => child.isMesh));
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit?.object.userData.areaId || null;
}

function onPointerDown(event) {
  state.pointerDown = {
    x: event.clientX,
    y: event.clientY,
    areaId: getHitAreaId(event),
  };
}

function onPointerUp(event) {
  if (!state.pointerDown) return;
  const moved = Math.hypot(event.clientX - state.pointerDown.x, event.clientY - state.pointerDown.y);
  const areaId = state.pointerDown.areaId;
  state.pointerDown = null;
  if (areaId && moved < 8) selectArea(areaId);
}

function setHoveredArea(id, x = 0, y = 0) {
  state.hoveredId = id;
  canvas.style.cursor = id ? "pointer" : "grab";
  if (id) {
    const area = getArea(id);
    hoverLabel.hidden = false;
    hoverLabel.textContent = area.name;
    hoverLabel.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  } else {
    hoverLabel.hidden = true;
  }
  updateMapState();
}

async function onSubmitPrayer(event) {
  event.preventDefault();
  const text = prayerText.value.trim();
  if (state.isSubmitting) return;
  if (!text && !state.recordedBlob) {
    setFormStatus("Write a prayer or record one first.", true);
    return;
  }
  if (!state.selectedId) return;

  state.isSubmitting = true;
  prayerForm.classList.add("is-submitting");
  setFormStatus(state.recordedBlob ? "Transcribing and reviewing prayer..." : "Reviewing prayer...");

  try {
    const area = getArea(state.selectedId);
    const audio = state.recordedBlob ? await serializeRecording() : null;
    const remote = await fetchJson(apiUrl(), {
      method: "POST",
      body: JSON.stringify({
        areaId: state.selectedId,
        areaName: area?.name || "",
        name: prayerName.value.trim() || "Anonymous",
        text,
        audio,
      }),
    });
    state.apiReady = true;
    state.prayers = remote;
    saveLocalPrayers();
    prayerName.value = "";
    prayerText.value = "";
    clearRecording();
    selectArea(state.selectedId, false);
    setFormStatus("Prayer registered.");
  } catch (error) {
    setFormStatus(error.message || "Prayer could not be registered.", true);
  } finally {
    state.isSubmitting = false;
    prayerForm.classList.remove("is-submitting");
  }
}

async function toggleRecording() {
  if (state.mediaRecorder?.state === "recording") {
    stopRecording();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setFormStatus("Audio recording is not available in this browser.", true);
    return;
  }

  clearRecording();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.activeStreams = [stream];
    state.discardingRecording = false;
    const mimeType = pickAudioMimeType();
    state.recordedChunks = [];
    state.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) state.recordedChunks.push(event.data);
    });
    state.mediaRecorder.addEventListener("stop", () => finishRecording(stream));
    state.mediaRecorder.addEventListener("error", () => {
      stopStream(stream);
      setFormStatus("Recording failed. Please try again.", true);
    });
    state.mediaRecorder.start();
    state.recordingStartedAt = Date.now();
    recordButton.classList.add("is-recording");
    recordButton.innerHTML = `<i data-lucide="square" aria-hidden="true"></i> Stop`;
    discardRecording.hidden = true;
    audioPreview.hidden = true;
    setFormStatus("Recording... limit 5 minutes.");
    updateRecordingTimer();
    state.recordingTimer = window.setInterval(updateRecordingTimer, 500);
    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    setFormStatus(microphoneErrorMessage(error), true);
  }
}

function stopRecording() {
  if (state.mediaRecorder?.state === "recording") state.mediaRecorder.stop();
}

function finishRecording(stream) {
  stopStream(stream);
  state.activeStreams = state.activeStreams.filter((activeStream) => activeStream !== stream);
  window.clearInterval(state.recordingTimer);
  state.recordingTimer = null;
  if (state.discardingRecording) {
    state.discardingRecording = false;
    state.mediaRecorder = null;
    return;
  }
  state.recordedDurationSeconds = Math.max(1, Math.ceil((Date.now() - state.recordingStartedAt) / 1000));
  const type = state.mediaRecorder?.mimeType || "audio/webm";
  state.recordedBlob = new Blob(state.recordedChunks, { type });
  if (!state.recordedBlob.size) {
    clearRecording();
    setFormStatus("No audio was captured. Please try recording again.", true);
    return;
  }
  recordButton.classList.remove("is-recording");
  recordButton.innerHTML = `<i data-lucide="mic" aria-hidden="true"></i> Re-record`;
  discardRecording.hidden = false;
  audioPreview.src = URL.createObjectURL(state.recordedBlob);
  audioPreview.hidden = false;
  setFormStatus("Recording ready. It will be transcribed before posting.");
  if (window.lucide) window.lucide.createIcons();
}

function clearRecording() {
  if (state.mediaRecorder?.state === "recording") {
    state.discardingRecording = true;
    state.mediaRecorder.stop();
  }
  state.activeStreams.forEach(stopStream);
  state.activeStreams = [];
  window.clearInterval(state.recordingTimer);
  state.recordingTimer = null;
  state.recordedChunks = [];
  state.recordedBlob = null;
  if (state.mediaRecorder?.state !== "recording") state.mediaRecorder = null;
  state.recordedDurationSeconds = 0;
  recordDuration.textContent = "0:00";
  recordButton.classList.remove("is-recording");
  recordButton.innerHTML = `<i data-lucide="mic" aria-hidden="true"></i> Record`;
  discardRecording.hidden = true;
  if (audioPreview.src) URL.revokeObjectURL(audioPreview.src);
  audioPreview.removeAttribute("src");
  audioPreview.hidden = true;
  if (window.lucide) window.lucide.createIcons();
}

function updateRecordingTimer() {
  const seconds = Math.floor((Date.now() - state.recordingStartedAt) / 1000);
  recordDuration.textContent = formatDuration(seconds);
  if (seconds >= 300) stopRecording();
}

async function serializeRecording() {
  const data = await blobToBase64(state.recordedBlob);
  return {
    data,
    mimeType: state.recordedBlob.type || "audio/webm",
    durationSeconds: Math.min(300, state.recordedDurationSeconds || 1),
    filename: `prayer-${Date.now()}.${state.recordedBlob.type.includes("mp4") ? "mp4" : "webm"}`,
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function pickAudioMimeType() {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
}

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function microphoneErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Microphone access was not granted.";
  if (error?.name === "NotFoundError") return "No microphone was found on this device.";
  if (error?.name === "NotReadableError") return "The microphone is already in use by another app.";
  return "Microphone recording is not available in this browser.";
}

function setFormStatus(message, isError = false) {
  formStatus.textContent = message;
  formStatus.classList.toggle("is-error", isError);
}

function apiUrl() {
  return "/api/prayers";
}

function renderPrayerFeed(prayers) {
  if (!prayers.length) {
    prayerFeed.innerHTML = `<div class="empty-state">No prayers registered for this area yet.</div>`;
    return;
  }
  prayerFeed.innerHTML = prayers.map(renderPrayerEntry).join("");
}

function dismissPanel() {
  state.panelDismissed = true;
  document.body.classList.add("panel-dismissed");
  reopenPanel.hidden = false;
}

function showPanel() {
  state.panelDismissed = false;
  document.body.classList.remove("panel-dismissed");
  reopenPanel.hidden = true;
}

function openSelectedPrayerWall() {
  const area = getArea(state.selectedId);
  if (!area) return;
  overlayKicker.textContent = "Neighborhood Prayer Wall";
  overlayTitle.textContent = area.name;
  overlayContent.innerHTML = renderAreaPrayerSection(area, true);
  openPrayerOverlay();
}

function openAllPrayerWall() {
  overlayKicker.textContent = "Tulsa Prayer Wall";
  overlayTitle.textContent = "All Prayers";
  const activeAreas = state.areas.filter((area) => getPrayers(area.id).length > 0);
  overlayContent.innerHTML = activeAreas.length
    ? activeAreas.map((area) => renderAreaPrayerSection(area, false)).join("")
    : `<div class="empty-state overlay-empty">No prayers registered yet.</div>`;
  openPrayerOverlay();
}

function renderAreaPrayerSection(area, selectedOnly) {
  const prayers = getPrayers(area.id);
  const entries = prayers.length
    ? prayers.map(renderPrayerEntry).join("")
    : `<div class="empty-state">No prayers registered for this area yet.</div>`;
  return `
    <section class="overlay-area ${selectedOnly ? "is-selected" : ""}">
      <header>
        <div>
          <span>Area ${area.mapId}</span>
          <h3>${escapeHtml(area.name)}</h3>
        </div>
        <strong>${formatPrayerCount(prayers.length)}</strong>
      </header>
      <div class="overlay-prayers">${entries}</div>
    </section>
  `;
}

function renderPrayerEntry(prayer) {
  return `
    <article class="prayer-entry">
      <strong>${escapeHtml(prayer.name)}</strong>
      <p>${escapeHtml(prayer.text)}</p>
      ${prayer.audioUrl ? `<audio controls preload="none" src="${escapeAttribute(prayer.audioUrl)}"></audio>` : ""}
      <time datetime="${prayer.createdAt}">${formatDate(prayer.createdAt)}</time>
    </article>
  `;
}

function openPrayerOverlay() {
  prayerOverlay.hidden = false;
  document.body.classList.add("overlay-open");
  closeOverlay.focus({ preventScroll: true });
  if (window.lucide) window.lucide.createIcons();
}

function closePrayerOverlay() {
  if (prayerOverlay.hidden) return;
  prayerOverlay.hidden = true;
  document.body.classList.remove("overlay-open");
}

async function hydratePrayers() {
  try {
    const remote = await fetchJson(apiUrl());
    state.apiReady = true;
    state.prayers = remote;
    saveLocalPrayers();
    selectArea(state.selectedId, false);
  } catch {
    state.apiReady = false;
  }
}

function fetchJson(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
    return payload;
  });
}

function getPolygons(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function computeBounds(areas) {
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  areas.forEach((area) => {
    getPolygons(area.geometry).forEach((polygon) => {
      polygon[0].forEach(([lon, lat]) => {
        bounds.minLon = Math.min(bounds.minLon, lon);
        bounds.maxLon = Math.max(bounds.maxLon, lon);
        bounds.minLat = Math.min(bounds.minLat, lat);
        bounds.maxLat = Math.max(bounds.maxLat, lat);
      });
    });
  });
  bounds.centerLon = (bounds.minLon + bounds.maxLon) / 2;
  bounds.centerLat = (bounds.minLat + bounds.maxLat) / 2;
  return bounds;
}

function createProjection(bounds) {
  const lonSpan = (bounds.maxLon - bounds.minLon) * Math.cos((bounds.centerLat * Math.PI) / 180);
  const latSpan = bounds.maxLat - bounds.minLat;
  const scale = 17 / Math.max(lonSpan, latSpan);
  const cosLat = Math.cos((bounds.centerLat * Math.PI) / 180);
  return ([lon, lat]) => ({
    x: (lon - bounds.centerLon) * cosLat * scale,
    y: (lat - bounds.centerLat) * scale,
  });
}

function projectedCentroid(geometry) {
  let biggestRing = [];
  getPolygons(geometry).forEach((polygon) => {
    if (polygon[0].length > biggestRing.length) biggestRing = polygon[0];
  });
  const sum = biggestRing.reduce(
    (acc, coord) => {
      const point = state.projection(coord);
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 },
  );
  return {
    x: sum.x / biggestRing.length,
    z: -sum.y / biggestRing.length,
  };
}

function getArea(id) {
  return state.areas.find((area) => area.id === id);
}

function getPrayers(id) {
  return state.prayers[id] || [];
}

function effectiveAreaScore(area) {
  return area.score * (10 + getPrayers(area.id).length);
}

function loadLocalPrayers() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function saveLocalPrayers() {
  localStorage.setItem(storageKey, JSON.stringify(state.prayers));
}

function mergePrayerSets(primary, secondary) {
  const merged = { ...(primary || {}) };
  Object.entries(secondary || {}).forEach(([areaId, entries]) => {
    if (!Array.isArray(entries)) return;
    const knownIds = new Set((merged[areaId] || []).map((entry) => entry.id));
    const newEntries = entries.filter((entry) => entry?.id && !knownIds.has(entry.id));
    merged[areaId] = [...newEntries, ...(merged[areaId] || [])];
  });
  return merged;
}

function prayerScoreColor(value, min, max) {
  const red = new THREE.Color("#921d32");
  const amber = new THREE.Color("#e8c85e");
  const green = new THREE.Color("#147a4f");
  const t = max === min ? 0.5 : (value - min) / (max - min);
  if (t < 0.5) return red.clone().lerp(amber, t * 2);
  return amber.clone().lerp(green, (t - 0.5) * 2);
}

function animateViewTo(target, duration) {
  state.viewTween = {
    startTime: performance.now(),
    duration,
    from: controls.target.clone(),
    to: target.clone(),
  };
}

function cycleTilt() {
  state.tiltIndex = (state.tiltIndex + 1) % 3;
  const views = [
    { position: [5.2, 24, 12], zoom: 0.7, target: [5.2, 0, 0.35] },
    { position: [5.2, 28, 5.5], zoom: 0.78, target: [5.2, 0, 0.1] },
    { position: [5.2, 21, 15], zoom: 0.68, target: [5.2, 0, 0.45] },
  ];
  const view = views[state.tiltIndex];
  camera.position.set(view.position[0], view.position[1], view.position[2] + state.mapOffsetZ);
  camera.zoom = view.zoom;
  controls.target.set(view.target[0], view.target[1], view.target[2] + state.mapOffsetZ);
  clampControlsTarget();
  camera.updateProjectionMatrix();
  controls.update();
}

function resetView() {
  state.tiltIndex = 0;
  controls.target.set(5.2, 0, 0.35 + state.mapOffsetZ);
  camera.position.set(5.2, 24, 12 + state.mapOffsetZ);
  camera.zoom = 0.7;
  clampControlsTarget();
  camera.updateProjectionMatrix();
  controls.update();
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  const aspect = width / height;
  const isMobile = width < 720;
  const frustum = isMobile ? 20.5 : 10.8;
  const mobileMapLift = isMobile ? -10.5 : 0;
  const offsetDelta = mobileMapLift - state.mapOffsetZ;
  state.mapOffsetZ = mobileMapLift;
  mapGroup.position.z = mobileMapLift;
  pinGroup.position.z = mobileMapLift;
  if (offsetDelta) {
    controls.target.z += offsetDelta;
    camera.position.z += offsetDelta;
  }
  camera.left = -frustum * aspect;
  camera.right = frustum * aspect;
  camera.top = frustum;
  camera.bottom = -frustum;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const time = performance.now() * 0.001;
  updateViewTween();
  updateAreaLift(time);
  state.pins.forEach((pin, id) => {
    if (!pin.visible) return;
    pin.children[1].position.y = 0.38 + Math.sin(time * 2.5 + id.length) * 0.035;
  });
  controls.update();
  clampControlsTarget();
  renderer.render(scene, camera);
}

function clampControlsTarget() {
  const zOffset = state.mapOffsetZ;
  const min = { x: -8.5, y: -0.05, z: -9.5 + zOffset };
  const max = { x: 10.5, y: 0.05, z: 8.8 + zOffset };
  const clamped = new THREE.Vector3(
    THREE.MathUtils.clamp(controls.target.x, min.x, max.x),
    THREE.MathUtils.clamp(controls.target.y, min.y, max.y),
    THREE.MathUtils.clamp(controls.target.z, min.z, max.z),
  );
  const delta = clamped.clone().sub(controls.target);
  if (delta.lengthSq() === 0) return;
  controls.target.copy(clamped);
  camera.position.add(delta);
}

function updateAreaLift(time) {
  state.meshes.forEach((group, id) => {
    const selectedPulse = id === state.selectedId ? Math.sin(time * 3.2) * 0.035 : 0;
    group.userData.lift += (group.userData.targetLift - group.userData.lift) * 0.14;
    group.position.y = group.userData.lift + selectedPulse;
  });
}

function updateViewTween() {
  if (!state.viewTween) return;
  const elapsed = performance.now() - state.viewTween.startTime;
  const t = Math.min(elapsed / state.viewTween.duration, 1);
  const eased = 1 - Math.pow(1 - t, 3);
  controls.target.lerpVectors(state.viewTween.from, state.viewTween.to, eased);
  if (t >= 1) state.viewTween = null;
}

function formatPrayerCount(count) {
  return `${count} ${count === 1 ? "prayer" : "prayers"}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
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
