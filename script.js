// script.js

// ── CONFIG / STATE ───────────────────────────────────────────
let allTowns = [], availableTowns = [];
let currentTown = null, townBoundary = null;
let map, guessMarker, actualMarker, boundaryLayer, guessBoundaryLayer, lineLayer;
let numPlayers = 2, currentPlayer = 0;
let numRounds = 10, currentRound = 1;
let scores = [];
let showBoundary = true, showDistance = true;
let dataLoaded = false;
let lastDist = null;  // for re-translation of feedback

// ── TRANSLATION LOADER ────────────────────────────────────────
let translations = window.translations || {};
let currentLang = 'en';

function t(key, vars = {}) {
  let str = translations[currentLang]?.[key]
         ?? translations['en']?.[key]
         ?? key;
  return str.replace(/\{\{(\w+)\}\}/g, (_, v) => vars[v] ?? '');
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    let key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  updateRoundInfo();
  updateScoreboard();
}

// ── UTILITIES ─────────────────────────────────────────────────
function toRad(d) { return d * Math.PI / 180; }
function distanceKm(a,b,c,d) {
  const R = 6371,
        Δφ = toRad(c - a),
        Δλ = toRad(d - b),
        A = Math.sin(Δφ/2)**2 +
            Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
}

function updateScoreboard() {
  document.getElementById('scoreboard').innerHTML =
    scores.map((s,i) =>
      `${t('player')} ${i+1}: ${s.toFixed(2)} km`
    ).join("<br>");
}

function updateRoundInfo() {
  document.getElementById('roundInfo').textContent =
    t('roundInfo', { current: currentRound, total: numRounds });
}

// ── LOADING OVERLAY ───────────────────────────────────────────
const loading = document.createElement('div');
loading.id = 'loadingOverlay';
loading.innerHTML = `<div class="spinner"></div><p>${t('loadingTowns')}</p>`;
Object.assign(loading.style, {
  position:'fixed', top:0, left:0, right:0, bottom:0,
  background:'rgba(0,0,0,0.5)', color:'#fff',
  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
  zIndex:10000
});
const spinner = loading.querySelector('.spinner');
Object.assign(spinner.style, {
  width:'50px', height:'50px', border:'6px solid #ccc',
  borderTop:'6px solid #fff', borderRadius:'50%', animation:'spin 1s linear infinite'
});
document.head.insertAdjacentHTML('beforeend',`
  <style>@keyframes spin{to{transform:rotate(360deg);}}</style>
`);
document.body.appendChild(loading);

function finishLoading() {
  dataLoaded = true;
  availableTowns = allTowns.slice();
  document.getElementById('btnStart').disabled = false;
  loading.style.display = 'none';
}

// ── FETCH TOWN LIST VIA OVERPASS ──────────────────────────────
const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

function tryFetchTowns(i = 0) {
  if (i >= endpoints.length) {
    alert(t('loadError'));
    return;
  }
  fetch(endpoints[i], {
    method:'POST',
    headers:{'Content-Type':'text/plain'},
    body: `
      [out:json][timeout:60];
      area["ISO3166-1"="HU"][admin_level=2]->.c;
      (
        node["place"~"city|town"](area.c);
        way["place"~"city|town"](area.c);
        relation["place"~"city|town"](area.c);
      );
      out center;
    `
  })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(data => {
    allTowns = data.elements.map(el => ({
      name: el.tags.name,
      lat: el.center?.lat ?? el.lat,
      lng: el.center?.lon ?? el.lon,
      osm_id: el.id,
      osm_type: el.type
    }));
    finishLoading();
  })
  .catch(() => tryFetchTowns(i+1));
}
tryFetchTowns();

// ── PICK A NEW TOWN & FETCH BOUNDARY ──────────────────────────
function pickTown() {
  if (!dataLoaded) return;
  if (!availableTowns.length) availableTowns = allTowns.slice();

  currentTown = availableTowns.splice(
    Math.floor(Math.random() * availableTowns.length), 1
  )[0];
  document.getElementById('townName').textContent = currentTown.name;
  townBoundary = null;

  fetch(
    `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(currentTown.name)}` +
    `&country=Hungary&format=json&polygon_geojson=1`
  )
  .then(res => res.ok ? res.json() : Promise.reject())
  .then(data => {
    if (data.length) townBoundary = { type:'Feature', geometry:data[0].geojson };
  })
  .catch(() => {});
}

