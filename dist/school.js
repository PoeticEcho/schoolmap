const searchBox = $('search'), suggestions = $('placeResults');
let activeSchool = null, choices = [], highlighted = -1, searchTimer;
const normalize = value => value.toLowerCase().replace(/\s+/g, '');
const locationIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const schoolIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 10 10-7 10 7M4 9v12h16V9M9 21v-6h6v6"/><circle cx="12" cy="9" r="1.5"/></svg>';

// The compact map rows identify a campus by its name, level and representative point.
const campusKey = (name, level, lon, lat) => JSON.stringify([name, level, lon, lat]);
const schoolsByPoint = new Map(schoolPlaces.map(s => [campusKey(s.name,s.level,s.lo,s.la),s]));

function leaveSchool() {
  if (activeSchool) searchBox.value = '';
  activeSchool = null;
}
function hidePlaces() {
  suggestions.hidden = true;
  highlighted = -1;
  searchBox.setAttribute('aria-expanded', 'false');
  searchBox.removeAttribute('aria-activedescendant');
}
function showPlaces() {
  const query = normalize(searchBox.value);
  if (!query) { hidePlaces(); return; }
  const province = $('province').value, city = $('city').value;
  function matches(items, isSchool) {
    return items.flatMap(place => {
      if ((province && place.p !== province) || (city && place.c !== city)) return [];
      const name = isSchool ? place.name : place.d;
      const simple = normalize(name);
      const localName = isSchool && simple.startsWith(place.p) ? simple.slice(place.p.length) : simple;
      const alias = localName.replace(/초등학교|중학교|고등학교/g, x => x[0]);
      const area = isSchool ? place.address : place.id;
      const full = normalize(isSchool ? place.address+' '+name : area);
      let score = simple === query || alias === query ? 0 :
        localName.startsWith(query) || simple.startsWith(query) ? 1 :
        simple.includes(query) || alias.includes(query) ? 2 :
        (!isSchool && full.includes(query)) || (isSchool && query.length >= 3 && normalize(area.split(' ').slice(0,2).join('')+name).includes(query)) ? 3 : 9;
      if (score === 9) return [];
      return [{place, name, area, score, isSchool}];
    }).sort((a,b) => a.score-b.score || (isSchool ? 0 : a.place.nat-b.place.nat) ||
      a.name.localeCompare(b.name,'ko') || a.area.localeCompare(b.area,'ko'));
  }
  const towns = matches(D.towns,false), schools = matches(schoolPlaces,true);
  choices = [...towns.slice(0,schools.length ? 3 : 10), ...schools.slice(0,towns.length ? 9 : 12)];
  suggestions.innerHTML = choices.length ? choices.map((v,i) =>
    '<div role="option" aria-selected="false" id="place-'+i+'" data-choice="'+i+'"><span class="place-icon '+(v.isSchool?'school-icon':'')+'">'+(v.isSchool?schoolIcon:locationIcon)+'</span><span><strong>'+E(v.name)+'</strong><small>'+E(v.area)+'</small></span><span class="place-type">'+(v.isSchool?v.place.level:'동네')+'</span></div>'
  ).join('') : '<div class="place-empty">일치하는 동네·학교가 없습니다.</div>';
  highlighted = -1;
  searchBox.removeAttribute('aria-activedescendant');
  suggestions.hidden = false;
  searchBox.setAttribute('aria-expanded','true');
}
function selectPlace(place) {
  exploring = false;
  clearTimeout(searchTimer);
  hidePlaces();
  if (place.level) {
    activeSchool = buildSchool(place);

  } else {
    activeSchool = null;
    mode = 'towns';
    key = place.id;
    $('refFilter').value='';

  }
  searchBox.value = place.name || place.d;
  distance = 1000;
  shown=60;
  render();
  if (innerWidth<=800) setRanking(false);
  searchBox.blur();
}
searchBox.addEventListener('input', () => {
  if (!searchBox.value.trim()) { enterExplorer(); return; }
  exploring = true;
  activeSchool = null;
  showPlaces();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {shown=60;render();},180);
});
searchBox.addEventListener('focus', showPlaces);
searchBox.addEventListener('keydown', e => {
  if(e.isComposing || e.keyCode===229) return;
  if(e.key==='Escape'){ hidePlaces(); return; }
  if(!['ArrowDown','ArrowUp','Enter'].includes(e.key)) return;
  if(suggestions.hidden && e.key!=='Enter') showPlaces();
  if(suggestions.hidden || !choices.length) return;
  e.preventDefault();
  if(e.key==='Enter'){ selectPlace(choices[highlighted<0?0:highlighted].place); return; }
  highlighted = e.key==='ArrowDown' ? (highlighted+1)%choices.length : (highlighted<=0?choices.length-1:highlighted-1);
  suggestions.querySelectorAll('[role=option]').forEach((el,i)=>el.setAttribute('aria-selected',String(i===highlighted)));
  const item=$('place-'+highlighted);
  searchBox.setAttribute('aria-activedescendant',item.id);
  item.scrollIntoView({block:'nearest'});
});
suggestions.addEventListener('mousedown', e=>e.preventDefault());
suggestions.addEventListener('click', e=>{const item=e.target.closest('[data-choice]');if(item)selectPlace(choices[+item.dataset.choice].place);});
document.addEventListener('pointerdown', e=>{if(!e.target.closest('.searchbox'))hidePlaces();});
searchBox.addEventListener('blur', ()=>setTimeout(()=>{if(!suggestions.contains(document.activeElement))hidePlaces();},0));

