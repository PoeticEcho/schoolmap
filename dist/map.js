let street, routeLayers, pending, serial=0, lastQuery=0;
const remembered=new Map();
const latLng=p=>[p[1],p[0]];
function clearMap(){
  serial++;if(pending)pending.abort();pending=null;
  if(street){lastView={center:street.getCenter(),zoom:street.getZoom()};street.remove();street=null;}
}
const schoolIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 10 10-7 10 7M4 9v12h16V9M9 21v-6h6v6"/><circle cx="12" cy="9" r="1.5"/></svg>';
const apartmentIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V8h8v13m0 0V3h8v18M2 21h20M7 12h2m-2 4h2m6-9h2m-2 4h2m-2 4h2"/></svg>';

function nearbyPanel(g) {
  const data = g.records || D.maps[g.id];
  const a = data.a.filter(row => row[2] <= distance), s = data.s.filter(row => row[2] <= distance);
  return '<div id="routeCard" class="route-card" aria-live="polite" tabindex="-1">아파트를 선택하면 ' +
    (g.records ? '학교' : '학원가') + '까지의 도보 경로를 볼 수 있습니다.</div>' +
    '<details open><summary>아파트 <span>' + fmt(a.length) + '개 단지</span></summary><div class="near">' +
    (a.map((row, index) => '<button type="button" data-apt="' + index + '"><span>' + E(row[0]) +
      (row.length === 6 ? ' <span class="newapt">2026 승인</span>' : '') +
      '<small>' + (row[1] ? fmt(row[1]) + '세대' : '') + '</small></span><small>' +
      (g.records ? '학교 ' + fmt(row[2]) + 'm · 학원가 ' + edgeDistance(nearestCluster(row).meters) : edgeDistance(row[2])) +
      '</small></button>').join('') || '<p class="dim">이 범위에 표시할 아파트가 없습니다.</p>') +
    '</div></details><details><summary>학교 <span>' + fmt(s.length) + '곳</span></summary><div class="near">' +
    (s.map((row, index) => '<button type="button" data-school="' + index + '"><span>' + E(row[0]) +
      '<small>' + E(row[1]) + '</small></span><small>' + fmt(row[2]) + 'm</small></button>').join('') ||
      '<p class="dim">이 범위에 표시할 학교가 없습니다.</p>') + '</div></details>';
}

function mapFrame(label, controls, legend) {
  $('mapPanel').innerHTML = '<div class="map-canvas"><div id="street" aria-label="' + E(label) +
    '"></div>' + (controls ? '<div class="range-controls">' + controls + '</div>' : '') +
    '<span id="tileNote" class="tile-note" role="status"></span></div><div class="maplegend">' + legend + '</div>';
}

function addStreetTiles(m) {
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(m);
  tiles.on('tileerror', () => {
    if (street === m) $('tileNote').textContent = '배경지도 일부를 불러오지 못했습니다.';
  });
}

function pointMarker(ll, name, type, center = false) {
  const size = center ? 40 : 30;
  return L.marker(ll, {
    title: name,
    alt: name,
    zIndexOffset: center ? 500 : type === 'school' ? 100 : 0,
    icon: L.divIcon({
      className: 'place-pin pin-' + type + (center ? ' pin-center' : ''),
      html: type === 'school' ? schoolIcon : apartmentIcon,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    })
  }).bindTooltip(E(name));
}

function schoolMarker(ll, name, school) {
  const marker = pointMarker(ll, name, 'school');
  if (school) marker.on('click', () => selectPlace('school', school));
  return marker;
}

