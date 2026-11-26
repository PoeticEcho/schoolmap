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
const schoolDisclosureIndex = 'https://www.schoolinfo.go.kr/ei/ss/pneiss_a03_s0.do';
const schoolDisclosurePage = 'https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=';
const disclosureRequests = new Map();
const signedSchoolNumber = new Intl.NumberFormat('ko-KR', {signDisplay: 'exceptZero', maximumFractionDigits: 1});

function schoolDisclosures(province) {
  if (!disclosureRequests.has(province)) {
    const request = fetch('school-details/' + encodeURIComponent(province) + '.json')
      .then(response => {
        if (!response.ok) throw new Error('School disclosure unavailable');
        return response.json();
      })
      .catch(error => {
        disclosureRequests.delete(province);
        throw error;
      });
    disclosureRequests.set(province, request);
  }
  return disclosureRequests.get(province);
}

function viewSchoolProfile(school) {
  if (activeSchool?.id !== school.id) selectPlace('school', school);
  const title = $('schoolProfileTitle');
  title?.scrollIntoView({block: 'start'});
  title?.focus({preventScroll: true});
}

function schoolProfilePanel() {
  return '<section class="school-profile" aria-labelledby="schoolProfileTitle">' +
    '<div class="school-profile-head"><h3 id="schoolProfileTitle" tabindex="-1">학교 정보</h3>' +
    '<a id="schoolDisclosureLink" href="' + schoolDisclosureIndex + '" target="_blank" rel="noopener">학교알리미 ↗</a></div>' +
    '<div id="schoolProfileData" aria-live="polite"><p class="dim">학교 공시 정보를 불러오는 중…</p></div></section>';
}

function schoolProfileMetrics(profile, year, previousYear) {
  const info = [profile.establishment, profile.highSchoolType, year + '년 공시'].filter(Boolean);
  const metrics = [
    ['재학생 수', profile.students, '명'], ['학급 수', profile.classes, '개'],
    ['학급당 학생 수', profile.studentsPerClass, '명'], ['교사 수', profile.teachers, '명']
  ].filter(([, value]) => Number.isFinite(value));
  const stats = metrics.length ? '<dl class="stats">' + metrics.map(([label, value, unit]) => '<div><dt>' + label +
    '</dt><dd>' + fmt(value) + '<small>' + unit + '</small></dd></div>').join('') + '</dl>' :
    '<p class="dim">이 학교의 학생·학급 수는 공시 자료에서 확인되지 않습니다.</p>';

  let trend = '';
  if (Number.isFinite(profile.students) && Number.isFinite(profile.previousStudents)) {
    const change = profile.students - profile.previousStudents;
    const percent = profile.previousStudents > 0 ? ' (' +
      signedSchoolNumber.format(change / profile.previousStudents * 100) + '%)' : '';
    trend = '<p class="school-profile-trend"><span>' + previousYear + '년 재학생 ' + fmt(profile.previousStudents) +
      '명 대비</span><strong>' + signedSchoolNumber.format(change) + '명' + percent + '</strong></p>';
  }

  const gradeValue = (value, unit) => Number.isFinite(value) ? fmt(value) + unit : '—';
  const grades = profile.grades?.some(([students, classes]) => Number.isFinite(students) || Number.isFinite(classes)) ?
    '<details><summary>학년별 학생·학급</summary><table aria-label="학년별 학생 및 학급 수">' +
    '<thead><tr><th scope="col">학년</th><th scope="col">학생 수</th><th scope="col">학급 수</th></tr></thead><tbody>' +
    profile.grades.map(([students, classes], index) => '<tr><th scope="row">' + (index + 1) + '학년</th><td>' +
      gradeValue(students, '명') + '</td><td>' + gradeValue(classes, '개') + '</td></tr>').join('') +
    '</tbody></table></details>' : '';

  return '<p class="dim school-profile-meta">' + info.map(E).join(' · ') + '</p>' + stats + trend + grades;
}

function populateSchoolProfile(school) {
  const content = $('schoolProfileData'), link = $('schoolDisclosureLink');
  schoolDisclosures(school.p).then(({schools, year, previousYear}) => {
    if (!content.isConnected) return;
    const profile = schools[school.id];
    if (!profile) {
      content.innerHTML = '<p class="dim">학교알리미에서 학교 이름으로 공시 정보를 찾아볼 수 있습니다.</p>';
      return;
    }
    if (profile.disclosureId) {
      link.href = schoolDisclosurePage + encodeURIComponent(profile.disclosureId);
      link.setAttribute('aria-label', school.name + ' 학교알리미 공시 열기 (새 창)');
    }
    content.innerHTML = schoolProfileMetrics(profile, year, previousYear);
  }).catch(() => {
    if (content.isConnected) content.innerHTML = '<p class="dim">학교 공시 정보를 불러오지 못했습니다.</p>';
  });
}

function showSchool() {
  const school = activeSchool;
  mountMap(school, () => {
    const distribution = schoolDistribution(school);
    const hubs = school.hubs.filter(([, meters]) => meters <= distance);
    $('detail').innerHTML = '<div class="panelhead"><div class="eyebrow">' + E(school.level) + ' 중심 지도</div><h2>' +
      E(school.name) + '</h2><div class="dim">' + E(school.address) + '</div></div>' + schoolProfilePanel() +
      distribution.html + nearbyPanel(school) +
      '<details><summary>반경 내 학원가 ' + hubs.length + '곳</summary>' + hubs.map(([id, meters]) => '<div>' +
      E(H.get(id).name) + ' · 반경 내 학원 ' + fmt(distribution.perHub.get(id) || 0) +
      '곳 · 경계까지 ' + fmt(meters) + 'm</div>').join('') + '</details>';
    populateSchoolProfile(school);
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
  pointMarker(center, school.name, 'school', true).on('click', () => viewSchoolProfile(school)).addTo(layers);
  return bounds;
}
