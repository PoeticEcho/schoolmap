const searchBox = $('search'), suggestions = $('placeResults'), searchPopover = $('searchPopover');
let searchType = 'all', choices = [], highlighted = -1, searchFrame, renderedQuery, renderedType, previousMatch;
const searchIndex = {};
const koreanOrder = new Intl.Collator('ko').compare;
const kinds = {school: '학교', hub: '학원가', town: '동네', apartment: '아파트'};
const locationIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const normalize = value => value.normalize('NFC').toLowerCase().replace(/[\s·.,()\-]/g, '');
function choseong(value) {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const syllable = value.charCodeAt(i) - 0xAC00;
    // Unicode orders precomposed Hangul in blocks of 588 syllables by initial.
    result += syllable >= 0 && syllable < 11172 ? initials[Math.floor(syllable / 588)] : value[i];
  }
  return result;
}

function searchEntry(type, place, name, area, aliases = []) {
  const names = [name, ...aliases].map(normalize);
  const context = normalize(area);
  return {type, place, name, area, names, context, initials: names.map(choseong),
    combined: names.map(value => context + value)};
}

const searchSources = {
  town: {rows: D.towns, build: town => searchEntry('town', town, town.d, town.id)},
  hub: {rows: D.hubs, build: hub => searchEntry('hub', hub, hub.name, hub.town + ' ' + hub.road,
    [hub.name.split(' · ')[0], hub.road])},
  school: {rows: schoolPlaces, build: school => {
    const name = school.name.startsWith(school.p) ? school.name.slice(school.p.length) : school.name;
    const short = name.replace(/초등학교|중학교|고등학교$/, ending => ending[0]);
    return searchEntry('school', school, school.name, school.address, [name, short]);
  }},
  apartment: {rows: apartmentPlaces, build: apt => {
    const {hub} = nearestCluster(apt);
    return searchEntry('apartment', apt, apt[0], hub.town, [apt[0] + '아파트']);
  }}
};
const searchTypes = Object.keys(searchSources);
const searchStorageKey = 'schoolmap.search.v1';
const searchRevision = [document.lastModified, ...searchTypes.map(type => searchSources[type].rows.length)].join('|');
const queryCache = new Map();
const savedQueryLimit = 24, recentLimit = 6;
let savedSearches = readSavedSearches() ?? {recent: [], queries: new Map()};

function readSavedSearches() {
  try {
    const saved = JSON.parse(localStorage.getItem(searchStorageKey));
    if (!saved || typeof saved !== 'object') return null;
    const recent = Array.isArray(saved?.recent) ? saved.recent.slice(0, recentLimit) : [];
    const queries = saved?.revision === searchRevision && Array.isArray(saved.queries) ? saved.queries
      .filter(pair => Array.isArray(pair) && typeof pair[0] === 'string' && Array.isArray(pair[1]))
      .slice(-savedQueryLimit) : [];
    return {recent, queries: new Map(queries)};
  } catch {
    return null;
  }
}

function storeSearches() {
  try {
    localStorage.setItem(searchStorageKey, JSON.stringify({
      revision: searchRevision, recent: savedSearches.recent, queries: [...savedSearches.queries]
    }));
  } catch {
    // Storage can be disabled or full. Search and recents still work within this page.
  }
}

function cacheSearchValue(cache, key, value, limit) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
}

function entryAt(type, index) {
  const cached = searchIndex[type]?.[index];
  if (cached) return cached;
  const {build, rows} = searchSources[type];
  const entry = build(rows[index]);
  entry.index = index;
  return entry;
}

function indexPlaces(type, count) {
  const entries = searchIndex[type] ??= [];
  const end = Math.min(searchSources[type].rows.length, entries.length + count);
  for (let i = entries.length; i < end; i++) entries.push(entryAt(type, i));
  return entries;
}

function searchPlaceId(place) {
  return place.id ?? JSON.stringify([place[0], place.at(-2), place.at(-1)]);
}

function placeReference(entry) {
  return [entry.type, entry.index, searchPlaceId(entry.place)];
}