function buildSchool(school) {
  const center = L.latLng(school.la,school.lo);
  function nearby(rows) {
    const found=[];
    for(const row of rows){
      const [lon,lat]=row.slice(-2);
      if(Math.abs(lat-school.la)>.011 || Math.abs(lon-school.lo)>.015)continue;
      const meters=Math.ceil(center.distanceTo([lat,lon]));
      if(meters<=1000)found.push([row[0],row[1],meters,...row.slice(3)]);
    }
    return found.sort((a,b)=>a[2]-b[2] || a[0].localeCompare(b[0],'ko'));
  }
  const otherSchools=schoolPlaces.filter(s=>s.id!==school.id && Math.abs(s.la-school.la)<.011).map(s=>[s.name,s.level,0,s.lo,s.la]);
  const a=nearby(apartmentPlaces);
  a.sort((a,b)=>nearestCluster(a).meters-nearestCluster(b).meters || a[2]-b[2]);
  return {...school,records:{a,s:nearby(otherSchools)}};
}
function showSchool() {
  const school=activeSchool;
  const distribution=schoolDistribution(school);
  const hubs=school.hubs.filter(([,meters])=>meters<=distance);
  $('detail').innerHTML='<div class="panelhead"><div class="eyebrow">'+E(school.level)+' 중심 지도</div><h2>'+E(school.name)+'</h2><div class="dim">'+E(school.address)+'</div></div>'+distribution.html+map(school)+
    '<details><summary>반경 내 학원가 '+hubs.length+'곳</summary>'+hubs.map(([id,m])=>'<div>'+E(H.get(id).name)+' · 반경 내 학원 '+fmt(distribution.perHub.get(id)||0)+'곳 · 경계까지 '+fmt(m)+'m</div>').join('')+'</details>';
  mountMap(school);
}
function schoolRings(m,school) {
  const center=[school.la,school.lo];
  m.setView(center, 15);
  let outer;
  for(const meters of [1000,500,300].filter(radius=>radius<=distance)){
    const ring=L.circle(center,{radius:meters,color:'#327ab1',weight:meters===distance?2:1,dashArray:'6 4',fillColor:'#3496dd',fillOpacity:meters===distance?.075:.035,interactive:false}).addTo(m);
    if(!outer)outer=ring;
    const top=ring.getBounds().getNorth();
    L.marker([top,school.lo],{icon:L.divIcon({className:'ring-label',html:meters===1000?'1km':meters+'m',iconSize:[40,17],iconAnchor:[20,9]}),interactive:false,keyboard:false}).addTo(m);
  }
  school.hubs.filter(([,meters])=>meters<=distance).forEach(([id])=>{
    L.geoJSON({type:'MultiPolygon',coordinates:D.maps[id].b},{style:{color:'#77378e',weight:2,fillOpacity:.30}}).bindTooltip(E(H.get(id).name)+' · 전체 학원 '+fmt(H.get(id).n)+'곳').on('click',()=>openExplorerHub(H.get(id))).addTo(m);
  });
  L.marker(center,{title:school.name,alt:school.name,icon:L.divIcon({className:'school-center',html:schoolIcon,iconSize:[28,28],iconAnchor:[14,14]}),zIndexOffset:500}).bindTooltip(E(school.name)).addTo(m);
  return outer;
}
