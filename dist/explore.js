let exploring = true, lastView = null, focusedApartment = null;
const visibleLayers = {hub: true, school: true, apartment: true};
const titles = {hub: '학원가', school: '학교', apartment: '아파트'};

function leavePlace() {
  hidePlaces();
  activeSchool = null;
  focusedApartment = null;
  searchBox.value = '';
  key = '';
  exploring = false;
  shown = 60;
}

function enterExplorer() {
  if (focusedApartment) clearMap();
  leavePlace();
  exploring = true;
  render();
  if (isCompact()) setRanking(false);
}
$('unselect').onclick = enterExplorer;

function reconcileFilters(place) {
  if ($('province').value && $('province').value !== place.p) {
    $('province').value = '';
    updateCities();
  }
  if ($('city').value && $('city').value !== place.c && !$('city').disabled) $('city').value = '';
  $('refFilter').value = '';
}

function openExplorerHub(hub) {
  leavePlace();
  reconcileFilters(hub);
  mode = 'hubs';
  distance = 1000;
  key = hub.id;
  render();
  if (isCompact()) setRanking(false);
}

function mountTownMap(town) {
  const district = town?.g || town?.c;
  const school = town && schoolPlaces.find(s => s.p === town.p && s.address.includes(district) && s.address.includes(town.d));
  const regionalHub = town && nationwideHubs.find(h => h.p === town.p && h.c === town.c);
  const point = school || regionalHub;
  mountExplorerMap({view: point && {center: [point.la, point.lo], zoom: school ? 15 : 12}});
}

const pointsByLatitude = [
  ...schoolPlaces.map(s=>({type:'school',lat:s.la,lon:s.lo,place:s})),
  ...apartmentPlaces.map(a=>({type:'apartment',lat:a.at(-1),lon:a.at(-2),place:a}))
].sort((a,b)=>a.lat-b.lat);
const hubBounds = D.hubs.map(g=>{
  const bounds=L.latLngBounds([]);
  for(const polygon of D.maps[g.id].b) for(const [lon,lat] of polygon[0]) bounds.extend([lat,lon]);
  return {type:'hub',lat:g.la,lon:g.lo,place:g,bounds};
});
function viewportPlaces(bounds) {
  const items = [];
  let low = 0, high = pointsByLatitude.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (pointsByLatitude[mid].lat < bounds.getSouth()) low = mid + 1;
    else high = mid;
  }
  for (let i = low; i < pointsByLatitude.length; i++) {
    const point = pointsByLatitude[i];
    if (point.lat > bounds.getNorth()) break;
    if (visibleLayers[point.type] && point.lon >= bounds.getWest() && point.lon <= bounds.getEast()) items.push(point);
  }
  return items;
}
function openNearestHub(apt) {
  const [name] = apt, [lon, lat] = apt.slice(-2);
  const {hub} = nearestCluster(apt);
  const index = D.maps[hub.id].a.filter(row => row[2] <= 1000)
    .findIndex(row => row[0] === name && row.at(-2) === lon && row.at(-1) === lat);
  openExplorerHub(hub);
  if (index >= 0) $('detail').querySelector('[data-apt="' + index + '"]')?.click();
}
function apartmentSummary(apt) {
  const [name, households] = apt;
  const info = [households ? fmt(households) + '세대' : '', apt.length === 6 ? '2026년 사용승인' : ''].filter(Boolean);
  return '<strong>' + E(name) + '</strong>' + (info.length ? '<div class="dim">' + info.join(' · ') + '</div>' : '') +
    nearestDescription(apt) + '<button type="button" class="popup-action">가장 가까운 학원가 보기</button>';
}
function apartmentPopup(apt) {
  const box = document.createElement('div');
  box.innerHTML = apartmentSummary(apt);
  box.querySelector('button').onclick = () => openNearestHub(apt);
  return box;
}
function showExplorer() {
  if (street && $('exploreStatus') && !focusedApartment) return;
  clearMap();
  const apt = focusedApartment;
  if (apt) {
    $('detail').innerHTML = '<div class="panelhead"><div class="eyebrow">아파트</div><h2>' + E(apt[0]) + '</h2></div>' +
      (apt[1] ? '<p class="dim">' + fmt(apt[1]) + '세대</p>' : '') + nearestDescription(apt) +
      '<button type="button" class="popup-action">가장 가까운 학원가 보기</button><p id="exploreStatus" class="dim" aria-live="polite"></p>';
    $('detail').querySelector('button').onclick = () => openNearestHub(apt);
  } else {
    $('detail').innerHTML = '<div class="panelhead"><h2>지도 자유 탐색</h2><p class="dim">지도를 움직여 주변 학교와 학원가를 찾아보세요.</p></div>' +
      '<p id="exploreStatus" class="dim" aria-live="polite"></p>';
  }
  mountExplorerMap({apartment: apt, view: lastView});
}

