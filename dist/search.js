const searchBox = $('search'), suggestions = $('placeResults'), searchPopover = $('searchPopover');
let searchType = 'all', choices = [], highlighted = -1, searchIndex;
const kinds = {school: '학교', hub: '학원가', town: '동네', apartment: '아파트'};
const locationIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const normalize = value => value.normalize('NFC').toLocaleLowerCase('ko').replace(/[\s·.,()\-]/g, '');
const choseong = value => value.replace(/[가-힣]/g, char => initials[Math.floor((char.charCodeAt(0) - 44032) / 588)]);

function getSearchIndex() {
  if (searchIndex) return searchIndex;
  function entry(type, place, name, area, aliases = []) {
    const names = [name, ...aliases].map(normalize);
    return {type, place, name, area, names, initials: names.map(choseong), context: normalize(area)};
  }
  searchIndex = [
    ...D.towns.map(town => entry('town', town, town.d, town.id)),
    ...D.hubs.map(hub => entry('hub', hub, hub.name, hub.town + ' ' + hub.road, [hub.name.split(' · ')[0], hub.road])),
    ...schoolPlaces.map(school => {
      const name = school.name.replace(new RegExp('^' + school.p), '');
      const short = name.replace(/초등학교|중학교|고등학교$/, ending => ending[0]);
      return entry('school', school, school.name, school.address, [name, short]);
    }),
    ...apartmentPlaces.map(apt => {
      const {hub} = nearestCluster(apt);
      return entry('apartment', apt, apt[0], hub.town, [apt[0] + '아파트']);
    })
  ];
  return searchIndex;
}

function findPlaces(raw) {
  const query = normalize(raw);
  const tokens = raw.trim().split(/\s+/).map(normalize).filter(Boolean);
  const initialQuery = /^[ㄱ-ㅎ]{2,}$/.test(query);
  const rank = raw.trim().match(/^(?:rank\s*=\s*)?(\d+)\s*위$/i) || raw.trim().match(/^rank\s*=\s*(\d+)$/i);
  if (rank && (searchType === 'hub' || searchType === 'all')) {
    return getSearchIndex().filter(entry => entry.type === 'hub' && entry.place.nat === Number(rank[1])).slice(0, 12);
  }
  if (!query) return [];
  const selected = activeSchool || H.get(key) || townIndex.get(key);
  const nearby = selected ? normalize(activeSchool ? activeSchool.address.split(' ').slice(1, 2).join(' ') :
    (selected.town || selected.id).split(' ').slice(1, 2).join(' ')) : '';
  const matches = [];
  for (const entry of getSearchIndex()) {
    if (searchType !== 'all' && entry.type !== searchType) continue;
    const names = initialQuery ? entry.initials : entry.names;
    const context = entry.context;
    const score = names.includes(query) ? 0 :
      names.some(name => name.startsWith(query)) ? 1 :
      names.some(name => name.includes(query)) ? 2 :
      !initialQuery && (context.includes(query) || names.some(name => (context + name).includes(query)) ||
        (tokens.length > 1 && tokens.every(token => context.includes(token) || names.some(name => name.includes(token))))) ? 3 : 9;
    if (score < 9) matches.push({entry, score, nearby: nearby && context.includes(nearby) ? 0 : 1});
  }
  matches.sort((a, b) => a.score - b.score || a.nearby - b.nearby ||
    (a.entry.place.nat ?? 0) - (b.entry.place.nat ?? 0) ||
    a.entry.name.localeCompare(b.entry.name, 'ko') || a.entry.area.localeCompare(b.entry.area, 'ko'));
  if (searchType !== 'all') return matches.slice(0, 12).map(match => match.entry);
  const counts = {};
  return matches.filter(({entry}) => (counts[entry.type] = (counts[entry.type] || 0) + 1) <= 5)
    .slice(0, 12).map(match => match.entry);
}