function restorePlace(ref, allowMoved = false) {
  if (!Array.isArray(ref)) return null;
  const [type, storedIndex, id] = ref;
  if (!Object.hasOwn(searchSources, type) || !Number.isInteger(storedIndex) || typeof id !== 'string') return null;
  const rows = searchSources[type].rows;
  const stored = rows[storedIndex];
  if (stored && searchPlaceId(stored) === id) return entryAt(type, storedIndex);
  if (!allowMoved) return null;
  const index = rows.findIndex(place => searchPlaceId(place) === id);
  return index === -1 ? null : entryAt(type, index);
}

function getSearchIndex(type) {
  if (type === 'all') return searchIndex.all ??= searchTypes.flatMap(getSearchIndex);
  return indexPlaces(type, Infinity);
}

function warmSearchIndex(index = 0) {
  if (index === searchTypes.length) return;
  const type = searchTypes[index];
  const next = deadline => {
    const stop = performance.now() + 8;
    let entries;
    do {
      entries = indexPlaces(type, 256);
    } while (entries.length < searchSources[type].rows.length && deadline?.timeRemaining() > 1 && performance.now() < stop);
    warmSearchIndex(index + Number(entries.length === searchSources[type].rows.length));
  };
  if ('requestIdleCallback' in window) requestIdleCallback(next);
  else setTimeout(next, 35);
}
warmSearchIndex();

function scoreName(names, query) {
  let score = 3;
  for (const name of names) {
    if (name === query) return 0;
    if (name.startsWith(query)) score = 1;
    else if (score === 3 && name.includes(query)) score = 2;
  }
  return score;
}

function orderMatches(a, b) {
  return a.score - b.score || a.nearby - b.nearby ||
    (a.entry.place.nat ?? 0) - (b.entry.place.nat ?? 0) ||
    koreanOrder(a.entry.name, b.entry.name) || koreanOrder(a.entry.area, b.entry.area);
}

function addTopMatch(bucket, match, limit) {
  if (bucket.length === limit && orderMatches(match, bucket.at(-1)) >= 0) return;
  const position = bucket.findIndex(result => orderMatches(match, result) < 0);
  if (position === -1) bucket.push(match);
  else bucket.splice(position, 0, match);
  if (bucket.length > limit) bucket.pop();
}

function searchRequest(raw) {
  raw = raw.trim();
  const query = normalize(raw);
  if (!query) return null;
  const rank = raw.match(/^(?:rank\s*=\s*)?(\d+)\s*위$/i) || raw.match(/^rank\s*=\s*(\d+)$/i);
  if (rank && (searchType === 'hub' || searchType === 'all')) {
    const number = Number(rank[1]);
    return {rank: number, cacheKey: JSON.stringify(['rank', rank[1]])};
  }
  const tokens = raw.split(/\s+/).map(normalize).filter(Boolean);
  const selected = activeSchool || H.get(key) || townIndex.get(key);
  const nearby = selected ? normalize((activeSchool ? activeSchool.address : selected.town || selected.id).split(' ')[1] || '') : '';
  return {
    query, tokens, nearby,
    cacheKey: JSON.stringify([searchType, nearby, query, tokens]),
    singleKey: JSON.stringify([searchType, query, tokens])
  };
}

function findPlaces(raw) {
  const request = searchRequest(raw);
  if (!request) {
    previousMatch = null;
    return [];
  }
  const {cacheKey, singleKey} = request;
  let results = queryCache.get(cacheKey) ?? queryCache.get(singleKey);
  if (!results) {
    const refs = savedSearches.queries.get(cacheKey) ?? savedSearches.queries.get(singleKey);
    if (refs?.length && refs.length <= 12) {
      const restored = refs.map(ref => restorePlace(ref));
      if (restored.every(Boolean)) results = restored;
    }
    results ??= searchPlaces(request);
  }
  // A single hit is independent of which region the map currently shows.
  cacheSearchValue(queryCache, results.length === 1 ? singleKey ?? cacheKey : cacheKey, results, 48);
  return results;
}

