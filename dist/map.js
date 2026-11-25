let street, routeLayers, pending, serial=0, lastQuery=0;
const remembered=new Map();
const latLng=p=>[p[1],p[0]];
function clearMap(){
  serial++;if(pending)pending.abort();pending=null;
  if(street){lastView={center:street.getCenter(),zoom:street.getZoom()};street.remove();street=null;}
}
function map(g){
  const records=g.records||D.maps[g.id], a=records.a.filter(r=>r[2]<=distance),s=records.s.filter(r=>r[2]<=distance);
  return '<div class="toggles">'+[300,500,1000].map(m=>'<button data-range="'+m+'" class="'+(m===distance?'active':'')+'">'+(m===1000?'1km':m+'m')+'</button>').join('')+'<small>'+ (g.records?'학교 중심 직선 반경':'경계까지 직선거리')+'</small></div><div id="street" aria-label="도로 지도와 학원가"></div><div class="maplegend"><label><input id="showA" type="checkbox" checked> ● 아파트</label><label><input id="showS" type="checkbox" checked> ▲ 학교</label><span style="color:#733c98">■ 학원가 경계</span> <span class="bandkey">▧ 직선 '+(distance===1000?'1km':distance+'m')+' 이내</span></div><small id="tileNote" class="tileNote"></small><div id="routeCard" class="route-card" aria-live="polite">아파트를 누르면 '+(g.records?'학교':'학원가')+'까지의 도보 경로와 가장 가까운 학원가를 볼 수 있습니다.</div><details open><summary>아파트 '+a.length+'개 단지'+(g.records?' · 학원가 가까운 순':'')+'</summary><div class="near">'+a.map((r,i)=>'<button type="button" data-apt="'+i+'"><span>'+E(r[0])+(r.length===6?' <span class="newapt">2026 승인</span>':'')+' <small>'+E(r[1]?fmt(r[1])+'세대':'')+'</small></span><small>'+(g.records?'학교 '+fmt(r[2])+'m · 학원가 '+edgeDistance(nearestCluster(r).meters):'선택 학원가 '+edgeDistance(r[2]))+'</small></button>').join('')+'</div></details><details><summary>초·중·고 '+s.length+'곳</summary><div class="near">'+s.map(r=>'<div>'+E(r[0])+' <small>'+E(r[1])+' · '+fmt(r[2])+'m</small></div>').join('')+'</div></details>';
}
function addStreetTiles(m){
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.openstreetmap.org/fixthemap">지도 수정</a>'}).addTo(m);
 tiles.on('tileerror',()=>{if(street===m)$('tileNote').textContent='일부 배경지도 타일을 불러오지 못했습니다.'});
}
function schoolMarker(ll,name,school){
   const marker=L.marker(ll,{
     title:name,icon:L.divIcon({className:'school-point',html:'▲',iconSize:[16,16],iconAnchor:[8,8]})
   }).bindTooltip(E(name));
   if(school){
     marker.on('add',()=>marker.getElement().setAttribute('aria-label',school.name+' 중심 지도 열기'));
     marker.on('click',()=>selectPlace(school));
   }
   return marker;
}
function mountMap(g){
 const data=g.records||D.maps[g.id], m=street=L.map('street',{scrollWheelZoom:false,zoomSnap:0.25});
 addStreetTiles(m);
 const core=g.records?schoolRings(m,g):L.geoJSON({type:'MultiPolygon',coordinates:data.b},{style:{color:'#77378e',weight:2,fillOpacity:.12},interactive:false}).addTo(m);
 const apt=L.layerGroup().addTo(m),schools=L.layerGroup().addTo(m);routeLayers=L.layerGroup().addTo(m);
 const a=data.a.filter(r=>r[2]<=distance);
 const fit=core.getBounds(), markers=[];
 function point(i){selectApt(g,a[i],i,markers);}
 a.forEach((r,i)=>{let ll=latLng(r.slice(-2));fit.extend(ll);
 const marker=L.circleMarker(ll,{radius:6,color:'white',weight:1.6,fillColor:'#176c7c',fillOpacity:.92}).bindTooltip(E(r[0])).on('click',()=>point(i)).addTo(apt);markers.push(marker);});
 data.s.filter(r=>r[2]<=distance).forEach(r=>{
   const [lon,lat]=r.slice(-2), ll=[lat,lon];
   const school=schoolsByPoint.get(campusKey(r[0],r[1],lon,lat));
   fit.extend(ll);
   const marker=schoolMarker(ll,r[0],school);
   marker.addTo(schools);
 });
 m.fitBounds(fit,{padding:[16,16],maxZoom:17});let touched=false;m.on('movestart',()=>touched=true);
 if(!g.records)fetch('ranges/'+g.id+'.json').then(r=>r.json()).then(shape=>{if(street!==m)return;const band=L.geoJSON(shape[distance],{style:{color:'#327ab1',weight:2,dashArray:'6 4',fillColor:'#3496dd',fillOpacity:.16},interactive:false}).addTo(m).bringToBack();if(!touched)m.fitBounds(band.getBounds(),{padding:[6,6],maxZoom:17})}).catch(()=>{});
 $('showA').onchange=e=>e.target.checked?apt.addTo(m):m.removeLayer(apt);$('showS').onchange=e=>e.target.checked?schools.addTo(m):m.removeLayer(schools);
 document.querySelectorAll('[data-apt]').forEach((el,i)=>el.onclick=()=>point(i));
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
 routeLayers.clearLayers();document.querySelectorAll('[data-apt]').forEach((el,i)=>el.classList.toggle('selected',i===index));
 L.circleMarker(ll,{color:'#194651',weight:3,radius:10,fill:false,interactive:false}).addTo(routeLayers);if(markers[index])markers[index].openTooltip();
 const head='<strong>'+E(r[0])+'</strong>'+nearestDescription(r)+(r.length===6?'<small>'+E(r[3].date)+' 사용승인 · '+E(r[3].type)+' · K-apt</small>':''),card=$('routeCard');
 const note=g.records?'단지와 학교 대표점 인근 보행로 사이의 경로입니다. 시간은 분당 75m로 추정합니다.':'단지 대표점 인근 보행로에서 대표 학원 방향으로 이동해 처음 경계에 닿는 경로 기준입니다. 시간은 분당 75m로 추정합니다.';
 if(r[2]===0){card.innerHTML=head+(g.records?'학교 대표점까지 0m':'선택한 '+E(g.name)+' 내부 · 0m');return;}
 card.innerHTML=head+E(g.name)+'까지 보행 경로를 조회하고 있습니다…';
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
 card.innerHTML=head+'<b>도보 약 '+fmt(Math.round(length))+'m · '+Math.ceil(length/75)+'분</b>　<small>직선 '+fmt(r[2])+'m · '+E(g.name)+'</small><small>'+note+(gap>2?' 대표점에서 보행로까지 '+gap+'m는 도보 거리에서 제외했습니다.':'')+'</small>';
 }catch(err){if(token!==serial)return;card.innerHTML=head+E(g.name)+'까지 도보 경로를 확인할 수 없습니다. <small>'+(g.records?'학교':'경계')+'까지 직선 '+fmt(r[2])+'m</small><button class="retry">다시 조회</button>';card.querySelector('button').onclick=()=>selectApt(g,r,index,markers)}
 finally{clearTimeout(timer)}
}
