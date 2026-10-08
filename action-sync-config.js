window.DCM_ACTION_SYNC={
  endpoint:'https://script.google.com/macros/s/AKfycbygUlCo1x2izUO59cdbbBL3pbGLZgMaGrZz2lrqDfB8m4VtUHC-VqnEJMOeiQOUPXWCuQ/exec',
  spreadsheetId:'1LbEuintnEZbnwJXZcrbTWZNECWMg4ry7_UwRsQ9end0',
  sheetName:'Action Board',
  editors:['배영훈','정직한','임인숙'],
  pollMs:180000
};

window.DCM_ACTION_REASONS={
  '01':'ERP/시스템 미구축',
  '02':'도입 품목 미연동',
  '03':'전산/데이터 오류',
  '04':'거래처 연동 거부/미협조',
  '05':'공급·거래 중단 예정',
  '06':'신규 거래처 연동 예정',
  '07':'당월 매출 미발생',
  '08':'도매몰 연동 필요'
};

(()=>{
  'use strict';
  function syncControlTowerRateDetail(){
    const source=document.getElementById('kpiRateSub');
    const target=document.getElementById('ctRate')?.closest('.ct-kpi')?.querySelector('.s');
    if(!target)return;
    const text=(source?.textContent||'').trim();
    const match=text.match(/평가\s*([\d,]+)처\s*중\s*연동\s*O\s*([\d,]+)처/);
    target.textContent=match?`O ${match[2]}건 / O+X ${match[1]}건`:'O -건 / O+X -건';
  }
  function loadMasterSync(){
    if(document.querySelector('script[data-master-sync]'))return;
    const s=document.createElement('script');s.src='master-data-sync.js?v=20261008v11';s.dataset.masterSync='1';document.head.appendChild(s);
  }
  function loadData(){
    try{const x=JSON.parse(localStorage.getItem('dcm-dashboard-v8-data'));if(Array.isArray(x)&&x.length)return x;}catch(e){}
    return window.DCM_BASE_DATA||[];
  }
  function norm(v){return window.DCMLogic?.normStatus?window.DCMLogic.normStatus(v):String(v||'').trim().toUpperCase();}
  function rowKey(r){return `${r.outlet}|||${r.businessNo}`;}

  function renderPersistMatrix(){
    const L=window.DCMLogic;if(!L)return;
    const E=L.E||['대웅제약','대웅바이오','한올바이오'],data=loadData();
    const cur=document.getElementById('month')?.value||[...new Set(data.map(r=>r.month).filter(Boolean))].sort().at(-1);
    if(!cur)return;
    const manager=document.getElementById('manager')?.value||'전체',outlet=document.getElementById('outlet')?.value||'전체';
    const curr=data.filter(r=>r.month===cur&&(manager==='전체'||(r.outlet==='백제약품 대전'?'정직한':r.manager)===manager)&&(outlet==='전체'||r.outlet===outlet));
    const keys=new Set(curr.map(rowKey)),months=[...new Set(data.map(r=>r.month).filter(m=>m&&m<=cur))].sort(),hist=new Map();
    data.forEach(r=>{if(r.month>cur||!keys.has(rowKey(r)))return;const k=rowKey(r);if(!hist.has(k))hist.set(k,new Map());hist.get(k).set(r.month,r);});
    let persistAbs=0,persistState=0,all3Abs=0;
    curr.forEach(r=>{
      const h=hist.get(rowKey(r));let hasPersist=false;
      E.forEach(e=>{let streak=0;for(let i=months.length-1;i>=0;i--){if(norm(h?.get(months[i])?.statuses?.[e])==='X')streak++;else break;}if(streak>=2){persistState++;hasPersist=true;}});
      if(hasPersist)persistAbs++;
      if(E.length===3&&E.every(e=>norm(r.statuses?.[e])==='X'))all3Abs++;
    });
    const put=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
    put('ctPersist',persistAbs.toLocaleString()+'처');
    put('ctPersistSub',persistState.toLocaleString()+'건 그룹사 상태 지속 X');
    put('ctAll3',all3Abs.toLocaleString()+'처');
    put('ctAll3Sub',(all3Abs*3).toLocaleString()+'건 그룹사 상태 X');
  }
  let persistTimer=0;
  function refreshPersistSoon(){clearTimeout(persistTimer);persistTimer=setTimeout(renderPersistMatrix,65);}
  function start(){
    const source=document.getElementById('kpiRateSub');
    syncControlTowerRateDetail();
    if(source)new MutationObserver(syncControlTowerRateDetail).observe(source,{childList:true,subtree:true,characterData:true});
    ['manager','outlet','month'].forEach(id=>document.getElementById(id)?.addEventListener('change',()=>{setTimeout(syncControlTowerRateDetail,80);refreshPersistSoon();}));
    loadMasterSync();
    refreshPersistSoon();window.addEventListener('load',refreshPersistSoon,{once:true});
    window.addEventListener('storage',e=>{if(e.key==='dcm-dashboard-v8-data')refreshPersistSoon();});
    window.addEventListener('dcm-dashboard-remote-applied',refreshPersistSoon);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