function searchPlaces({rank, query, tokens, nearby}) {
  if (rank !== undefined) {
    return getSearchIndex('hub').filter(entry => entry.place.nat === rank).slice(0, 12);
  }
  const initialQuery = /^[ㄱ-ㅎ]{2,}$/.test(query);
  const single = tokens.length === 1;
  // Extending one token can only match entries that already matched its shorter prefix.
  const candidates = single && previousMatch?.type === searchType && previousMatch.initialQuery === initialQuery &&
    query.startsWith(previousMatch.query) ? previousMatch.entries : getSearchIndex(searchType);
  const buckets = {};
  const matched = [];
  const limit = searchType === 'all' ? 5 : 12;
  for (const entry of candidates) {
    const score = scoreName(initialQuery ? entry.initials : entry.names, query);
    const context = entry.context;
    if (score === 3) {
      if (initialQuery) continue;
      const includesQuery = context.includes(query) || entry.combined.some(value => value.includes(query));
      if (!includesQuery && (single || !tokens.every(token =>
        context.includes(token) || entry.names.some(name => name.includes(token))))) continue;
    }
    if (single) matched.push(entry);
    const bucket = buckets[entry.type] ??= [];
    addTopMatch(bucket, {entry, score, nearby: nearby && context.includes(nearby) ? 0 : 1}, limit);
  }
  previousMatch = single ? {type: searchType, initialQuery, query, entries: matched} : null;
  return Object.values(buckets).flat().sort(orderMatches).slice(0, 12).map(match => match.entry);
}

function recentPlaces() {
  return savedSearches.recent
    .filter(ref => searchType === 'all' || ref?.[0] === searchType)
    .map(ref => restorePlace(ref, true)).filter(Boolean);
}

function chooseSearchResult(match) {
  const stored = readSavedSearches() ?? savedSearches;
  const recent = new Map();
  for (const ref of [placeReference(match), ...stored.recent]) {
    if (!Array.isArray(ref)) continue;
    const id = JSON.stringify([ref[0], ref[2]]);
    if (!recent.has(id)) recent.set(id, ref);
    if (recent.size === recentLimit) break;
  }
  savedSearches = {recent: [...recent.values()], queries: stored.queries};
  const request = searchRequest(renderedQuery || '');
  if (request) {
    const cacheKey = choices.length === 1 ? request.singleKey ?? request.cacheKey : request.cacheKey;
    cacheSearchValue(savedSearches.queries, cacheKey, choices.map(placeReference), savedQueryLimit);
  }
  storeSearches();
  selectPlace(match.type, match.place);
}

function cancelSearchFrame() {
  if (searchFrame === undefined) return;
  cancelAnimationFrame(searchFrame);
  searchFrame = undefined;
}

function schedulePlaces() {
  if (searchFrame !== undefined) return;
  searchFrame = requestAnimationFrame(() => {
    searchFrame = undefined;
    showPlaces();
  });
}

function hidePlaces() {
  cancelSearchFrame();
  searchPopover.hidden = true;
  highlighted = -1;
  searchBox.setAttribute('aria-expanded', 'false');
  searchBox.removeAttribute('aria-activedescendant');
}

function showPlaces() {
  cancelSearchFrame();
  const raw = searchBox.value.trim();
  if (!searchPopover.hidden && raw === renderedQuery && searchType === renderedType) return;
  renderedQuery = raw;
  renderedType = searchType;
  choices = raw ? findPlaces(raw) : recentPlaces();
  const recent = !raw && choices.length > 0;
  $('recentSearchHeader').hidden = !recent;
  suggestions.setAttribute('aria-label', recent ? '최근 검색' : '검색 결과');
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
searchBox.addEventListener('input', schedulePlaces);
searchBox.addEventListener('compositionend', schedulePlaces);
searchBox.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') { hidePlaces(); return; }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  showPlaces();
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
  showPlaces();
  const match = choices[highlighted >= 0 ? highlighted : searchBox.value.trim() ? 0 : -1];
  if (match) chooseSearchResult(match);
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
  if (match) chooseSearchResult(match);
});
$('clearRecentSearch').addEventListener('click', () => {
  savedSearches = {recent: [], queries: new Map()};
  queryCache.clear();
  previousMatch = null;
  storeSearches();
  renderedQuery = undefined;
  searchBox.focus();
  showPlaces();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#placeSearch')) hidePlaces();
});
$('placeSearch').addEventListener('focusout', event => {
  if (event.relatedTarget && !$('placeSearch').contains(event.relatedTarget)) hidePlaces();
});
