// ── CONFIG ─────────────────────────────────────────────────────
const geoNamesUsername = "YOUR_GEONAMES_USERNAME"; // ← replace with your GeoNames username

// ── STATE ──────────────────────────────────────────────────────
let allTowns = [];        // full list from GeoNames
let availableTowns = [];  // will remove as picked
let currentTown = null;   // { name, lat, lng }
let townBoundary = null;  // GeoJSON polygon

let map, guessMarker, actualMarker, boundaryLayer, lineLayer;
let numPlayers = 2, currentPlayer = 0;
let scores = [];
let showBoundary = true, showDistance = true;

// ── UTILITIES ──────────────────────────────────────────────────
function toRad(d){ return d * Math.PI/180; }
function distanceKm(a,b,c,d){
  const R=6371, dLat=toRad(c-a), dLon=toRad(d-b);
  const A = Math.sin(dLat/2)**2 +
            Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
}
function updateScoreboard(){
  document.getElementById("scoreboard").innerHTML =
    scores.map((s,i)=>`P${i+1}: ${s.toFixed(2)} km`).join("<br>");
}

// ── PICK A NEW TOWN ────────────────────────────────────────────
function pickTown(){
  if (!availableTowns.length) {
    // reset when exhausted
    availableTowns = allTowns.slice();
  }
  const idx = Math.floor(Math.random() * availableTowns.length);
  currentTown = availableTowns.splice(idx,1)[0];
  document.getElementById("townName").textContent = currentTown.name;
  townBoundary = null;

  // fetch boundary via Overpass
  const q = `
    [out:json][timeout:25];
    area["ISO3166-1"="HU"][admin_level=2]->.h;
    relation["boundary"="administrative"]["admin_level"="8"]
      ["name"="${currentTown.name}"](area.h);
    out geom;
  `;
  fetch("https://overpass-api.de/api/interpreter", {
    method:"POST", headers:{"Content-Type":"text/plain"}, body:q
  })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      if (data.elements && data.elements[0] && data.elements[0].geometry) {
        // convert Overpass to GeoJSON
        const coords = data.elements[0].geometry.map(pt => [pt.lat, pt.lon]);
        townBoundary = { 
          "type":"Feature",
          "geometry": { "type":"Polygon", "coordinates":[coords] }
        };
      } else {
        console.warn("No boundary found for", currentTown.name);
      }
    })
    .catch(err => {
      console.warn("Boundary fetch error for", currentTown.name, err);
      townBoundary = null;
    });
}

// ── HANDLE A GUESS ─────────────────────────────────────────────
function handleGuess(e){
  if (!currentTown) return;

  // clear old layers
  [guessMarker, actualMarker, boundaryLayer, lineLayer]
    .forEach(Layer => { if(Layer) map.removeLayer(Layer); });

  // add guess marker
  const guessed = [e.latlng.lat, e.latlng.lng];
  guessMarker = L.marker(guessed)
    .addTo(map)
    .bindPopup("Your guess")
    .openPopup();

  // add actual marker
  const actual = [+currentTown.lat, +currentTown.lng];
  actualMarker = L.marker(actual)
    .addTo(map)
    .bindPopup(`Actual: ${currentTown.name}`);

  // draw boundary if available
  if (showBoundary && townBoundary) {
    boundaryLayer = L.geoJSON(townBoundary, {
      style:{ color:"green", fillColor:"#3f3", fillOpacity:0.2, weight:2 }
    }).addTo(map);
  }

  // draw line & label
  const dist = distanceKm(
    guessed[0], guessed[1],
    actual[0], actual[1]
  );
  lineLayer = L.polyline([guessed, actual], { color:"red", weight:2 })
    .addTo(map)
    .bindTooltip(`${dist.toFixed(2)} km`, {
      permanent: true, direction: "center", className: "distance-label"
    });

  // zoom to include both markers (and boundary)
  let bounds = L.latLngBounds(guessed, actual);
  if (boundaryLayer) bounds = bounds.extend(boundaryLayer.getBounds());
  map.fitBounds(bounds.pad(0.3));

  // feedback & scoring
  let fb = "";
  if (dist <= 2) fb = "✅ Within town!";
  else if (showDistance) fb = `❌ ${dist.toFixed(2)} km off.`;
  document.getElementById("feedback").textContent = fb;

  if (dist > 2) scores[currentPlayer] += dist;
  currentPlayer = (currentPlayer + 1) % numPlayers;
  document.getElementById("playerNum").textContent = currentPlayer + 1;
  updateScoreboard();

  // next round
  pickTown();
}

// ── INITIALIZATION ─────────────────────────────────────────────
function initGame(){
  // read settings
  numPlayers   = +document.getElementById("inpPlayers").value;
  showBoundary = document.getElementById("chkBoundary").checked;
  showDistance = document.getElementById("chkDistance").checked;

  scores = Array(numPlayers).fill(0);
  currentPlayer = 0;
  document.getElementById("playerNum").textContent = "1";

  if (!map) {
    map = L.map('map').setView([47,19.5],7);
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      { attribution:'&copy; CARTO', subdomains:'abcd', maxZoom:19 }
    ).addTo(map);
    map.on('click', handleGuess);
  }

  pickTown();
  updateScoreboard();
}

// ── SETTINGS UI BINDINGS ───────────────────────────────────────
document.getElementById("btnSettings").onclick = ()=>
  document.getElementById("settings").classList.toggle("open");
document.getElementById("btnApply").onclick = ()=>
  document.getElementById("settings").classList.remove("open");
document.getElementById("btnStart").onclick = initGame;

// ── FETCH TOWNS (GeoNames) & READY ─────────────────────────────
fetch(
  `http://api.geonames.org/searchJSON` +
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
