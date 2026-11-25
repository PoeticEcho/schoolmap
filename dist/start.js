const compactLayout = matchMedia('(max-width: 900px)');
const isCompact = () => compactLayout.matches;
function setRanking(open) {
  $('ranking').hidden = !open;
  $('rankToggle').setAttribute('aria-expanded', String(open));
}
$('rankToggle').onclick = () => {
  const open = $('ranking').hidden;
  setRanking(open);
  if (open) $('ranking').scrollIntoView({block: 'nearest'});
};
compactLayout.addEventListener('change', () => setRanking(!isCompact()));
setRanking(!isCompact());
updateCities();

function randomFeatured(except) {
  const pool = featured.filter(hub => hub.id !== except);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : featured[0];
}
function initialHub() {
  const rank = new URLSearchParams(location.search).get('rank');
  if (rank && /^\d+$/.test(rank)) {
    const hub = nationwideHubs.find(candidate => candidate.nat === Number(rank));
    if (hub) return hub;
  }
  return randomFeatured();
}
$('randomHub').onclick = () => openExplorerHub(randomFeatured(key));
openExplorerHub(initialHub());
