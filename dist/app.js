const $ = id => document.getElementById(id);
const D = JSON.parse($('payload').textContent);
const fmt = n => Number(n).toLocaleString('ko-KR');
const E = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const H = new Map(D.hubs.map(hub => [hub.id, hub]));
const townIndex = new Map(D.towns.map(town => [town.id, town]));
const nationwideHubs = [...D.hubs].sort((a, b) => a.nat - b.nat || a.id.localeCompare(b.id));
const featured = nationwideHubs.slice(0, 30);

let mode = 'hubs', shown = 60, key = '', distance = 1000, results = [];

function options(values, label) {
  return '<option value="">' + label + '</option>' + [...new Set(values)].sort()
    .map(value => '<option>' + E(value) + '</option>').join('');
}

$('province').innerHTML = options(D.towns.map(town => town.p), '전국');
function updateCities() {
  const province = $('province').value;
  const city = $('city');
  city.innerHTML = options(D.towns.filter(town => town.p === province).map(town => town.c), '도시 전체');
  city.disabled = !province || city.options.length < 3;
  if (province && city.options.length === 2) city.selectedIndex = 1;
}

function renderRanking() {
  const province = $('province').value, city = $('city').value;
  const isHub = mode === 'hubs', history = mode === 'history';
  $('refFilter').disabled = history;
  const ref = history ? '' : $('refFilter').value;
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });

  results = (isHub ? nationwideHubs : D.towns).filter(row =>
    (!history || row.old) && (!province || province === row.p) && (!city || city === row.c) &&
    (!ref || (isHub ? row.parts.some(town => townIndex.get(town)?.[ref]) : row[ref]))
  );
  if (!isHub) results.sort((a, b) => (history ? a.old - b.old : a.nat - b.nat) || a.id.localeCompare(b.id, 'ko'));
  if (!exploring && !activeSchool && !results.some(row => row.id === key)) key = results[0]?.id || '';

  $('scope').textContent = [province || '전국', city && city !== province ? city : ''].filter(Boolean).join(' · ');
  $('heading').textContent = history ? '2022 상위 지역의 현재 순위' : isHub ? '학원가 순위' : '동네 순위';
  $('meta').textContent = fmt(results.length) + (isHub ? '개 학원가' : '개 동네');
  const headers = history ? ['2022', '동네', '당시 수', '현재 수', '전국', '도시'] : ['전국', isHub ? '학원가' : '동네', '도시', '학원', '교습소'];
  $('head').innerHTML = '<tr>' + headers.map(label => '<th scope="col">' + label + '</th>').join('') + '</tr>';
  $('rows').innerHTML = results.slice(0, shown).map((row, index) => {
    const selected = !exploring && !activeSchool && row.id === key;
    const stats = history ? [fmt(row.oldn), fmt(row.n), row.nat, row.city] : [row.city, fmt(row.n), fmt(row.t)];
    return '<tr' + (selected ? ' class="sel"' : '') + '><td><span class="rank-number">' +
      (history ? row.old : row.nat) + '</span></td><td><button type="button" data-i="' + index + '"' +
      (selected ? ' aria-current="true"' : '') + '>' + E(isHub ? row.name : row.d) +
      '</button><small>' + E(isHub ? row.town : row.id) + '</small></td>' +
      stats.map(value => '<td>' + value + '</td>').join('') + '</tr>';
  }).join('') || '<tr><td colspan="' + headers.length + '">조건에 맞는 지역이 없습니다.</td></tr>';
  $('more').hidden = results.length <= shown;
}

function render() {
  $('unselect').disabled = exploring && !focusedApartment;
  renderRanking();
  detail();
}

function detail() {
  if (exploring) {
    showExplorer();
    return;
  }
  clearMap();
  if (activeSchool) {
    showSchool();
    return;
  }

  const row = results.find(item => item.id === key);
  if (!row) {
    $('detail').innerHTML = '<p>조건에 맞는 지역이 없습니다.</p>';
    mountTownMap();
    return;
  }

  const isHub = mode === 'hubs', hub = isHub ? row : H.get(row.hub);
  if (hub) mountMap(hub, () => renderPlaceDetails(row, hub, isHub));
  else {
    renderPlaceDetails(row, hub, isHub);
    mountTownMap(row);
  }
}

