// script.js

// ── CONFIG ─────────────────────────────────────────────────────
const geoNamesUsername = "YOUR_GEONAMES_USERNAME"; // ← replace with your GeoNames username

// ── STATE ──────────────────────────────────────────────────────
let allTowns = [], availableTowns = [];
let currentTown = null, townBoundary = null;

let map, guessMarker, actualMarker, boundaryLayer, lineLayer;
let numPlayers = 2, currentPlayer = 0;
let numRounds = 10, currentRound = 0;
let scores = [];
let showBoundary = true, showDistance = true;

// ── UTILITIES ──────────────────────────────────────────────────
function toRad(d){ return d * Math.PI/180; }
function distanceKm(a,b,c,d){
  const R = 6371, Δφ = toRad(c-a), Δλ = toRad(d-b);
  const A = Math.sin(Δφ/2)**2 +
            Math.cos(toRad(a)) * Math.cos(toRad(c)) *
            Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
}
function updateScoreboard(){
  document.getElementById("scoreboard").innerHTML =
    scores.map((s,i)=>`Player ${i+1}: ${s.toFixed(2)} km`).join("<br>");
}
function updateRoundInfo(){
  document.getElementById("roundInfo").textContent =
    `Round ${currentRound} of ${numRounds}`;
}

// ── PICK A NEW TOWN ────────────────────────────────────────────
function pickTown(){
  if (!availableTowns.length) availableTowns = allTowns.slice();
  const idx = Math.floor(Math.random() * availableTowns.length);
  currentTown = availableTowns.splice(idx,1)[0];
  document.getElementById("townName").textContent = currentTown.name;
  townBoundary = null;

  // fetch boundary via Overpass
  const query = `
    [out:json][timeout:25];
    area["ISO3166-1"="HU"][admin_level=2]->.h;
    relation["boundary"="administrative"]["admin_level"="8"]
      ["name"="${currentTown.name}"](area.h);
    out geom;
  `;
  fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: query
  })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      const el = data.elements && data.elements[0];
      if (el && el.geometry) {
        // convert Overpass to GeoJSON
        const coords = el.geometry.map(pt => [pt.lat, pt.lon]);
        townBoundary = {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [coords] }
        };
      }
    })
    .catch(() => {
      // boundary not available or rate‐limited
      townBoundary = null;
    });
}

// ── HANDLE A GUESS ─────────────────────────────────────────────
function handleGuess(e){
  if (!currentTown || currentRound >= numRounds) return;

  // clear old layers
  [guessMarker, actualMarker, boundaryLayer, lineLayer].forEach(l=>l&&map.removeLayer(l));

  // place guess marker
  const guessed = [e.latlng.lat, e.latlng.lng];
  guessMarker = L.marker(guessed)
    .addTo(map)
    .bindPopup("Your guess")
    .openPopup();

  // place actual marker
  const actual = [+currentTown.lat, +currentTown.lng];
  actualMarker = L.marker(actual)
    .addTo(map)
    .bindPopup(`Actual: ${currentTown.name}`);

  // draw boundary if enabled
  if (showBoundary && townBoundary) {
    boundaryLayer = L.geoJSON(townBoundary, {
      style: { color:"green", fillColor:"#3f3", fillOpacity:0.2, weight:2 }
    }).addTo(map);
  }

  // draw connecting line + label
  const dist = distanceKm(guessed[0],guessed[1], actual[0],actual[1]);
  lineLayer = L.polyline([guessed, actual], { color:"red", weight:2 })
    .addTo(map)
    .bindTooltip(`${dist.toFixed(2)} km`, {
      permanent: true, direction: "center", className: "distance-label"
    });

  // zoom to include both points (and boundary)
  let bounds = L.latLngBounds(guessed, actual);
  if (boundaryLayer) bounds = bounds.extend(boundaryLayer.getBounds());
  map.fitBounds(bounds.pad(0.3));

  // feedback & scoring
  const fbEl = document.getElementById("feedback");
  if (dist <= 2) fbEl.textContent = "✅ Within town!";
  else if (showDistance) fbEl.textContent = `❌ ${dist.toFixed(2)} km off.`;
  else fbEl.textContent = "";

  if (dist > 2) scores[currentPlayer] += dist;
  currentPlayer = (currentPlayer + 1) % numPlayers;
  currentRound++;
  document.getElementById("playerNum").textContent = currentPlayer + 1;
  updateScoreboard();
  updateRoundInfo();

  // end‐of‐game check
  if (currentRound >= numRounds) {
    alert("🏁 Game over!\n" +
      scores.map((s,i)=>`Player ${i+1}: ${s.toFixed(2)} km`).join("\n")
    );
    map.off('click', handleGuess);
    return;
  }

  pickTown();
}

// ── INITIALIZATION ─────────────────────────────────────────────
function initGame(){
  // read settings
  numPlayers   = +document.getElementById("inpPlayers").value;
  numRounds    = +document.getElementById("inpRounds").value;
  showBoundary = document.getElementById("chkBoundary").checked;
  showDistance = document.getElementById("chkDistance").checked;

  scores = Array(numPlayers).fill(0);
  currentPlayer = 0;
  currentRound  = 0;
  document.getElementById("playerNum").textContent = "1";
  updateScoreboard();
  updateRoundInfo();

  if (!map) {
    map = L.map('map').setView([47,19.5],7);
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      { attribution:'&copy; CARTO', subdomains:'abcd', maxZoom:19 }
    ).addTo(map);
  }
  map.off('click', handleGuess);
  map.on('click', handleGuess);

  pickTown();
}

// ── SETTINGS UI BINDINGS ───────────────────────────────────────
document.getElementById("btnSettings").onclick = () =>
  document.getElementById("settings").classList.toggle("open");
document.getElementById("btnApply").onclick = () =>
  document.getElementById("settings").classList.remove("open");
document.getElementById("btnStart").onclick = initGame;

// ── FETCH TOWNS & PREPARE ──────────────────────────────────────
fetch(
  `https://secure.geonames.org/searchJSON` +
  `?country=HU&featureClass=P&maxRows=1000&username=${geoNamesUsername}`
)
  .then(r => r.json())
  .then(data => {
    allTowns = data.geonames.map(t => ({
      name: t.name,
      lat:  t.lat,
      lng:  t.lng
    }));
    availableTowns = allTowns.slice();
  })
  .catch(err => {
    console.error("GeoNames fetch failed:", err);
    alert("Could not load town list. Check your GeoNames username.");
  });
