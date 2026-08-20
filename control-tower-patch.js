(()=>{
'use strict';
const DATA_KEY='dcm-dashboard-v8-data',ACTION_KEY='dcm-dashboard-v10-actions';
const PAGE_SIZE=50;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const statusLabel=s=>({TODO:'미조치',IN_PROGRESS:'진행중',WAITING:'업체회신',DONE:'완료'})[s]||'미조치';
let actionOpen=false,actionLimit=PAGE_SIZE,actionTimer=null;
function installLayout(){
  if(!document.querySelector('link[href^="control-tower-layout.css"]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='control-tower-layout.css?v=3';document.head.appendChild(link);
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
  document.querySelectorAll('#ctQuickNav [data-jump]').forEach(btn=>btn.onclick=()=>{
    const target=document.getElementById(btn.dataset.jump);if(!target)return;
    if(target.id==='ctAction'&&!actionOpen)openActionBoard();
    if(target.tagName==='DETAILS')target.open=true;
    target.scrollIntoView({behavior:'smooth',block:'start'});
  });
}
function saveBoardField(k,field,value){
  let actions=[];try{const x=JSON.parse(localStorage.getItem(ACTION_KEY));if(Array.isArray(x))actions=x;}catch(e){}
  let a=actions.find(x=>x.key===k);if(!a){const [outlet,businessNo]=k.split('|||');a={key:k,outlet,businessNo,history:[]};actions.push(a);}
  a[field]=value;a.updatedAt=new Date().toISOString();a.history=Array.isArray(a.history)?a.history:[];a.history.unshift({at:a.updatedAt,field,value});a.history=a.history.slice(0,50);
  localStorage.setItem(ACTION_KEY,JSON.stringify(actions));
}
function ensureActionControls(){
  const panel=$('ctAction'),tbody=$('ctActionBody');if(!panel||!tbody)return;
  const head=panel.querySelector('.section-head');if(!head)return;
  panel.classList.add('ct-action-lazy','ct-action-collapsed');
  if(!$('ctActionToggle')){
    const btn=document.createElement('button');btn.id='ctActionToggle';btn.className='ct-btn ct-action-toggle';btn.type='button';btn.textContent='Action Board 열기';
    head.appendChild(btn);btn.addEventListener('click',()=>actionOpen?closeActionBoard():openActionBoard());
  }
  const tableWrap=tbody.closest('.table-scroll');
  if(tableWrap&&!$('ctActionMoreWrap')){
    const more=document.createElement('div');more.id='ctActionMoreWrap';more.className='ct-action-more';more.innerHTML='<span id="ctActionShown"></span><button class="ct-btn" id="ctActionMore" type="button">50건 더 보기</button><button class="ct-btn" id="ctActionAll" type="button">전체 보기</button>';
    tableWrap.insertAdjacentElement('afterend',more);
    $('ctActionMore')?.addEventListener('click',()=>{actionLimit+=PAGE_SIZE;renderAllXActionBoard();});
    $('ctActionAll')?.addEventListener('click',()=>{actionLimit=Number.MAX_SAFE_INTEGER;renderAllXActionBoard();});
  }
  clearActionRows();
}
function clearActionRows(){
  const tbody=$('ctActionBody');if(!tbody)return;
  tbody.dataset.allXRendering='1';tbody.innerHTML='';delete tbody.dataset.allXRendering;
}
function openActionBoard(){
  actionOpen=true;actionLimit=PAGE_SIZE;
  const panel=$('ctAction');panel?.classList.remove('ct-action-collapsed');panel?.classList.add('ct-action-open');
  const btn=$('ctActionToggle');if(btn)btn.textContent='Action Board 닫기';
  renderAllXActionBoard();
}
function closeActionBoard(){
  actionOpen=false;actionLimit=PAGE_SIZE;
  const panel=$('ctAction');panel?.classList.add('ct-action-collapsed');panel?.classList.remove('ct-action-open');
  const btn=$('ctActionToggle');if(btn)btn.textContent='Action Board 열기';
  clearActionRows();
}
function renderAllXActionBoard(){
  const api=window.DCMActionSync,tbody=$('ctActionBody');if(!actionOpen||!api?.allRisk||!tbody)return;
  const rows=api.allRisk(),visible=rows.slice(0,actionLimit);
  const table=tbody.closest('table'),head=table?.querySelector('thead tr');
  if(head&&!head.dataset.allX){head.dataset.allX='1';head.innerHTML='<th>Priority</th><th>Score</th><th>실사업자명</th><th>업체/권역</th><th>담당자</th><th>Aging</th><th>원인</th><th>조치계획</th><th>Due</th><th>상태</th>';}
  const panel=tbody.closest('.ct-panel'),desc=panel?.querySelector('.section-head p');if(desc)desc.textContent=`현재 필터 범위에서 X가 하나라도 있는 전체 거래처 ${rows.length}건 · Risk Score 높은 순`;
  const reasons=window.DCM_ACTION_REASONS||{};
  tbody.dataset.allXRendering='1';
  tbody.innerHTML=visible.map(r=>`<tr><td><span class="ct-priority ct-${String(r.priority||'P3').toLowerCase()}">${esc(r.priority||'P3')}</span></td><td><strong>${Number(r.score)||0}</strong></td><td>${esc(r.businessName||'')}</td><td>${esc(r.outlet||'')}</td><td>${esc(r.manager||'')}</td><td>${esc(r.aging||'')}</td><td><select data-allx-field="reasonCode" data-key="${esc(r.key)}"><option value="">원인 선택</option>${Object.entries(reasons).map(([k,v])=>`<option value="${esc(k)}" ${r.reasonCode===k?'selected':''}>${esc(k)} ${esc(v)}</option>`).join('')}</select></td><td><input type="text" data-allx-field="plan" data-key="${esc(r.key)}" value="${esc(r.plan||'')}" placeholder="조치계획"></td><td><input type="date" data-allx-field="dueDate" data-key="${esc(r.key)}" value="${esc(r.dueDate||'')}"></td><td><select data-allx-field="status" data-key="${esc(r.key)}">${['TODO','IN_PROGRESS','WAITING','DONE'].map(s=>`<option value="${s}" ${(r.status||'TODO')===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select></td></tr>`).join('')||'<tr><td colspan="10" class="empty">현재 필터 범위에 X 거래처가 없습니다.</td></tr>';
  delete tbody.dataset.allXRendering;
  tbody.querySelectorAll('[data-allx-field]').forEach(el=>el.addEventListener('change',()=>saveBoardField(el.dataset.key,el.dataset.allxField,el.value)));
  const shown=$('ctActionShown'),more=$('ctActionMore'),all=$('ctActionAll');if(shown)shown.textContent=`${Math.min(visible.length,rows.length)} / ${rows.length}건 표시`;
  if(more)more.hidden=visible.length>=rows.length;if(all)all.hidden=visible.length>=rows.length;
}
function scheduleActionRender(delay=100){clearTimeout(actionTimer);actionTimer=setTimeout(()=>{if(actionOpen)renderAllXActionBoard();else clearActionRows();},delay);}
function installAllXBoard(){
  const tbody=$('ctActionBody');if(!tbody)return;ensureActionControls();
  const obs=new MutationObserver(()=>{if(tbody.dataset.allXRendering==='1')return;if(actionOpen)scheduleActionRender(80);else clearActionRows();});obs.observe(tbody,{childList:true,subtree:true});
  ['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>{actionLimit=PAGE_SIZE;scheduleActionRender(140);}));
  window.addEventListener('dcm-action-sync-applied',()=>scheduleActionRender(80));
}
window.addEventListener('load',()=>{
  installLayout();installAllXBoard();
  const old=document.getElementById('resetBtn');if(!old)return;
  const b=old.cloneNode(true);old.replaceWith(b);
  b.onclick=()=>{if(!confirm('브라우저에 추가한 월별 데이터와 Action 이력을 지우고 최초 6월/7월 데이터로 복원할까요?'))return;localStorage.setItem(DATA_KEY,JSON.stringify(window.DCM_BASE_DATA||[]));localStorage.setItem(ACTION_KEY,'[]');location.reload();};
});
})();