function renderPlaceDetails(row, hub, isHub) {
  const name = isHub ? row.name.split(' · ')[0] : row.d;
  const rank = '<span class="rank-badge">전국 ' + fmt(row.nat) + '위</span>';
  let html = '<div class="panelhead"><div class="eyebrow">' + E(isHub ? row.town : row.id) + '</div><div class="place-heading"><h2>' +
    E(name) + '</h2>' + rank + '</div><p class="dim">' + (isHub ? '대표 도로 ' + E(row.road) :
    '학원 좌표 연결 ' + fmt(row.m) + '곳') + ' · ' + E(row.c) + ' ' + fmt(row.city) + '위</p></div>' +
    '<dl class="stats"><div><dt>학원</dt><dd>' + fmt(row.n) + '<small>곳</small></dd></div><div><dt>교습소</dt><dd>' +
    fmt(row.t) + '<small>곳</small></dd></div></dl>';
  if (!isHub && row.old) html += '<span class="chip">2022 원표 ' + row.old + '위 · ' + fmt(row.oldn) + '곳</span>';
  if (!isHub && row.blog) html += '<span class="chip">참고 글 ' + E(row.blog) + '</span>';
  if (!isHub && hub) html += '<p class="dim">이 동의 학원이 가장 많이 속한 학원가 · <strong>' + E(hub.name) +
    '</strong> · 전국 ' + hub.nat + '위 · 학원 ' + fmt(hub.n) + '곳</p>';
  html += hub ? '<p class="footnote">포함 지역 · ' + E(hub.parts.join(' · ')) + '</p>' + nearbyPanel(hub) :
    '<p class="footnote">이 동에서 밀집 기준을 충족한 학원가가 확인되지 않았습니다.</p>';
  if (hub?.parts.includes('대구 수성구 범어동')) html += '<p class="footnote"><a href="beomeo.pdf">범어 보행망 시범 지도</a></p>';
  $('detail').innerHTML = html;
}

$('rankModes').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  leavePlace();
  mode = button.dataset.mode;
  if (isCompact()) setRanking(true);
  render();
});

$('rows').addEventListener('click', event => {
  const button = event.target.closest('[data-i]');
  if (!button) return;
  leavePlace();
  key = results[Number(button.dataset.i)].id;
  render();
  if (isCompact()) {
    setRanking(false);
    window.scrollTo(0, 0);
    $('rankToggle').focus({preventScroll: true});
  }
});

$('mapPanel').addEventListener('click', event => {
  const button = event.target.closest('[data-range]');
  if (!button || !updateMapRange) return;
  const next = Number(button.dataset.range);
  if (distance === next) return;
  distance = next;
  updateMapRange();
});

$('more').onclick = () => { shown += 60; renderRanking(); };
$('province').onchange = () => { updateCities(); applyRankingFilters(); };
$('city').onchange = $('refFilter').onchange = applyRankingFilters;
function applyRankingFilters() {
  leavePlace();
  render();
}

const stats = D.stats;
$('quality').textContent = '전국 학원 ' + fmt(stats.allac) + '곳 중 ' + fmt(stats.located) +
  '곳의 동네를 확인했고 ' + fmt(stats.placed) + '곳에 좌표를 연결했습니다. 아파트는 원천 ' +
  fmt(stats.totalapt) + '개 단지 중 ' + fmt(stats.apt) + '개의 주소 좌표를 연결했습니다. 2026년 사용승인 단지는 ' +
  'K-apt의 승인일·좌표와 단지 상세 분류를 대조하여 학원가 1km 이내 ' + stats.new2026 +
  '곳을 추가했습니다. 주상복합은 유형을 함께 표시합니다.';
