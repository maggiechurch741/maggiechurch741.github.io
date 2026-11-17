document.addEventListener('DOMContentLoaded', () => {

///////////////////////
// Location config

const LOCATIONS = {
  'cameron-pass': {
    label:         'Cameron Pass',
    coords:        '40.52°N 105.89°W · 10,276 ft',
    lat:           40.5208,
    lon:           -105.8925,
    snotelStation: '551:CO:SNTL',
    snotelName:    'Joe Wright Reservoir',
    webcamUrl:     'https://cocam.carsprogram.org/Cellular/001E00000CAM2POR-W.jpg',
  },
  'hidden-valley': {
    label:         'Hidden Valley',
    coords:        '40.40°N 105.71°W · 9,840 ft',
    lat:           40.398,
    lon:           -105.706,
    snotelStation: '322:CO:SNTL',
    snotelName:    'Bear Lake',
    webcamUrl:     null,
  },
  'allenspark': {
    label:         'Allenspark',
    coords:        '40.17°N 105.56°W · 10,540 ft',
    lat:           40.1654,
    lon:           -105.5574,
    snotelStation: '1251:CO:SNTL',
    snotelName:    'Sawtooth',
    webcamUrl:     null,
  },
};

let webcamInterval = null;
let webcamSunsetTimeout = null;

///////////////////////
// CAIC helpers

function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInMultiPolygon(lat, lon, coordinates) {
  return coordinates.some(polygon => pointInRing(lat, lon, polygon[0]));
}

async function getCAICProduct(lat, lon, zonesFile, productsFile) {
  const [zonesRes, productsRes] = await Promise.all([
    fetch(zonesFile, { cache: 'no-cache' }), fetch(productsFile, { cache: 'no-cache' }),
  ]);
  if (!zonesRes.ok || !productsRes.ok) {
    throw new Error(`Data not found — run the GitHub Action first (zones ${zonesRes.status}, products ${productsRes.status})`);
  }
  const zonesData = await zonesRes.json();
  const products  = await productsRes.json();

  const matchingZone = zonesData.features.find(f =>
    pointInMultiPolygon(lat, lon, f.geometry.coordinates)
  );
  if (!matchingZone) return null;
  // includeExpired=true can return older issues too — take the newest
  return products
    .filter(p => p.areaId === matchingZone.id)
    .sort((x, y) => new Date(y.issueDateTime) - new Date(x.issueDateTime))[0] || null;
}

const getCAICForecast = (lat, lon) =>
  getCAICProduct(lat, lon, 'data/caic-zones.json', 'data/caic-products.json');
const getCAICDiscussion = (lat, lon) =>
  getCAICProduct(lat, lon, 'data/caic-discussion-zones.json', 'data/caic-discussion-products.json');

// Photo strip for a CAIC product's media.Images
function cloudinarySized(url, width) {
  return url.replace(/^http:/, 'https:').replace('/image/upload/', `/image/upload/w_${width},c_limit,f_auto/`);
}

function photosHtml(product) {
  const images = (product.media?.Images || []).filter(img => !img.isArchived);
  if (!images.length) return '';
  const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toText = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.trim(); };
  const cards = images.map(img => {
    const caption = toText(img.caption);
    const meta = [
      img.dateTaken ? new Date(img.dateTaken).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      img.credit ? `📷 ${img.credit}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <figure class="caic-photo">
        <a href="${esc(cloudinarySized(img.url, 2000))}" target="_blank" rel="noopener">
          <img src="${esc(cloudinarySized(img.url, 600))}" alt="${esc(img.altText || caption)}" loading="lazy">
        </a>
        <figcaption>
          ${meta ? `<span class="caic-photo-meta">${esc(meta)}</span>` : ''}
          ${esc(caption)}
        </figcaption>
      </figure>`;
  }).join('');
  return `<h3>Photos</h3><div class="caic-photos">${cards}</div>`;
}

function displayDiscussion(discussion) {
  const el = document.getElementById('caic-discussion');
  if (!el) return;
  if (!discussion) { el.textContent = 'Discussion not available.'; return; }
  document.querySelector('#caic-discussion-container h2').textContent =
    discussion.publicTitle || 'CAIC Forecast Discussion';
  el.innerHTML = `
    <p class="caic-issued">Issued ${new Date(discussion.issueDateTime).toLocaleString()}</p>
    ${discussion.message || ''}
    ${photosHtml(discussion)}
  `;
}

const DANGER_COLORS = {
  low:          '#78c83f',
  moderate:     '#f7b731',
  considerable: '#f4901d',
  high:         '#e63e1a',
  extreme:      '#000000',
};

// Small rose per avalanche problem — highlights specific aspect/elevation segments
function drawProblemRose(aspectElevations) {
  const cx = 70, cy = 70, size = 140;
  const rings   = { alp: [44, 60], tln: [28, 43], btl: [13, 27] };
  const aspects = ['n','ne','e','se','s','sw','w','nw'];

  function seg(r1, r2, i) {
    const toR = d => (d - 90) * Math.PI / 180;
    const start = i * 45 - 22.5 + 1.5, end = i * 45 + 22.5 - 1.5;
    const a1 = toR(start), a2 = toR(end);
    const x1 = cx + r1*Math.cos(a1), y1 = cy + r1*Math.sin(a1);
    const x2 = cx + r2*Math.cos(a1), y2 = cy + r2*Math.sin(a1);
    const x3 = cx + r2*Math.cos(a2), y3 = cy + r2*Math.sin(a2);
    const x4 = cx + r1*Math.cos(a2), y4 = cy + r1*Math.sin(a2);
    return `M${x1},${y1} L${x2},${y2} A${r2},${r2} 0 0,1 ${x3},${y3} L${x4},${y4} A${r1},${r1} 0 0,0 ${x1},${y1}Z`;
  }

  let paths = '';
  Object.entries(rings).forEach(([elev, [r1, r2]]) => {
    aspects.forEach((asp, i) => {
      const key = `${asp}_${elev}`;
      const active = aspectElevations.includes(key);
      paths += `<path d="${seg(r1, r2, i)}" fill="${active ? '#e07b39' : '#e8ecf0'}" stroke="white" stroke-width="0.5"/>`;
    });
  });

  let labels = '';
  ['N','NE','E','SE','S','SW','W','NW'].forEach((asp, i) => {
    const angle = (i * 45 - 90) * Math.PI / 180;
    const r = 68;
    labels += `<text x="${cx + r*Math.cos(angle)}" y="${cy + r*Math.sin(angle)}"
      text-anchor="middle" dominant-baseline="middle"
      font-size="7" font-family="system-ui" fill="#6b7a8d">${asp}</text>`;
  });

  return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:${size}px">
    ${paths}${labels}
    <circle cx="${cx}" cy="${cy}" r="12" fill="white" stroke="#ddd" stroke-width="0.5"/>
  </svg>`;
}

function drawDangerRose(forecast) {
  const today = forecast.dangerRatings?.days[0];
  if (!today) return '';

  const cx = 120, cy = 120;
  const rings = [
    { key: 'btl', label: 'BTL', r1: 28, r2: 55 },
    { key: 'tln', label: 'TLN', r1: 57, r2: 84 },
    { key: 'alp', label: 'ALP', r1: 86, r2: 113 },
  ];
  const aspects = ['N','NE','E','SE','S','SW','W','NW'];

  function seg(cx, cy, r1, r2, startDeg, endDeg) {
    const toR = d => (d - 90) * Math.PI / 180;
    const a1 = toR(startDeg), a2 = toR(endDeg);
    const x1 = cx + r1*Math.cos(a1), y1 = cy + r1*Math.sin(a1);
    const x2 = cx + r2*Math.cos(a1), y2 = cy + r2*Math.sin(a1);
    const x3 = cx + r2*Math.cos(a2), y3 = cy + r2*Math.sin(a2);
    const x4 = cx + r1*Math.cos(a2), y4 = cy + r1*Math.sin(a2);
    return `M${x1},${y1} L${x2},${y2} A${r2},${r2} 0 0,1 ${x3},${y3} L${x4},${y4} A${r1},${r1} 0 0,0 ${x1},${y1}Z`;
  }

  let paths = '';
  rings.forEach(({ key, r1, r2 }) => {
    const color = DANGER_COLORS[today[key]] || '#ccc';
    aspects.forEach((_, i) => {
      const start = i * 45 - 22.5 + 1;
      const end   = i * 45 + 22.5 - 1;
      paths += `<path d="${seg(cx, cy, r1, r2, start, end)}" fill="${color}" stroke="white" stroke-width="1"/>`;
    });
  });

  let labels = '';
  aspects.forEach((asp, i) => {
    const angle = (i * 45 - 90) * Math.PI / 180;
    const r = 128;
    labels += `<text x="${cx + r*Math.cos(angle)}" y="${cy + r*Math.sin(angle)}"
      text-anchor="middle" dominant-baseline="middle"
      font-size="11" font-weight="${asp === 'N' ? 'bold' : 'normal'}"
      font-family="system-ui">${asp}</text>`;
  });

  let elevLabels = '';
  rings.forEach(({ key, label, r1, r2 }) => {
    const r = (r1 + r2) / 2;
    const textColor = (today[key] === 'high' || today[key] === 'extreme') ? '#fff' : '#000';
    elevLabels += `<text x="${cx}" y="${cy - r}"
      text-anchor="middle" dominant-baseline="middle"
      font-size="9" fill="${textColor}" font-family="system-ui">${label}</text>`;
  });

  return `<svg viewBox="0 0 240 240" style="width:100%;max-width:240px;display:block;margin:0 auto">
    ${paths}${labels}${elevLabels}
    <circle cx="${cx}" cy="${cy}" r="26" fill="white" stroke="#ddd" stroke-width="1"/>
  </svg>`;
}

function displayForecastInfo(forecast) {
  const container = document.getElementById('caic-forecast');
  if (!container) return;

  const today = forecast.dangerRatings?.days[0];
  const date  = today ? new Date(today.date).toLocaleDateString() : '';

  const problems = forecast.avalancheProblems?.days[0] || [];
  const problemsHtml = problems.length
    ? problems.map(p => `
        <div style="margin-bottom:0.75rem">
          <strong style="text-transform:capitalize">${p.type?.replace(/([A-Z])/g, ' $1').trim() || '—'}</strong>
          <span style="color:#9aa5b4; font-size:0.8rem; margin-left:0.5rem">
            ${p.likelihood || ''} · size ${p.expectedSize?.min}–${p.expectedSize?.max}
          </span>
          ${drawProblemRose(p.aspectElevations || [])}
        </div>`).join('')
    : '<p>No specific avalanche problems listed.</p>';

  const rawSummary = forecast.avalancheSummary?.days[0]?.content || '';
  const summaryEl = document.createElement('div');
  summaryEl.innerHTML = rawSummary;
  summaryEl.querySelectorAll('p').forEach(p => {
    if (p.textContent.includes('McCammon')) p.remove();
  });

  container.innerHTML = `
    <p style="font-size:0.82rem; color:#9aa5b4;">
      Issued ${new Date(forecast.issueDateTime).toLocaleString()} &mdash;
      expires ${new Date(forecast.expiryDateTime).toLocaleString()}
    </p>
    <h3>Danger for ${date}</h3>
    ${drawDangerRose(forecast)}
    <h3>Avalanche Problems</h3>
    ${problemsHtml}
    <h3>Summary</h3>
    ${summaryEl.innerHTML}
    ${photosHtml(forecast)}
  `;
}

///////////////////////
// Weather forecast

async function get_weather_forcast(lat, lon) {
  const pointsRes  = await fetch(`https://api.weather.gov/points/${lat},${lon}`);
  const pointsData = await pointsRes.json();
  const forecastRes = await fetch(pointsData.properties.forecast);
  return await forecastRes.json();
}


///////////////////////
// Webcam

function setupWebcam(lat, lon, webcamUrl) {
  // Clear any existing refresh
  if (webcamInterval)     clearInterval(webcamInterval);
  if (webcamSunsetTimeout) clearTimeout(webcamSunsetTimeout);

  const webcam     = document.getElementById("cameron-webcam");
  const webcamTime = document.getElementById("webcam-time");
  const section    = document.getElementById("webcam");

  const webcamSection = document.getElementById('webcam');
  if (!webcamUrl) {
    webcamSection.style.display = 'none';
    return;
  }

  webcamSection.style.display = '';
  webcam.style.display = '';
  const sunset = SunCalc.getTimes(new Date(), lat, lon).sunset;
  const now    = new Date();

  function refreshWebcam() {
    webcam.src = `${webcamUrl}?t=${Date.now()}`;
    webcamTime.textContent = `Webcam fetched at ${new Date().toLocaleTimeString()}`;
  }

  refreshWebcam();

  if (now < sunset) {
    webcamInterval = setInterval(refreshWebcam, 60_000);
    webcamSunsetTimeout = setTimeout(() => {
      clearInterval(webcamInterval);
      webcamTime.textContent += " (frozen at sunset)";
    }, sunset - now);
  } else {
    webcamTime.textContent += " (frozen at sunset)";
  }
}

///////////////////////
// SNOTEL

async function getSnotelData(station) {
  const id = station.split(':')[0];
  const res = await fetch(`data/snotel-${id}.json`);
  return { snowDepth: await res.json() };
}

let snotelChart;

function displaySnotel(data) {
  const container = document.getElementById("snotel");
  if (!container) return;

  const depthValues = data.snowDepth[0].data[0].values;
  const vals = depthValues.map(v => v.value);

  const currentDepth = vals[vals.length - 1];
  const snow24 = Math.max(0, vals[vals.length - 1] - vals[vals.length - 2]);
  const snow48 = Math.max(0, vals[vals.length - 1] - vals[vals.length - 3]);

  container.innerHTML = `
    <p><strong>Current Snow Depth:</strong> ${currentDepth} in</p>
    <p><strong>New Snow (24h):</strong> ${snow24} in</p>
    <p><strong>New Snow (48h):</strong> ${snow48} in</p>
  `;

  const dates = depthValues.map(v =>
    new Date(v.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  );

  if (snotelChart) snotelChart.destroy();
  snotelChart = new Chart(document.getElementById("snotel-chart"), {
    type: "line",
    data: {
      labels: dates,
      datasets: [{
        label: "Snow Depth (in)",
        data: vals,
        borderColor: "steelblue",
        backgroundColor: "rgba(70,130,180,0.15)",
        fill: true,
        pointRadius: 0,
        tension: 0.3
      }]
    },
    options: {
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        y: { min: 0, title: { display: true, text: "inches" } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

///////////////////////
// Sentinel-2 map — imagery is pre-clipped by .github/scripts/fetch_sentinel.py
// (data/sentinel/manifest.json); routes come from data/routes/<location>.geojson
// if present, plus any GPX/GeoJSON the viewer drops on the map.

let s2Map = null;
let s2Image = null;
let s2Routes = null;
let s2Manifest = null;

const ROUTE_STYLE = { color: '#ff3b30', weight: 3, opacity: 0.9 };

function copernicusUrl(lat, lon) {
  const now  = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return `https://browser.dataspace.copernicus.eu/?zoom=13&lat=${lat}&lng=${lon}&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS&fromTime=${from.toISOString()}&toTime=${now.toISOString()}`;
}

function gpxToGeoJSON(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const toCoords = pts => [...pts].map(p => [+p.getAttribute('lon'), +p.getAttribute('lat')]);
  const features = [];
  doc.querySelectorAll('trkseg').forEach(seg => features.push(toCoords(seg.querySelectorAll('trkpt'))));
  doc.querySelectorAll('rte').forEach(rte => features.push(toCoords(rte.querySelectorAll('rtept'))));
  return {
    type: 'FeatureCollection',
    features: features.filter(c => c.length > 1).map(c => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c },
    })),
  };
}

function addRoutes(geojson) {
  const layer = L.geoJSON(geojson, {
    style: ROUTE_STYLE,
    onEachFeature: (f, l) => f.properties?.name && l.bindTooltip(f.properties.name),
  });
  layer.addTo(s2Routes);
  return layer;
}

function initSentinelMap() {
  s2Map = L.map('sentinel-map', { zoomSnap: 0.25 });
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: 'Map © OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors',
  }).addTo(s2Map);
  s2Routes = L.featureGroup().addTo(s2Map);
  L.control.layers({ 'Topo': topo }, { 'Routes': s2Routes }, { collapsed: true }).addTo(s2Map);

  document.getElementById('sentinel-opacity').addEventListener('input', e => {
    if (s2Image) s2Image.setOpacity(+e.target.value);
  });

  // Drag-and-drop GPX / GeoJSON
  const el = document.getElementById('sentinel-map');
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('dragging'); });
  el.addEventListener('dragleave', () => el.classList.remove('dragging'));
  el.addEventListener('drop', async e => {
    e.preventDefault();
    el.classList.remove('dragging');
    for (const file of e.dataTransfer.files) {
      const text = await file.text();
      try {
        const gj = /\.gpx$/i.test(file.name) ? gpxToGeoJSON(text) : JSON.parse(text);
        const layer = addRoutes(gj);
        if (layer.getLayers().length) s2Map.fitBounds(layer.getBounds(), { padding: [20, 20] });
      } catch (err) {
        alert(`Couldn't read ${file.name}: ${err.message}`);
      }
    }
  });
}

function showScene(locKey, scene) {
  const loc = s2Manifest.locations[locKey];
  if (s2Image) s2Map.removeLayer(s2Image);
  s2Image = L.imageOverlay(`data/sentinel/${scene.file}`, loc.bounds, {
    opacity: +document.getElementById('sentinel-opacity').value,
    attribution: 'Contains modified Copernicus Sentinel data',
  }).addTo(s2Map);
  s2Routes.bringToFront();
  document.querySelectorAll('#sentinel-dates button').forEach(b =>
    b.classList.toggle('active', b.dataset.date === scene.date));
  const daysAgo = Math.round((Date.now() - new Date(scene.date + 'T18:00:00Z')) / 864e5);
  document.getElementById('sentinel-meta').textContent =
    `${scene.date} (${daysAgo} day${daysAgo === 1 ? '' : 's'} ago) · ${Math.round(scene.local_cloud * 100)}% cloud in view` +
    (scene.local_cloud > 0.25 ? ' — no clearer recent pass' : '');
}

async function loadSentinel(locKey, loc) {
  if (!s2Map) initSentinelMap();
  document.getElementById('sentinel-copernicus').href = copernicusUrl(loc.lat, loc.lon);
  s2Routes.clearLayers();
  const datesEl = document.getElementById('sentinel-dates');
  datesEl.innerHTML = '';

  if (!s2Manifest) {
    try {
      const r = await fetch('data/sentinel/manifest.json');
      s2Manifest = r.ok ? await r.json() : null;
    } catch { s2Manifest = null; }
  }
  const entry = s2Manifest?.locations?.[locKey];
  if (entry) {
    s2Map.fitBounds(entry.bounds);
  } else {
    s2Map.setView([loc.lat, loc.lon], 13);
  }
  if (!entry || !entry.scenes.length) {
    if (s2Image) { s2Map.removeLayer(s2Image); s2Image = null; }
    document.getElementById('sentinel-meta').textContent = s2Manifest
      ? 'No Sentinel-2 imagery found for this location in the last 45 days.'
      : 'Imagery not fetched yet — run the "Fetch Sentinel-2 imagery" GitHub Action.';
  } else {
    entry.scenes.forEach(scene => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'date-button';
      b.dataset.date = scene.date;
      b.textContent = scene.date.slice(5);
      b.onclick = () => showScene(locKey, scene);
      datesEl.appendChild(b);
    });
    showScene(locKey, entry.scenes[0]);
  }

  // Saved routes for this location (optional file)
  fetch(`data/routes/${locKey}.geojson`)
    .then(r => (r.ok ? r.json() : null))
    .then(gj => gj && addRoutes(gj))
    .catch(() => {});
}

