let exploring = true, lastView = null;
const visibleLayers = {hub:true, school:true, apartment:true};
const titles = {hub:'학원가',school:'학교',apartment:'아파트'};
const symbols = {hub:'◆',school:'▲',apartment:'●'};

function enterExplorer() {
  clearTimeout(searchTimer);
  hidePlaces();
  activeSchool = null;
  searchBox.value = '';
  key = '';
  exploring = true;
  shown = 60;
  render();
  if(innerWidth<=800)setRanking(false);
}
$('unselect').onclick = enterExplorer;

function openExplorerHub(g) {
  exploring=false;
  activeSchool=null;
  searchBox.value='';
  mode='hubs';
  // A map selection can be outside the current ranking filters.
  if($('province').value && $('province').value!==g.p){$('province').value='';updateCities();}
  if($('city').value && $('city').value!==g.c)$('city').value='';
  $('refFilter').value='';
  distance=1000;
  key=g.id;
  render();
  if(innerWidth<=800)setRanking(false);
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
function apartmentPopup(apt) {
  const [name,households]=apt, [lon,lat]=apt.slice(-2);
  const box=document.createElement('div');
  const info=[households?fmt(households)+'세대':'',apt.length===6?'2026년 사용승인':''].filter(Boolean);
  box.innerHTML='<strong>'+E(name)+'</strong><div>'+info.join(' · ')+'</div>';
  box.insertAdjacentHTML('beforeend',nearestDescription(apt));
  const {hub}=nearestCluster(apt);
  const index=D.maps[hub.id].a.findIndex(r=>r[0]===name && r.at(-2)===lon && r.at(-1)===lat);
  const button=document.createElement('button');
    button.textContent=index>=0?'학원가 도보 경로':'가장 가까운 학원가 보기';
    button.onclick=()=>{openExplorerHub(hub);if(index>=0)document.querySelector('[data-apt="'+index+'"]')?.click();};
  box.append(button);
  return box;
}
function showExplorer(){
  if(street && $('exploreStatus'))return;
  clearMap();
  $('detail').innerHTML='<div class="explorehead"><h2>지도 자유 탐색</h2><div class="maplegend">'+Object.keys(titles).map(t=>'<label><input type="checkbox" data-layer="'+t+'" '+(visibleLayers[t]?'checked':'')+'> '+symbols[t]+' '+titles[t]+'</label>').join('')+'</div></div><div id="street" aria-label="전국 자유 탐색 지도"></div><div id="exploreStatus" class="dim" aria-live="polite"></div><small id="tileNote"></small>';
  const m=street=L.map('street',{zoomSnap:.25,minZoom:5,maxZoom:19,scrollWheelZoom:true});
  addStreetTiles(m);
  if(lastView)m.setView(lastView.center,lastView.zoom);
  else m.fitBounds([[33.1,125.5],[38.6,129.65]],{padding:[8,8],maxZoom:8});
  const layer=L.layerGroup().addTo(m);
  function drawPoint(item){
    const {type,place,lat,lon}=item,ll=[lat,lon];
    if(type==='hub'){
      L.geoJSON({type:'MultiPolygon',coordinates:D.maps[place.id].b},{style:{color:'#77378e',weight:2,fillOpacity:.18}}).bindTooltip(E(place.name)).on('click',()=>openExplorerHub(place)).addTo(layer);
    }else if(type==='school'){
      schoolMarker(ll,place.name,place).addTo(layer);
    }else{
      L.circleMarker(ll,{radius:6,color:'white',weight:1.6,fillColor:'#176c7c',fillOpacity:.92}).bindTooltip(E(place[0])).bindPopup(()=>apartmentPopup(place),{autoPan:false}).addTo(layer);
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
    if(grouped)drawGroups(visibleLayers.hub?items.filter(item=>item.type==='hub'):items,visibleLayers.hub);else items.forEach(drawPoint);
    $('exploreStatus').textContent=Object.keys(counts).filter(t=>visibleLayers[t]).map(t=>titles[t]+' '+fmt(counts[t])+'곳').join(' · ')+(items.length&&grouped?(visibleLayers.hub?'　숫자는 밀집 학원가에 속한 학원 수입니다.':'　숫자를 누르면 확대됩니다.'):'') || '표시할 항목을 선택하세요.';
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