function mountExplorerMap({apartment, view}) {
  mapFrame('전국 자유 탐색 지도', '', Object.keys(titles).map(type =>
    '<label><input type="checkbox" data-layer="' + type + '" ' + (visibleLayers[type] ? 'checked' : '') +
    '><i class="swatch ' + type + '-swatch"></i>' + titles[type] + (type === 'hub' ? ' 경계' : '') + '</label>').join('') +
    '<small id="exploreZoomHint" hidden>확대하면 학교와 아파트가 표시됩니다.</small>');
  const m = newStreetMap();
  if (apartment) m.setView(latLng(apartment.slice(-2)), 16.5);
  else if (view) m.setView(view.center, view.zoom);
  else m.fitBounds([[33.1, 125.5], [38.6, 129.65]], {padding: [8, 8], maxZoom: 8});

  const outlines = L.layerGroup(hubBounds.map(({place}) => academyBoundary(place, () => openExplorerHub(place))));
  const markers = {apartment: placeMarkerGroup(m, 'apartment'), school: placeMarkerGroup(m, 'school')};
  const plotted = new Map();
  let selectedApartment;
  if (apartment) {
    selectedApartment = pointMarker(latLng(apartment.slice(-2)), apartment[0], 'apartment', true)
      .bindPopup(() => apartmentPopup(apartment), {autoPan: false});
    if (visibleLayers.apartment) selectedApartment.addTo(m).openPopup();
  }

  function drawPoint({type, place, lat, lon}) {
    const ll = [lat, lon];
    return type === 'school' ? schoolMarker(ll, place.name, place) :
      pointMarker(ll, place[0], 'apartment').bindPopup(() => apartmentPopup(place), {autoPan: false});
  }

  function update() {
    if (visibleLayers.hub && !m.hasLayer(outlines)) outlines.addTo(m);
    if (!visibleLayers.hub && m.hasLayer(outlines)) outlines.remove();
    if (selectedApartment) {
      if (visibleLayers.apartment && !m.hasLayer(selectedApartment)) selectedApartment.addTo(m);
      if (!visibleLayers.apartment && m.hasLayer(selectedApartment)) selectedApartment.remove();
    }

    const showPlaces = m.getZoom() >= 13;
    const bounds = m.getBounds();
    const next = new Set(showPlaces ? viewportPlaces(bounds.pad(.25)).filter(item => item.place !== apartment) : []);
    const removed = {apartment: [], school: []}, added = {apartment: [], school: []};
    for (const [item, marker] of plotted) {
      if (!next.has(item)) {
        plotted.delete(item);
        removed[item.type].push(marker);
      }
    }
    for (const item of next) {
      if (!plotted.has(item)) {
        const marker = drawPoint(item);
        plotted.set(item, marker);
        added[item.type].push(marker);
      }
    }
    for (const type of Object.keys(markers)) {
      if (removed[type].length) markers[type].removeLayers(removed[type]);
      if (added[type].length) markers[type].addLayers(added[type]);
    }

    $('exploreZoomHint').hidden = showPlaces || (!visibleLayers.school && !visibleLayers.apartment);
    const status = $('exploreStatus');
    if (!status) return;
    const counts = {
      hub: visibleLayers.hub ? hubBounds.filter(hub => bounds.intersects(hub.bounds)).length : 0,
      school: 0, apartment: 0
    };
    for (const point of next) {
      if (bounds.contains([point.lat, point.lon])) counts[point.type]++;
    }
    if (apartment && visibleLayers.apartment && bounds.contains([apartment.at(-1), apartment.at(-2)])) counts.apartment++;
    const visible = Object.keys(counts).filter(type => visibleLayers[type] && (type === 'hub' || showPlaces));
    status.textContent = visible.map(type => titles[type] + ' ' + fmt(counts[type]) + '곳').join(' · ') ||
      (Object.values(visibleLayers).some(Boolean) ? '지도를 확대해 주변 시설을 살펴보세요.' : '표시할 항목을 선택하세요.');
  }

  m.on('moveend', update);
  document.querySelectorAll('[data-layer]').forEach(input => {
    input.onchange = () => {
      visibleLayers[input.dataset.layer] = input.checked;
      update();
    };
  });
  update();
}
