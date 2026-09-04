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

async function getCAICForecast(lat, lon) {
  const [zonesRes, productsRes] = await Promise.all([
    fetch('data/caic-zones.json'),
    fetch('data/caic-products.json')
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
  return products.find(p => p.areaId === matchingZone.id) || null;
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

  // Weather iframe + table + chart
  document.getElementById("forecast-caption").textContent = `7-Day Weather Forecast — ${loc.label}`;

  const iframe = document.getElementById("forecast-frame");
  if (iframe) iframe.src = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}&unit=0&lg=english&FcstType=graphical`;

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

  // Sentinel
  const s2Frame = document.getElementById("sentinel-frame");
  if (s2Frame) s2Frame.src = `https://browser.dataspace.copernicus.eu/?zoom=13&lat=${lat}&lng=${lon}&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS`;

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

document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.tab;
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
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