///////////////////////
// Load a location

function loadLocation(loc) {
  const { lat, lon, snotelStation, snotelName, webcamUrl } = loc;

  // Update SNOTEL heading
  document.querySelector('#snotel-container h2').textContent = `SNOTEL — ${snotelName}`;
  document.getElementById('location-info').textContent = `${loc.label} · ${loc.coords}`;

  // CAIC
  getCAICForecast(lat, lon)
    .then(f => f ? displayForecastInfo(f) : (document.getElementById('caic-forecast').textContent = 'Forecast not available.'))
    .catch(err => { document.getElementById('caic-forecast').textContent = `Error: ${err.message}`; });
  getCAICDiscussion(lat, lon)
    .then(displayDiscussion)
    .catch(err => { document.getElementById('caic-discussion').textContent = `Error: ${err.message}`; });

  // Weather iframe + table + chart
  document.getElementById("forecast-caption").textContent = `7-Day Weather Forecast — ${loc.label}`;

  const iframe = document.getElementById("forecast-frame");
  if (iframe) {
    // Cross-origin iframe can't be scrolled directly, so it renders at full
    // height inside a scroll box; start the box at the graph (~570px down).
    const box = document.getElementById("forecast-scroll");
    iframe.onload = () => { if (box) box.scrollTop = 570; };
    iframe.src = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}&unit=0&lg=english&FcstType=graphical`;
  }

  get_weather_forcast(lat, lon).then(data => {
    const tbody = document.querySelector('#forecast tbody');
    if (tbody) {
      tbody.innerHTML = "";
      data.properties.periods.forEach(period => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${period.name}</td>
          <td>${period.temperature}°F</td>
          <td>${period.shortForecast}</td>
          <td><img src="${period.icon}" alt="${period.shortForecast}"></td>
        `;
        tbody.appendChild(row);
      });
    }
  });

  // Sentinel-2 map
  const locKey = Object.keys(LOCATIONS).find(k => LOCATIONS[k] === loc);
  loadSentinel(locKey, loc);

  // Webcam
  setupWebcam(lat, lon, webcamUrl);

  // SNOTEL
  getSnotelData(snotelStation)
    .then(displaySnotel)
    .catch(err => { document.getElementById('snotel').textContent = `Error: ${err.message}`; });
}

///////////////////////
// Page title

document.querySelector("h1").textContent = "Avalanche Conditions";

///////////////////////
// Weather tab switching (Chart / Table)

document.querySelectorAll('.tabs .tab-button').forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.tab;
    document.querySelectorAll('.tabs .tab-button').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === target);
    });
  });
});

///////////////////////
// Location tab switching — build tabs from LOCATIONS config

const tabNav = document.getElementById('location-tabs');
Object.entries(LOCATIONS).forEach(([key, loc], i) => {
  const btn = document.createElement('button');
  btn.className = 'location-tab' + (i === 0 ? ' active' : '');
  btn.dataset.location = key;
  btn.textContent = loc.label;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.location-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    loadLocation(loc);
  });
  tabNav.appendChild(btn);
});

///////////////////////
// Initial load

loadLocation(LOCATIONS['cameron-pass']);

});
