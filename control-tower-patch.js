(()=>{
'use strict';
const DATA_KEY='dcm-dashboard-v8-data',ACTION_KEY='dcm-dashboard-v10-actions';
function installLayout(){
  if(!document.querySelector('link[href^="control-tower-layout.css"]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='control-tower-layout.css?v=1';document.head.appendChild(link);
  }
  const main=document.querySelector('main.wrap'),filters=main?.querySelector('.filters'),hero=main?.querySelector('.ct-hero'),top=main?.querySelector('.top');
  if(!main||!filters||!hero)return;
  if(top&&top.nextElementSibling!==hero)top.insertAdjacentElement('afterend',hero);
  hero.insertAdjacentElement('afterend',filters);filters.classList.add('ct-compact-filters');
  if(!document.getElementById('ctQuickNav')){
    const nav=document.createElement('div');nav.id='ctQuickNav';nav.className='ct-quick-nav';
    nav.innerHTML='<button data-jump="ctAging">Aging & Target</button><button data-jump="ctRisk">Risk TOP 20</button><button data-jump="ctAction">Action Board</button><button data-jump="ctDetail">상세현황 보기</button>';
    filters.insertAdjacentElement('afterend',nav);
  }
  const ctPanels=[...main.querySelectorAll(':scope > .ct-panel')].filter(x=>x!==hero);
  if(ctPanels[0])ctPanels[0].id='ctAging';
  const risk=ctPanels.find(x=>x.textContent.includes('Risk Priority'));if(risk)risk.id='ctRisk';
  const action=ctPanels.find(x=>x.textContent.includes('담당자 Action Board'));if(action)action.id='ctAction';
  if(!document.getElementById('ctDetail')){
    const details=document.createElement('details');details.id='ctDetail';details.className='ct-detail-wrap';
    const summary=document.createElement('summary');summary.innerHTML='<span><strong>상세현황 보기</strong><small>기존 KPI · 그룹사별 · 업체별 · 전월비 · 연동 필요 리스트</small></span><b class="ct-detail-chevron">⌄</b>';details.appendChild(summary);
    const body=document.createElement('div');body.className='ct-detail-body';details.appendChild(body);
    const legacy=[...main.children].filter(el=>el.classList?.contains('kpis')||el.classList?.contains('entity')||el.classList?.contains('changes')||(el.classList?.contains('table-panel')&&!el.classList?.contains('ct-panel')));
    const footer=main.querySelector('.footer');footer?main.insertBefore(details,footer):main.appendChild(details);legacy.forEach(el=>body.appendChild(el));
  }
  document.querySelectorAll('#ctQuickNav [data-jump]').forEach(btn=>btn.onclick=()=>{const target=document.getElementById(btn.dataset.jump);if(!target)return;if(target.tagName==='DETAILS')target.open=true;target.scrollIntoView({behavior:'smooth',block:'start'});});
}
window.addEventListener('load',()=>{
  installLayout();
  const old=document.getElementById('resetBtn');if(!old)return;
  const b=old.cloneNode(true);old.replaceWith(b);
  b.onclick=()=>{if(!confirm('브라우저에 추가한 월별 데이터와 Action 이력을 지우고 최초 6월/7월 데이터로 복원할까요?'))return;localStorage.setItem(DATA_KEY,JSON.stringify(window.DCM_BASE_DATA||[]));localStorage.setItem(ACTION_KEY,'[]');location.reload();};
});
})();