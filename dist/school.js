let activeSchool = null;
// The compact map rows identify a campus by its name, level and representative point.
const campusKey = (name, level, lon, lat) => JSON.stringify([name, level, lon, lat]);
const schoolsByPoint = new Map(schoolPlaces.map(s => [campusKey(s.name,s.level,s.lo,s.la),s]));

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
  const school = activeSchool;
  mountMap(school, () => {
    const distribution = schoolDistribution(school);
    const hubs = school.hubs.filter(([, meters]) => meters <= distance);
    $('detail').innerHTML = '<div class="panelhead"><div class="eyebrow">' + E(school.level) + ' 중심 지도</div><h2>' +
      E(school.name) + '</h2><div class="dim">' + E(school.address) + '</div></div>' + distribution.html + nearbyPanel(school) +
      '<details><summary>반경 내 학원가 ' + hubs.length + '곳</summary>' + hubs.map(([id, meters]) => '<div>' +
      E(H.get(id).name) + ' · 반경 내 학원 ' + fmt(distribution.perHub.get(id) || 0) +
      '곳 · 경계까지 ' + fmt(meters) + 'm</div>').join('') + '</details>';
  });
}

function schoolRings(school, layers) {
  const center = [school.la, school.lo];
  let bounds;
  for (const meters of [1000, 500, 300].filter(radius => radius <= distance)) {
    const ring = L.circle(center, {
      pane: 'studyRange', radius: meters, color: '#2e6795', weight: meters === distance ? 2 : 1,
      dashArray: '6 5', fillOpacity: meters === distance ? .16 : .04, interactive: false
    }).addTo(layers);
    const edge = ring.getBounds();
    bounds ??= edge;
    L.marker([edge.getNorth(), school.lo], {
      icon: L.divIcon({className: 'ring-label', html: rangeLabel(meters), iconSize: [40, 17], iconAnchor: [20, 9]}),
      interactive: false, keyboard: false
    }).addTo(layers);
  }
  for (const [id, meters] of school.hubs) {
    if (meters <= distance) academyBoundary(H.get(id), () => openExplorerHub(H.get(id))).addTo(layers);
  }
  pointMarker(center, school.name, 'school', true).addTo(layers);
  return bounds;
}
