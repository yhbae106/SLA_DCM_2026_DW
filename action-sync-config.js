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
  '07':'당월 매출 미발생'
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
    const s=document.createElement('script');s.src='master-data-sync.js?v=1';s.dataset.masterSync='1';document.head.appendChild(s);
  }
  function loadData(){
    try{const x=JSON.parse(localStorage.getItem('dcm-dashboard-v8-data'));if(Array.isArray(x)&&x.length)return x;}catch(e){}
    return window.DCM_BASE_DATA||[];
  }
  function norm(v){return window.DCMLogic?.normStatus?window.DCMLogic.normStatus(v):String(v||'').trim().toUpperCase();}
  function rowKey(r){return `${r.outlet}|||${r.businessNo}`;}
  function renderPersistMatrix(){
    const L=window.DCMLogic,value=document.getElementById('ctPersist'),card=value?.closest('.ct-kpi');
    if(!L||!card)return;
    const E=L.E||['대웅제약','대웅바이오','한올바이오'],data=loadData();
    const cur=document.getElementById('month')?.value||[...new Set(data.map(r=>r.month).filter(Boolean))].sort().at(-1);if(!cur)return;
    const manager=document.getElementById('manager')?.value||'전체',outlet=document.getElementById('outlet')?.value||'전체';
    const curr=data.filter(r=>r.month===cur&&(manager==='전체'||r.manager===manager)&&(outlet==='전체'||r.outlet===outlet));
    const keys=new Set(curr.map(rowKey)),months=[...new Set(data.map(r=>r.month).filter(m=>m&&m<=cur))].sort(),hist=new Map();
    data.filter(r=>months.includes(r.month)&&keys.has(rowKey(r))).forEach(r=>{const k=rowKey(r);if(!hist.has(k))hist.set(k,{});hist.get(k)[r.month]=r;});
    let persistAbs=0,persistState=0,all3Abs=0,all3State=0;
    curr.forEach(r=>{
      const h=hist.get(rowKey(r))||{};let hasPersist=false;
      E.forEach(e=>{let streak=0;for(let i=months.length-1;i>=0;i--){if(norm(h[months[i]]?.statuses?.[e])==='X')streak++;else break;}if(streak>=2){persistState++;hasPersist=true;}});
      if(hasPersist)persistAbs++;
      if(E.length===3&&E.every(e=>norm(r.statuses?.[e])==='X')){all3Abs++;all3State+=3;}
    });
    if(card.dataset.persistMatrix!=='1'){
      card.dataset.persistMatrix='1';
      card.innerHTML='<div class="l">지속 X / 3개사 모두 X</div><div class="ct-persist-grid"><div></div><div class="ct-persist-head">절대처수</div><div class="ct-persist-head">그룹사상태</div><div class="ct-persist-label">2개월+ 지속 X</div><strong id="ctPersistAbs">-</strong><strong id="ctPersistState">-</strong><div class="ct-persist-label">3개사 모두 X</div><strong id="ctAll3Abs">-</strong><strong id="ctAll3State">-</strong></div><div class="s">실사업자 기준 / 법인상태 기준</div>';
      if(!document.getElementById('ctPersistMatrixStyle')){const st=document.createElement('style');st.id='ctPersistMatrixStyle';st.textContent='.ct-persist-grid{display:grid;grid-template-columns:1.35fr .82fr .92fr;gap:3px 8px;align-items:center;margin-top:5px;line-height:1.1}.ct-persist-head{font-size:9px;color:#718096;text-align:center;font-weight:700}.ct-persist-label{font-size:10px;color:#475569;font-weight:700;white-space:nowrap}.ct-persist-grid strong{font-size:18px;text-align:center;color:#d97706}.ct-persist-grid strong[id^="ctAll3"]{color:#dc2626}.ct-kpi[data-persist-matrix="1"] .s{font-size:8.5px;margin-top:4px}';document.head.appendChild(st);}
    }
    const set=(id,v,s)=>{const el=document.getElementById(id);if(el)el.textContent=`${v.toLocaleString()}${s}`;};
    set('ctPersistAbs',persistAbs,'처');set('ctPersistState',persistState,'건');set('ctAll3Abs',all3Abs,'처');set('ctAll3State',all3State,'건');
  }
  function start(){
    const source=document.getElementById('kpiRateSub');
    syncControlTowerRateDetail();
    if(source)new MutationObserver(syncControlTowerRateDetail).observe(source,{childList:true,subtree:true,characterData:true});
    ['manager','outlet','month'].forEach(id=>document.getElementById(id)?.addEventListener('change',()=>{setTimeout(syncControlTowerRateDetail,80);setTimeout(renderPersistMatrix,120);}));
    loadMasterSync();
    const t=setInterval(()=>{if(document.getElementById('ctPersist')){clearInterval(t);setTimeout(renderPersistMatrix,180);}},100);
    window.addEventListener('storage',e=>{if(e.key==='dcm-dashboard-v8-data')setTimeout(renderPersistMatrix,100);});
    window.addEventListener('dcm-dashboard-remote-applied',()=>setTimeout(renderPersistMatrix,120));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
