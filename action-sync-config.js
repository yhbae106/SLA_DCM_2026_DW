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
  function start(){
    const source=document.getElementById('kpiRateSub');
    syncControlTowerRateDetail();
    if(source)new MutationObserver(syncControlTowerRateDetail).observe(source,{childList:true,subtree:true,characterData:true});
    ['manager','outlet','month'].forEach(id=>document.getElementById(id)?.addEventListener('change',()=>setTimeout(syncControlTowerRateDetail,80)));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
