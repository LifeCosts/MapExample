// Center on Sydney, NSW
const center = [-33.8688, 151.2093];

const map = L.map('map', {
  center: center,
  zoom: 12,
  zoomControl: true,
  scrollWheelZoom: true,
  dragging: true
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// --- Reverse geocoding helper ---
async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Reverse geocode failed: ${res.status}`);
    const data = await res.json();
    const addr = data.address || {};
    const suburb = addr.suburb || addr.city_district || addr.city || addr.town || addr.village || "Unknown";
    const street = addr.road || "";
    const number = addr.house_number || "";
    const fullAddress = [number, street, suburb].filter(Boolean).join(" ");
    return { suburb, address: fullAddress };
  } catch (err) {
    console.warn("Reverse geocode error:", err);
    return { suburb: "Unavailable", address: "Unavailable" };
  }
}

// --- Throttled hover reverse geocode ---
let lastHoverLookup = 0;
let cachedHover = { suburb: "Unknown", address: "Unknown" };

async function getHoverAddress(lat, lng) {
  const now = Date.now();
  if (now - lastHoverLookup < 3000) {
    return cachedHover;
  }
  lastHoverLookup = now;
  cachedHover = await reverseGeocode(lat, lng);
  return cachedHover;
}

// --- CSV loader ---
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(v => v.replace(/\r$/, ""));
}

async function loadCSV(path) {
  console.log("Fetching CSV:", path);
  const res = await fetch(path);
  console.log("Fetch status:", res.status);
  if (!res.ok) throw new Error(`Failed to load CSV: ${res.status}`);
  const text = await res.text();
  console.log("CSV sample:", text.slice(0, 200));
  const lines = text.split(/\n/).filter(l => l.trim().length > 0);
  return lines.map(splitCsvLine);
}

// --- Increment parser ---
function parseIncrement(raw) {
  if (!raw) return null;

  console.log("Full row[3] value:", raw);

  const m = raw.match(/\{'_year':\s*([0-9.\-eE]+)\s*,/);
  if (!m) {
    console.warn("Regex failed to parse:", raw);
    return null;
  }

  const val = parseFloat(m[1]);
  console.log("Parsed float:", val);

  if (!isFinite(val)) return null;

  const percent = (val * 100).toFixed(2) + "%";
  console.log("Final percentage:", percent);
  return percent;
}

// --- Suburb stats lookup ---
function normalizeKey(str) {
  return (str || "")
    .replace(/^\uFEFF/, "")         // strip BOM
    .replace(/['"]/g, "")           // remove quotes
    .replace(/\s+/g, "_")           // replace spaces with underscores
    .trim()
    .toLowerCase();
}

async function getSuburbStats(suburbName) {
  const base = normalizeKey(suburbName);
  console.log("Looking up stats for:", suburbName, "→ normalized:", base);

  const rows = await loadCSV("https://lifecosts.github.io/suburb_growth_summary2.csv");
  const stats = { house: null, land: null, unit: null };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 4) continue;

    const key = normalizeKey(row[0]); // e.g. warrawee_house
    console.log(`Row ${i} key:`, key);

    if (key === `${base}_house`) {
      console.log("Matched HOUSE row:", row);
      stats.house = parseIncrement(row[3]);
    } else if (key === `${base}_land`) {
      console.log("Matched LAND row:", row);
      stats.land = parseIncrement(row[3]);
    } else if (key === `${base}_unit`) {
      console.log("Matched UNIT row:", row);
      stats.unit = parseIncrement(row[3]);
    }
  }

  console.log("Final stats object:", stats);
  return stats;
}

// --- Key Stats builder with links ---
async function buildKeyStatsContent(lat, lng, address = null, suburb = null, type = "suburb") {
  let statsHtml = `<h4>Key Stats</h4>`;
  const stats = suburb ? await getSuburbStats(suburb) : null;

  if (type === "address") {
    statsHtml += `
      <strong>Address:</strong> ${address}<br>
      <strong>Suburb:</strong> ${suburb}<br>
      <strong>Annual Price Increase:</strong><br>
      House: ${stats?.house || "—"}<br>
      Land: ${stats?.land || "—"}<br>
      Unit: ${stats?.unit || "—"}<br><br>
      <a href="Address_Info.html?address=${encodeURIComponent(address)}" target="_blank">More on this address</a><br>
      <a href="Suburb_Info.html?suburb=${encodeURIComponent(suburb)}" target="_blank">More on this suburb</a>
    `;
  } else {
    statsHtml += `
      <strong>Suburb:</strong> ${suburb}<br>
      <strong>Annual Price Increase:</strong><br>
      House: ${stats?.house || "—"}<br>
      Land: ${stats?.land || "—"}<br>
      Unit: ${stats?.unit || "—"}<br><br>
      <a href="Suburb_Info.html?suburb=${encodeURIComponent(suburb)}" target="_blank">More on this suburb</a>
    `;
  }
  return statsHtml;
}

// --- Info boxes ---
const infoBoxLeft = L.control({position: 'bottomleft'});
infoBoxLeft.onAdd = function () {
  const div = L.DomUtil.create('div', 'info-box-left');
  div.innerHTML = "<p>No search yet</p>";
  Object.assign(div.style, {background:"rgba(255,255,255,0.9)",padding:"8px",border:"1px solid #ccc",minWidth:"260px",margin:"10px"});
  return div;
};
infoBoxLeft.addTo(map);
function setLeftBox(content) { const div=document.querySelector('.info-box-left'); if(div) div.innerHTML=content; }

const infoBoxRight = L.control({position: 'bottomright'});
infoBoxRight.onAdd = function () {
  const div = L.DomUtil.create('div', 'info-box-right');
  div.innerHTML = "<p>Click on map to get stats</p>";
  Object.assign(div.style, {background:"rgba(255,255,255,0.9)",padding:"8px",border:"1px solid #ccc",minWidth:"260px",margin:"10px"});
  return div;
};
infoBoxRight.addTo(map);
function setRightBox(content) { const div=document.querySelector('.info-box-right'); if(div) div.innerHTML=content; }

// --- Hover tooltip ---
const mapContainer = map.getContainer();
const hoverTip = document.createElement('div');
hoverTip.className = 'hover-tip';
Object.assign(hoverTip.style, {
  position: 'absolute',
  zIndex: '1000',
  background: "rgba(255,255,255,0.95)",
  border: '1px solid #ccc',
  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  padding: '6px 8px',
  fontSize: '13px',
  pointerEvents: 'none',
  display: 'none'
});
mapContainer.style.position = mapContainer.style.position || 'relative';
mapContainer.appendChild(hoverTip);

map.on('mousemove', async (e) => {
  const lat = e.latlng.lat.toFixed(6);
  const lng = e.latlng.lng.toFixed(6);
  const zoom = map.getZoom();

  const { suburb, address } = await getHoverAddress(lat, lng);

  hoverTip.style.left = `${e.originalEvent.clientX + 20}px`;
  hoverTip.style.top = `${e.originalEvent.clientY + 20}px`;
  hoverTip.style.display = 'block';

  if (zoom >= 16) {
    hoverTip.innerHTML = `<h4>Key Stats</h4>
      <strong>Address:</strong> ${address}<br>
      <strong>Suburb:</strong> ${suburb}<br>
      Lat: ${lat}, Lng: ${lng}`;
  } else {
    hoverTip.innerHTML = `<h4>Key Stats</h4>
      <strong>Suburb:</strong> ${suburb}<br>
      Lat: ${lat}, Lng: ${lng}`;
  }
});

map.on('mouseleave', () => {
  hoverTip.style.display = 'none';
});

// --- Left-click updates bottom-right box (with reverse geocode) ---
map.on('click', async (e) => {
  const lat = e.latlng.lat.toFixed(6);
  const lng = e.latlng.lng.toFixed(6);
  const zoom = map.getZoom();
  const { suburb, address } = await reverseGeocode(lat, lng);

  if (zoom >= 16) {
    setRightBox(await buildKeyStatsContent(lat, lng, address, suburb, "address", true));
  } else {
    setRightBox(await buildKeyStatsContent(lat, lng, null, suburb, "suburb", true));
  }
});

// --- Custom address/suburb search (from working version no4) ---
function $(id) { return document.getElementById(id); }

// Hide Leaflet geocoder UI if present to avoid confusion
(function hideLeafletGeocoderIfPresent() {
  const geocoderEls = document.querySelectorAll('.leaflet-control-geocoder');
  geocoderEls.forEach(el => el.style.display = 'none');
})();

// Inject a simple search input + button under existing dropdowns
(function injectCustomSearch() {
  const controls = $('searchControls');
  if (!controls) return;
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.innerHTML = `
    <label for="searchInput" style="display:block;font-weight:bold;margin-top:6px;">Search query:</label>
    <input id="searchInput" type="text" placeholder="Try: Warrawee" style="width:100%;padding:4px;font-size:13px;" />
    <button id="searchBtn" style="margin-top:6px;width:100%;padding:6px;">Search</button>
  `;
  controls.appendChild(wrap);

  $('searchBtn').addEventListener('click', () => {
    const query = $('searchInput').value.trim();
    performSearch(query);
  });

  $('searchInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const query = $('searchInput').value.trim();
      performSearch(query);
    }
  });
})();

// Direct Nominatim search with type + mode wiring
async function nominatimSearch(query, mode, typeFilter) {
  if (!query) return null;
  let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=au&addressdetails=1&limit=5`;
  if (typeFilter) url += `&type=${typeFilter}`;

  const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const items = await res.json();
  if (!items || items.length === 0) return null;

  if (mode === "suburb") {
    const placePreferred = items.find(i =>
      /suburb|locality|neighbourhood|city|town|village/i.test(i.type || "")
    );
    return placePreferred || items[0];
  }
  return items[0];
}

// Unified search entry point (uses mode + type, updates left box with stats from no3)
async function performSearch(query) {
  const modeEl = $('searchMode');
  const typeEl = $('searchType');
  const mode = modeEl ? modeEl.value : 'address';
  const typeFilter = typeEl ? typeEl.value : '';

  if (!query) {
    setLeftBox('<p>Please enter a search query.</p>');
    return;
  }

  try {
    let centerLL;
    const direct = await nominatimSearch(query, mode, typeFilter);
    if (!direct) {
      setLeftBox(`<p>No ${mode === 'suburb' ? 'suburb' : 'address'} results found.</p>`);
      return;
    }

    centerLL = L.latLng(parseFloat(direct.lat), parseFloat(direct.lon));
    if (direct.boundingbox) {
      const bb = L.latLngBounds(
        [parseFloat(direct.boundingbox[0]), parseFloat(direct.boundingbox[2])],
        [parseFloat(direct.boundingbox[1]), parseFloat(direct.boundingbox[3])]
      );
      map.fitBounds(bb);
    } else {
      map.setView(centerLL, mode === 'suburb' ? 14 : 17);
    }

    const lat = centerLL.lat.toFixed(6);
    const lng = centerLL.lng.toFixed(6);
    const { suburb, address } = await reverseGeocode(lat, lng);

    if (mode === 'address') {
      setLeftBox(await buildKeyStatsContent(lat, lng, address, suburb, "address", true));
    } else {
      setLeftBox(await buildKeyStatsContent(lat, lng, null, suburb, "suburb", true));
    }
  } catch (err) {
    console.warn('Search error:', err);
    setLeftBox('<p>Search failed. Please try again in a moment.</p>');
  }
}

// --- Reset view button ---
const resetButton = L.control({position: 'topright'});
resetButton.onAdd = function () {
  const btn = L.DomUtil.create('button', 'reset-btn');
  btn.innerHTML = "Reset View";
  Object.assign(btn.style, {
    background: "#fff",
    padding: "5px",
    cursor: "pointer"
  });
  btn.onclick = () => map.setView(center, 12);
  return btn;
};
resetButton.addTo(map);