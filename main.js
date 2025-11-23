// Center on Wahroonga, NSW
const center = [-33.716, 151.116];

const map = L.map('map').setView(center, 13);

// Use the default OpenStreetMap tile server (reliable)
L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Add markers
L.marker(center).addTo(map).bindPopup('Wahroonga, NSW').openPopup();

const school = [-33.7096, 151.1052];
L.marker(school).addTo(map).bindPopup('Local school');
