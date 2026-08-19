(()=>{
'use strict';
function init(){
 const main=document.querySelector('main.wrap');
 const filters=main?.querySelector('.filters');
 const hero=main?.querySelector('.ct-hero');
 if(!main||!filters||!hero)return;
 // Put the executive control tower immediately below the page title.
 const top=main.querySelector('.top');
 if(top&&top.nextElementSibling!==hero) top.insertAdjacentElement('afterend',hero);
 // Keep filters close to the control tower for quick slicing, but visually compact.
 hero.insertAdjacentElement('afterend',filters);
 filters.classList.add('ct-compact-filters');
 // Add a quick navigation strip for the operating flow.
 if(!document.getElementById('ctQuickNav')){
   const nav=document.createElement('div');
   nav.id='ctQuickNav'; nav.className='ct-quick-nav';
   nav.innerHTML='<button data-jump="ctAging">Aging & Target</button><button data-jump="ctRisk">Risk TOP 20</button><button data-jump="ctAction">Action Board</button><button data-jump="ctDetail">상세현황</button>';
   filters.insertAdjacentElement('afterend',nav);
 }
 const ctPanels=[...main.querySelectorAll(':scope > .ct-panel')].filter(x=>x!==hero);
 if(ctPanels[0])ctPanels[0].id='ctAging';
 const risk=ctPanels.find(x=>x.textContent.includes('Risk Priority')); if(risk)risk.id='ctRisk';
 const action=ctPanels.find(x=>x.textContent.includes('담당자 Action Board')); if(action)action.id='ctAction';
 // Collapse the legacy detailed dashboard into one expandable section.
 if(!document.getElementById('ctDetail')){
   const details=document.createElement('details'); details.id='ctDetail'; details.className='ct-detail-wrap';
   const summary=document.createElement('summary');
   summary.innerHTML='<span><strong>상세현황 보기</strong><small>기존 KPI · 그룹사별 · 업체별 · 전월비 · 연동 필요 리스트</small></span><b class="ct-detail-chevron">⌄</b>';
   details.appendChild(summary);
   const body=document.createElement('div'); body.className='ct-detail-body'; details.appendChild(body);
   const legacy=[...main.children].filter(el=>
     el.classList?.contains('kpis') ||
     el.classList?.contains('entity') ||
     el.classList?.contains('changes') ||
     (el.classList?.contains('table-panel') && !el.classList?.contains('ct-panel'))
   );
   const footer=main.querySelector('.footer');
   (footer||null)?main.insertBefore(details,footer):main.appendChild(details);
   legacy.forEach(el=>body.appendChild(el));
 }
 document.querySelectorAll('#ctQuickNav [data-jump]').forEach(btn=>btn.addEventListener('click',()=>{
   const target=document.getElementById(btn.dataset.jump); if(!target)return;
   if(target.tagName==='DETAILS')target.open=true;
   target.scrollIntoView({behavior:'smooth',block:'start'});
 }));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();