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
function viewportItems(bounds){
  const items=visibleLayers.hub?hubBounds.filter(h=>bounds.intersects(h.bounds)):[];
  let low=0, high=pointsByLatitude.length;
  while(low<high){
    const mid=(low+high)>>>1;
    if(pointsByLatitude[mid].lat<bounds.getSouth())low=mid+1;else high=mid;
  }
  for(let i=low;i<pointsByLatitude.length;i++){
    const point=pointsByLatitude[i];
    if(point.lat>bounds.getNorth())break;
    if(visibleLayers[point.type] && point.lon>=bounds.getWest() && point.lon<=bounds.getEast())items.push(point);
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
  const swatches = {hub: 'hub', school: 'school', apartment: 'apartment'};
  mapFrame('전국 자유 탐색 지도', '', Object.keys(titles).map(type =>
    '<label><input type="checkbox" data-layer="' + type + '" ' + (visibleLayers[type] ? 'checked' : '') +
    '><i class="swatch ' + swatches[type] + '-swatch"></i>' + titles[type] + '</label>').join(''));
  const m = street = L.map('street', {zoomSnap: .25, minZoom: 5, maxZoom: 19, scrollWheelZoom: false, zoomControl: false, zoomAnimation: false});
  L.control.zoom({position: 'bottomright'}).addTo(m);
  addStreetTiles(m);
  if (apartment) m.setView(latLng(apartment.slice(-2)), 16.5);
  else if (view) m.setView(view.center, view.zoom);
  else m.fitBounds([[33.1, 125.5], [38.6, 129.65]], {padding: [8, 8], maxZoom: 8});
  if (apartment) {
    pointMarker(latLng(apartment.slice(-2)), apartment[0], 'apartment', true)
      .bindPopup(() => apartmentPopup(apartment), {autoPan: false}).addTo(m).openPopup();
  }
  const layer=L.layerGroup().addTo(m);
  function drawPoint(item){
    const {type,place,lat,lon}=item,ll=[lat,lon];
    if(type==='hub'){
      L.geoJSON({type:'MultiPolygon',coordinates:D.maps[place.id].b},{style:{color:'#00785f',weight:2,fillOpacity:.18}}).bindTooltip(E(place.name)).on('click',()=>openExplorerHub(place)).addTo(layer);
    }else if(type==='school'){
      schoolMarker(ll,place.name,place).addTo(layer);
    }else{
      if (place !== apartment) pointMarker(ll, place[0], 'apartment').bindPopup(() => apartmentPopup(place), {autoPan: false}).addTo(layer);
    }
  }
  function drawGroups(items,academiesOnly){
    const cells=new Map(),zoom=Math.floor(m.getZoom());
    for(const item of items){
      const pos=m.project([item.lat,item.lon],zoom);
      const key=Math.floor(pos.x/58)+','+Math.floor(pos.y/58);
      if(!cells.has(key))cells.set(key,{lat:0,lon:0,n:0});
      const cell=cells.get(key);cell.lat+=item.lat;cell.lon+=item.lon;cell.n++;cell.academies=(cell.academies||0)+(item.type==='hub'?item.place.n:0);
    }
    for(const c of cells.values()){
      const ll=[c.lat/c.n,c.lon/c.n],label=fmt(academiesOnly?c.academies:c.n),title=(academiesOnly?'밀집 학원가 내 학원 ':'시설 ')+label+'곳 · 확대';
      L.marker(ll,{title,icon:L.divIcon({className:'explore-cluster',html:label,iconSize:[46,30],iconAnchor:[23,15]})}).on('click',()=>m.setView(ll,Math.min(15,zoom+2))).addTo(layer);
    }
  }
  function update(){
    layer.clearLayers();
    const items=viewportItems(m.getBounds()), counts={hub:0,school:0,apartment:0};
    for(const item of items)counts[item.type]++;
    const grouped=m.getZoom()<14;
    $('street').classList.toggle('compact-pins', m.getZoom() < 15.75);
    if(grouped)drawGroups(visibleLayers.hub?items.filter(item=>item.type==='hub'):items,visibleLayers.hub);else items.forEach(drawPoint);
    if ($('exploreStatus')) $('exploreStatus').textContent=Object.keys(counts).filter(t=>visibleLayers[t]).map(t=>titles[t]+' '+fmt(counts[t])+'곳').join(' · ')+(items.length&&grouped?(visibleLayers.hub?'　숫자는 밀집 학원가에 속한 학원 수입니다.':'　숫자를 누르면 확대됩니다.'):'') || '표시할 항목을 선택하세요.';
  }
  let redrawTimer;
  function finishMove(){
    clearTimeout(redrawTimer);
    redrawTimer=null;
    update();
  }
  m.on('drag',()=>{
    if(!redrawTimer)redrawTimer=setTimeout(()=>{redrawTimer=null;if(street===m)update();},180);
  });
  m.on('moveend',finishMove);
  m.on('unload',()=>clearTimeout(redrawTimer));
  document.querySelectorAll('[data-layer]').forEach(el=>el.onchange=()=>{visibleLayers[el.dataset.layer]=el.checked;update();});
  update();
}