function mountMap(g) {
  const data = g.records || D.maps[g.id];
  const range = distance === 1000 ? '1km' : distance + 'm';
  const controls = '<span>' + (g.records ? '학교 반경' : '학원가 경계에서') + '</span>' +
    [300, 500, 1000].map(meters => '<button type="button" data-range="' + meters + '" aria-pressed="' +
      (meters === distance) + '">' + (meters === 1000 ? '1km' : meters + 'm') + '</button>').join('');
  mapFrame(g.name + ' 주변 지도', controls,
    '<span><i class="swatch hub-swatch"></i>학원가</span><label><input id="showS" type="checkbox" checked><i class="swatch school-swatch"></i>학교</label>' +
    '<label><input id="showA" type="checkbox" checked><i class="swatch apartment-swatch"></i>아파트</label>' +
    '<span class="range-key"><i class="swatch band-swatch"></i>직선 ' + range + ' 이내</span>');
  const m = street = L.map('street', {scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 19, zoomControl: false, zoomAnimation: false});
  L.control.zoom({position: 'bottomright'}).addTo(m);
  addStreetTiles(m);
  const core = g.records ? schoolRings(m, g) : L.geoJSON({type: 'MultiPolygon', coordinates: data.b}, {
    style: {color: '#00785f', weight: 2, fillOpacity: .23}, interactive: false
  }).addTo(m);
  if (!g.records) {
    L.marker([g.la, g.lo], {
      alt: g.name + ' · 학원 ' + fmt(g.n) + '곳',
      zIndexOffset: 300,
      icon: L.divIcon({className: 'hub-pin', html: fmt(g.n), iconSize: [44, 44], iconAnchor: [22, 22]})
    }).bindTooltip(E(g.name) + ' · 학원 ' + fmt(g.n) + '곳').addTo(m);
  }
  const apartments = L.layerGroup().addTo(m), schools = L.layerGroup().addTo(m);
  routeLayers = L.layerGroup().addTo(m);
  const rows = data.a.filter(row => row[2] <= distance);
  const fit = core.getBounds(), markers = [];
  rows.forEach((row, index) => {
    const ll = latLng(row.slice(-2));
    fit.extend(ll);
    const marker = pointMarker(ll, row[0], 'apartment').on('click', () => selectApt(g, row, index, markers)).addTo(apartments);
    markers.push(marker);
  });
  const schoolRows = data.s.filter(row => row[2] <= distance);
  schoolRows.forEach((row, index) => {
    const [lon, lat] = row.slice(-2), ll = [lat, lon];
    const school = schoolsByPoint.get(campusKey(row[0], row[1], lon, lat));
    fit.extend(ll);
    schoolMarker(ll, row[0], school).addTo(schools);
    const button = $('detail').querySelector('[data-school="' + index + '"]');
    if (school) button.onclick = () => selectPlace('school', school);
    else button.disabled = true;
  });
  const compactPins = () => $('street').classList.toggle('compact-pins', m.getZoom() < 15.75);
  m.on('zoomend', compactPins);
  const padding = {paddingTopLeft: [24, 70], paddingBottomRight: [24, 26], maxZoom: 17};
  m.fitBounds(fit, padding);
  compactPins();
  let touched = false;
  m.on('movestart', () => { touched = true; });
  if (!g.records) {
    const selectedDistance = distance;
    fetch('ranges/' + g.id + '.json').then(response => {
      if (!response.ok) throw new Error('Range unavailable');
      return response.json();
    }).then(shape => {
      if (street !== m) return;
      const band = L.geoJSON(shape[selectedDistance], {
        style: {color: '#337a9f', weight: 1.5, dashArray: '5 6', fillColor: '#75bbd6', fillOpacity: .13}, interactive: false
      }).addTo(m).bringToBack();
      if (!touched) m.fitBounds(band.getBounds(), padding);
    }).catch(() => {});
  }
  $('showA').onchange = event => event.target.checked ? apartments.addTo(m) : m.removeLayer(apartments);
  $('showS').onchange = event => event.target.checked ? schools.addTo(m) : m.removeLayer(schools);
  $('detail').querySelectorAll('[data-apt]').forEach((button, index) => {
    button.onclick = () => selectApt(g, rows[index], index, markers);
  });
}
function inside(p,rings){
 const test=ring=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes};
 return rings.some(poly=>test(poly[0])&&!poly.slice(1).some(test));
}
function firstEntry(path,poly){
 const out=[path[0]],cross=(x,y,u,v)=>x*v-y*u;
 if(inside(path[0],poly))return out;
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],dx=b[0]-a[0],dy=b[1]-a[1];let best=Infinity;
  for(const part of poly)for(const ring of part)for(let j=1;j<ring.length;j++){
   const c=ring[j-1],d=ring[j],ex=d[0]-c[0],ey=d[1]-c[1],den=cross(dx,dy,ex,ey);if(Math.abs(den)<1e-17)continue;
   const t=cross(c[0]-a[0],c[1]-a[1],ex,ey)/den,u=cross(c[0]-a[0],c[1]-a[1],dx,dy)/den;
   if(t>=0&&t<=1&&u>=0&&u<=1)best=Math.min(best,t);
  }
  if(isFinite(best)){out.push([a[0]+best*dx,a[1]+best*dy]);return out}out.push(b);
 }return null;
}
async function selectApt(g,r,index,markers){
 const m=street, token=++serial;if(pending)pending.abort();
 const ctrl=pending=new AbortController(), start=r.slice(-2),ll=latLng(start),cacheKey=g.id+'/'+start.join(',');
 routeLayers.clearLayers();markers.forEach(marker=>marker.getElement()?.classList.remove('pin-selected'));document.querySelectorAll('[data-apt]').forEach((el,i)=>el.classList.toggle('selected',i===index));
 L.circleMarker(ll,{color:'#194651',weight:3,radius:10,fill:false,interactive:false}).addTo(routeLayers);if(markers[index]?.getElement()) markers[index].getElement().classList.add('pin-selected');
 const head='<strong>'+E(r[0])+'</strong>'+nearestDescription(r)+(r.length===6?'<small>'+E(r[3].date)+' 사용승인 · '+E(r[3].type)+' · K-apt</small>':''),card=$('routeCard');
 const marker=markers[index];
 const popup=marker && m.hasLayer(marker) ? L.popup({maxWidth:280,autoPan:false})
   .setLatLng(ll).setContent(document.createElement('div')).openOn(m) : null;
 function showRoute(html){
   card.innerHTML=html;
   if (!popup) return;
   const box=document.createElement('div');
   box.className='route-popup';
   box.innerHTML=html;
   const retry=box.querySelector('.retry');
   if(retry)retry.onclick=()=>selectApt(g,r,index,markers);
   popup.setContent(box);
 }
 const note=g.records?'단지와 학교 대표점 인근 보행로 사이의 경로입니다. 시간은 분당 75m로 추정합니다.':'단지 대표점 인근 보행로에서 대표 학원 방향으로 이동해 처음 경계에 닿는 경로 기준입니다. 시간은 분당 75m로 추정합니다.';
 if(r[2]===0){showRoute(head+(g.records?'학교 대표점까지 0m':'선택한 '+E(g.name)+' 내부 · 0m'));return;}
 showRoute(head+E(g.name)+'까지 보행 경로를 조회하고 있습니다…');
 let timer;
 try{
 let path=remembered.get(cacheKey);
 if(!path){
 await new Promise(res=>setTimeout(res,Math.max(0,1100-(Date.now()-lastQuery))));if(token!==serial)return;lastQuery=Date.now();
 timer=setTimeout(()=>ctrl.abort(),20000);
 const url='https://routing.openstreetmap.de/routed-foot/route/v1/foot/'+start.join(',')+';'+[g.lo,g.la].join(',')+'?overview=full&geometries=geojson&radiuses=100;150';
 const res=await fetch(url,{signal:ctrl.signal});if(!res.ok)throw Error();const d=await res.json();
 if(d.code!=='Ok')throw Error();path=g.records?d.routes[0].geometry.coordinates:firstEntry(d.routes[0].geometry.coordinates,D.maps[g.id].b);if(!path)throw Error();remembered.set(cacheKey,path);
 }
 if(token!==serial)return;
 const points=path.map(latLng),length=points.slice(1).reduce((n,v,i)=>n+m.distance(v,points[i]),0),gap=Math.round(m.distance(ll,points[0]));
 if(points.length>1){L.polyline(points,{color:'#fff',weight:8,interactive:false}).addTo(routeLayers);L.polyline(points,{color:'#00669c',weight:4,interactive:false}).addTo(routeLayers)}
 if(gap>2)L.polyline([ll,points[0]],{color:'#455868',weight:2,dashArray:'3 5',interactive:false}).addTo(routeLayers);
 L.circleMarker(points[points.length-1],{radius:5,color:'white',fillColor:'#754198',fillOpacity:1}).bindTooltip(g.records?'학교 인근 도착':'학원가 도착').addTo(routeLayers);
 m.fitBounds(L.latLngBounds([ll,...points]),{padding:[35,35],maxZoom:17});
 showRoute(head+'<b>도보 약 '+fmt(Math.round(length))+'m · '+Math.ceil(length/75)+'분</b>　<small>직선 '+fmt(r[2])+'m · '+E(g.name)+'</small><small>'+note+(gap>2?' 대표점에서 보행로까지 '+gap+'m는 도보 거리에서 제외했습니다.':'')+'</small>');
 }catch(err){if(token!==serial)return;showRoute(head+E(g.name)+'까지 도보 경로를 확인할 수 없습니다. <small>'+(g.records?'학교':'경계')+'까지 직선 '+fmt(r[2])+'m</small><button class="retry">다시 조회</button>');card.querySelector('button').onclick=()=>selectApt(g,r,index,markers)}
 finally{clearTimeout(timer)}
}