// ── HANDLE GUESS ──────────────────────────────────────────────
function handleGuess(e) {
  if (!currentTown) return;
  [guessMarker, actualMarker, boundaryLayer, guessBoundaryLayer, lineLayer]
    .forEach(l => l && map.removeLayer(l));

  const guessed = [e.latlng.lat, e.latlng.lng];
  guessMarker = L.marker(guessed).addTo(map);

  fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&polygon_geojson=0` +
    `&lat=${guessed[0]}&lon=${guessed[1]}`
  )
  .then(res => res.ok ? res.json() : Promise.reject())
  .then(data => {
    const name = data.address?.town||
                 data.address?.village||
                 data.address?.city||
                 data.name||
                 'Unknown';
    guessMarker.bindPopup(
      `${t('guessed')} <strong>${name}</strong>`
    ).openPopup();
    return fetch(
      `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(name)}` +
      `&country=Hungary&format=json&polygon_geojson=1`
    );
  })
  .then(res => res.ok ? res.json() : Promise.reject())
  .then(data => {
    if (data.length && data[0].geojson) {
      guessBoundaryLayer = L.geoJSON(data[0].geojson, {
        style:{ color:'red', weight:2, fill:false }
      }).addTo(map);
    }
  })
  .catch(() => {});

  const actual = [currentTown.lat, currentTown.lng];
  actualMarker = L.marker(actual).addTo(map);
  actualMarker.bindTooltip(
    `<strong>${currentTown.name}</strong>`,
    { permanent:true, direction:'right', offset:[10,0] }
  );

  if (showBoundary && townBoundary) {
    boundaryLayer = L.geoJSON(townBoundary, {
      style:{ color:'green', fillColor:'#3f3', fillOpacity:0.2, weight:2 }
    }).addTo(map);
  }

  const dist = distanceKm(...guessed, ...actual);
  lastDist = dist;
  lineLayer = L.polyline([guessed, actual], { color:'red', weight:2 })
    .addTo(map)
    .bindTooltip(`${dist.toFixed(2)} km`, {
      permanent:true, direction:'center', className:'distance-label'
    });

  let bounds = L.latLngBounds(guessed, actual);
  if (boundaryLayer)      bounds = bounds.extend(boundaryLayer.getBounds());
  if (guessBoundaryLayer) bounds = bounds.extend(guessBoundaryLayer.getBounds());
  map.fitBounds(bounds.pad(0.3));

  const feedbackEl = document.getElementById('feedback');
  feedbackEl.textContent = dist <= 2
    ? t('withinTown')
    : (showDistance ? t('offBy', { dist: dist.toFixed(2) }) : '');

  if (dist > 2) scores[currentPlayer] += dist;

  currentPlayer = (currentPlayer + 1) % numPlayers;
  if (currentPlayer === 0) currentRound++;

  document.getElementById('playerNum').textContent = currentPlayer + 1;
  updateScoreboard();
  updateRoundInfo();

  if (currentRound > numRounds) {
    alert(
      t('gameOver') +
      "\n" +
      scores.map((s,i) => `${t('player')} ${i+1}: ${s.toFixed(2)} km`).join("\n")
    );
    map.off('click', handleGuess);
    return;
  }

  map.off('click', handleGuess);
  document.getElementById('btnNext').disabled = false;
}

// ── INITIALIZE GAME ───────────────────────────────────────────
function initGame() {
  numPlayers   = +document.getElementById('inpPlayers').value;
  numRounds    = +document.getElementById('inpRounds').value;
  showBoundary = document.getElementById('chkBoundary').checked;
  showDistance = document.getElementById('chkDistance').checked;
  currentLang  = document.getElementById('selLang').value;

  scores        = Array(numPlayers).fill(0);
  currentPlayer = 0;
  currentRound  = 1;
  document.getElementById('playerNum').textContent = '1';
  updateScoreboard();
  updateRoundInfo();
  applyTranslations();

  document.getElementById('btnNext').disabled = true;

  if (!map) {
    map = L.map('map').setView([47,19.5],7);
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      { attribution:'© CARTO', subdomains:'abcd', maxZoom:19 }
    ).addTo(map);
  }

  map.off('click', handleGuess);
  map.on('click', handleGuess);

  pickTown();
}

// ── NEXT ROUND HANDLER ────────────────────────────────────────
function nextRound() {
  [guessMarker, actualMarker, boundaryLayer, guessBoundaryLayer, lineLayer]
    .forEach(l => l && map.removeLayer(l));
  document.getElementById('feedback').textContent = '';

  document.getElementById('btnNext').disabled = true;
  applyTranslations();
  pickTown();
  map.on('click', handleGuess);
}

// ── UI BINDINGS ───────────────────────────────────────────────
document.getElementById('btnStart').onclick = initGame;
document.getElementById('btnNext').addEventListener('click', nextRound);
document.getElementById('btnSettings').onclick = () =>
  document.getElementById('settings').classList.toggle('open');
document.getElementById('btnApply').onclick = () =>
  document.getElementById('settings').classList.remove('open');

// Instant language switch
document.getElementById('selLang').addEventListener('change', e => {
  currentLang = e.target.value;
  applyTranslations();
  if (lastDist != null) {
    const feedbackEl = document.getElementById('feedback');
    feedbackEl.textContent = lastDist <= 2
      ? t('withinTown')
      : (showDistance ? t('offBy', { dist: lastDist.toFixed(2) }) : '');
  }
});

// Apply translations on load
window.addEventListener('DOMContentLoaded', applyTranslations);
