const nearestAtPoint=new Map(apartmentPlaces.map((apt,i)=>[apt.slice(-2).join(','),nearestByApartment[i]]));
const directions=['북','북동','동','남동','남','남서','서','북서'];
function nearestCluster(apt){
  const [index,meters]=nearestAtPoint.get(apt.slice(-2).join(','));
  return {hub:H.get(clusterIds[index]),meters};
}
function edgeDistance(meters){
  return meters===0?'내부 0m':fmt(meters)+'m';
}
function nearestDescription(apt){
  const {hub,meters}=nearestCluster(apt);
  return '<div class="nearest-cluster"><small>가장 가까운 학원가 · 최단 직선거리</small><b>'+E(hub.name)+' · '+edgeDistance(meters)+'</b></div>';
}
function schoolDistribution(school){
  const counts=Array(8).fill(0),perHub=new Map();
  const bins=schoolSectors[school.id]||[];
  const limit=distance===300?1:distance===500?2:3;
  for(const bin of bins.slice(0,limit)){
    for(const [id,sector,count] of bin){
      counts[sector]+=count;
      perHub.set(clusterIds[id],(perHub.get(clusterIds[id])||0)+count);
    }
  }
  const total=counts.reduce((sum,n)=>sum+n,0);
  const sectors=directions.map((name,i)=>({name,count:counts[i]})).filter(d=>d.count).sort((a,b)=>b.count-a.count);
  const bars=sectors.map(d=>'<li><span>'+d.name+'쪽</span><i style="--share:'+d.count/sectors[0].count*100+'%"></i><b>'+fmt(d.count)+'곳</b></li>').join('');
  const range=distance===1000?'1km':distance+'m';
  const summary=total?'학교 '+range+' 안 · 학원가에 속한 학원 '+fmt(total)+'곳':'학교 '+range+' 안에서 학원가에 속한 학원이 확인되지 않았습니다.';
  return {perHub,html:'<section class="school-distribution"><strong>'+summary+'</strong>'+(bars?'<ul>'+bars+'</ul>':'')+'</section>'};
}