function hidePlaces() {
  searchPopover.hidden = true;
  highlighted = -1;
  searchBox.setAttribute('aria-expanded', 'false');
  searchBox.removeAttribute('aria-activedescendant');
}

function showPlaces() {
  const raw = searchBox.value.trim();
  choices = findPlaces(raw);
  const icons = {town: locationIcon, hub: locationIcon, school: schoolIcon, apartment: apartmentIcon};
  suggestions.innerHTML = choices.map((entry, index) => {
    const area = entry.type === 'apartment' ? '인근 학원가 · ' + entry.area : entry.area;
    const label = entry.type === 'school' ? entry.place.level : kinds[entry.type];
    return '<div role="option" aria-selected="false" id="place-' + index + '" data-choice="' + index +
      '"><span class="place-icon icon-' + entry.type + '">' + icons[entry.type] + '</span><span><strong>' +
      E(entry.name) + '</strong><small>' + E(area) + '</small></span><span class="place-type">' + E(label) + '</span></div>';
  }).join('');
  $('searchStatus').hidden = Boolean(choices.length);
  $('searchStatus').textContent = raw ? '일치하는 결과가 없습니다.' : '장소 이름, 도로명 또는 순위(예: 12위)를 입력하세요.';
  highlighted = -1;
  searchBox.removeAttribute('aria-activedescendant');
  searchPopover.hidden = false;
  searchBox.setAttribute('aria-expanded', 'true');
}

function selectPlace(type, place) {
  if (type === 'hub') {
    openExplorerHub(place);
  } else {
    leavePlace();
    distance = 1000;
    if (type === 'school') {
      activeSchool = buildSchool(place);
    } else if (type === 'town') {
      reconcileFilters(place);
      mode = 'towns';
      key = place.id;
    } else {
      focusedApartment = place;
      exploring = true;
    }
    render();
    if (isCompact()) setRanking(false);
  }
  searchBox.value = type === 'apartment' ? place[0] : place.name || place.d;
  if ($('placeSearch').contains(document.activeElement)) document.activeElement.blur();
}

searchBox.addEventListener('focus', showPlaces);
searchBox.addEventListener('input', event => { if (!event.isComposing) showPlaces(); });
searchBox.addEventListener('compositionend', showPlaces);
searchBox.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') { hidePlaces(); return; }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  if (searchPopover.hidden) showPlaces();
  if (!choices.length) return;
  event.preventDefault();
  highlighted = event.key === 'ArrowDown' ? (highlighted + 1) % choices.length :
    (highlighted <= 0 ? choices.length - 1 : highlighted - 1);
  suggestions.querySelectorAll('[role=option]').forEach((option, index) => {
    option.setAttribute('aria-selected', String(index === highlighted));
  });
  const item = $('place-' + highlighted);
  searchBox.setAttribute('aria-activedescendant', item.id);
  item.scrollIntoView({block: 'nearest'});
});
$('placeSearch').addEventListener('submit', event => {
  event.preventDefault();
  if (searchPopover.hidden) showPlaces();
  const match = choices[Math.max(0, highlighted)];
  if (match) selectPlace(match.type, match.place);
  else searchBox.focus();
});
$('searchTypes').addEventListener('click', event => {
  const button = event.target.closest('[data-search-type]');
  if (!button) return;
  searchType = button.dataset.searchType;
  $('searchTypes').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  showPlaces();
  searchBox.focus();
});
suggestions.addEventListener('mousedown', event => event.preventDefault());
suggestions.addEventListener('click', event => {
  const item = event.target.closest('[data-choice]');
  if (!item) return;
  const match = choices[Number(item.dataset.choice)];
  if (match) selectPlace(match.type, match.place);
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#placeSearch')) hidePlaces();
});
$('placeSearch').addEventListener('focusout', event => {
  if (event.relatedTarget && !$('placeSearch').contains(event.relatedTarget)) hidePlaces();
});
