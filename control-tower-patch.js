(()=>{
'use strict';
const DATA_KEY='dcm-dashboard-v8-data',ACTION_KEY='dcm-dashboard-v10-actions';
const PAGE_SIZE=50;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const statusLabel=s=>({TODO:'미조치',IN_PROGRESS:'진행중',WAITING:'업체회신',DONE:'완료'})[s]||'미조치';
let actionOpen=false,actionLimit=PAGE_SIZE,actionTimer=null;
function ensureHeroKpis(){
  const grid=document.querySelector('.ct-hero .ct-kpis');if(!grid)return;
  const rate=$('ctRate')?.closest('.ct-kpi'),delta=$('ctDelta')?.closest('.ct-kpi'),x=$('ctX')?.closest('.ct-kpi'),x2o=$('ctX2O')?.closest('.ct-kpi'),o2x=$('ctO2X')?.closest('.ct-kpi'),persist=$('ctPersist')?.closest('.ct-kpi');
  if(!$('ctNeedAbs')){const card=document.createElement('div');card.className='ct-kpi ct-kpi-bad';card.innerHTML='<div class="l">연동이 필요한 도도매처수</div><div class="v" id="ctNeedAbs">-</div><div class="s" id="ctNeedAbsSub">실사업자번호 기준 연동 필요 절대처수</div>';grid.appendChild(card);}
  if(!$('ctSupply')){const card=document.createElement('div');card.className='ct-kpi ct-kpi-info';card.innerHTML='<div class="l">도도매 공급처수</div><div class="v" id="ctSupply">-</div><div class="s" id="ctSupplySub">현재 공급 중인 도도매 절대처수</div>';grid.appendChild(card);}
  [rate,delta,x,$('ctNeedAbs')?.closest('.ct-kpi'),x2o,o2x,persist,$('ctSupply')?.closest('.ct-kpi')].forEach(el=>{if(el)grid.appendChild(el);});
  rate?.classList.add('ct-kpi-good');delta?.classList.add('ct-kpi-delta');x?.classList.add('ct-kpi-bad');x2o?.classList.add('ct-kpi-good');o2x?.classList.add('ct-kpi-bad');persist?.classList.add('ct-kpi-warn');
}
function syncHeroSupportKpis(){
  const copy=(src,dst)=>{const a=$(src),b=$(dst);if(a&&b)b.textContent=a.textContent||'-';};copy('kpiAbs','ctNeedAbs');copy('kpiSupply','ctSupply');
  const absSub=$('kpiAbsSub'),needSub=$('ctNeedAbsSub');if(absSub&&needSub&&absSub.textContent.trim())needSub.textContent=absSub.textContent.trim();
  const supplySub=$('kpiSupplySub'),ctSupplySub=$('ctSupplySub');if(supplySub&&ctSupplySub&&supplySub.textContent.trim())ctSupplySub.textContent=supplySub.textContent.trim();
  const delta=$('ctDelta'),card=delta?.closest('.ct-kpi');if(card){card.classList.remove('ct-kpi-good','ct-kpi-bad','ct-kpi-neutral');const t=(delta.textContent||'').trim();if(t.startsWith('+'))card.classList.add('ct-kpi-good');else if(t.startsWith('-'))card.classList.add('ct-kpi-bad');else card.classList.add('ct-kpi-neutral');}
}
function trimDuplicateChangeCards(changes){if(!changes)return;const duplicateLabels=new Set(['연동률 변화','X→O 개선','O→X 연동 해제']);changes.querySelectorAll('.change-card').forEach(card=>{const label=card.querySelector('.change-label')?.textContent.trim();if(duplicateLabels.has(label))card.classList.add('ct-change-duplicate');});changes.classList.add('ct-change-summary');}
function changeData(){try{const x=JSON.parse(localStorage.getItem(DATA_KEY));if(Array.isArray(x)&&x.length)return x;}catch(e){}return window.DCM_BASE_DATA||[];}
function changeMonths(data){return [...new Set(data.map(r=>r.month).filter(Boolean))].sort();}
function changeScope(data,month){const L=window.DCMLogic;if(!L||!month)return [];return L.filterRecords(data,{month,manager:$('manager')?.value||'전체',outlet:$('outlet')?.value||'전체'});}
function renderSelectedChangeType(){
  const L=window.DCMLogic,select=$('changeType'),body=$('changeBody'),count=$('changeCount');if(!L||!select||!body||!count)return;
  const data=changeData(),cur=$('month')?.value||'',ms=changeMonths(data),idx=ms.indexOf(cur),prev=idx>0?ms[idx-1]:null;
  const ch=L.compare(prev?changeScope(data,prev):[],changeScope(data,cur)),type=select.value;let rows=[];
  if(type==='new')rows=(ch.newSupply||[]).map(r=>({kind:'신규 공급',...r,corp:(r.entities||[]).map(x=>`${x.outlet!==r.outlet?x.outlet+' / ':''}${x.entity} ${x.status}`).join(' · '),change:'미공급 → O/X',detail:`신규 공급 · ${(r.entities||[]).map(x=>`${x.entity} 연동 ${x.status}`).join(' / ')}`}));
  else if(type==='stop')rows=(ch.stoppedSupply||[]).map(r=>({kind:'공급 중단',...r,corp:(r.entities||[]).map(x=>`${x.outlet!==r.outlet?x.outlet+' / ':''}${x.entity} (기존 ${x.status})`).join(' · '),change:'O/X → 미공급',detail:`공급 중단 · 기존 ${(r.entities||[]).map(x=>`${x.entity} 연동 ${x.status}`).join(' / ')}`}));
  else if(type==='x2o')rows=(ch.xToO||[]).map(r=>({kind:'X→O 개선',...r,corp:r.entity,change:'X → O',detail:'연동 개선'}));
  else if(type==='o2x')rows=(ch.oToX||[]).map(r=>({kind:'O→X 해제',...r,corp:r.entity,change:'O → X',detail:'연동 해제'}));
  body.innerHTML=rows.map(r=>`<tr><td><strong>${esc(r.kind)}</strong></td><td>${esc(r.outlet)}</td><td>${esc(r.manager)}</td><td class="mono">${esc(r.businessNo)}</td><td>${esc(r.businessName)}</td><td>${esc(r.corp)}</td><td>${esc(r.change)}</td><td>${esc(r.detail)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">해당 변동이 없습니다.</td></tr>';
  count.textContent=`${rows.length.toLocaleString()}${type==='new'||type==='stop'?'처':'건'}`;
}
function installChangeFilterFix(){
  const select=$('changeType');if(!select||select.dataset.filterFix==='1')return;select.dataset.filterFix='1';
  select.addEventListener('change',()=>setTimeout(renderSelectedChangeType,0));
  ['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>setTimeout(renderSelectedChangeType,40)));
  setTimeout(renderSelectedChangeType,80);
}
function installLayout(){
  if(!document.querySelector('link[href^="control-tower-layout.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='control-tower-layout.css?v=4';document.head.appendChild(link);}
  const main=document.querySelector('main.wrap'),filters=main?.querySelector('.filters'),hero=main?.querySelector('.ct-hero'),top=main?.querySelector('.top');if(!main||!filters||!hero)return;
  ensureHeroKpis();if(top&&top.nextElementSibling!==hero)top.insertAdjacentElement('afterend',hero);hero.insertAdjacentElement('afterend',filters);filters.classList.add('ct-compact-filters');
  const oldDetail=$('ctDetail');if(oldDetail){const body=oldDetail.querySelector('.ct-detail-body');if(body){[...body.children].forEach(el=>main.insertBefore(el,oldDetail));}oldDetail.remove();}
  const group=main.querySelector('.entity');
  const outlet=[...main.querySelectorAll('.table-panel')].find(x=>x.querySelector('h2')?.textContent.includes('업체별 연동률 현황'));
  const changes=main.querySelector('.changes');
  const need=[...main.querySelectorAll('.table-panel')].find(x=>x.querySelector('h2')?.textContent.includes('연동 필요 리스트'));
  const legacyKpis=main.querySelector('.kpis');
  const ctPanels=[...main.querySelectorAll(':scope > .ct-panel')].filter(x=>x!==hero);
  const aging=ctPanels.find(x=>x.querySelector('h2')?.textContent.includes('DCM Aging & Target'));
  const ai=ctPanels.find(x=>x.querySelector('h2')?.textContent.includes('AI 월간 분석'));
  const risk=ctPanels.find(x=>x.querySelector('h2')?.textContent.includes('Risk Priority'));
  const action=ctPanels.find(x=>x.querySelector('h2')?.textContent.includes('담당자 Action Board'));
  if(group){group.id='ctGroup';group.classList.add('ct-overview-section');}if(outlet){outlet.id='ctOutlet';outlet.classList.add('ct-overview-section');}
  if(aging)aging.id='ctAging';if(ai)ai.id='ctAiSection';if(risk)risk.id='ctRisk';if(action)action.id='ctAction';if(changes){changes.id='ctChanges';trimDuplicateChangeCards(changes);}if(need)need.id='ctNeed';if(legacyKpis)legacyKpis.classList.add('ct-source-kpis');
  let anchor=filters;[group,outlet,changes,aging,ai,risk,action,need].forEach(el=>{if(!el)return;anchor.insertAdjacentElement('afterend',el);anchor=el;});if(legacyKpis)main.appendChild(legacyKpis);
  let nav=$('ctQuickNav');if(!nav){nav=document.createElement('div');nav.id='ctQuickNav';nav.className='ct-quick-nav';filters.insertAdjacentElement('afterend',nav);}
  nav.innerHTML='<button data-jump="ctGroup">그룹사별 현황</button><button data-jump="ctOutlet">업체별 현황</button><button data-jump="ctChanges">전월 대비 변화</button><button data-jump="ctAging">Aging & Target</button><button data-jump="ctRisk">Risk TOP 20</button><button data-jump="ctAction">Action Board</button><button data-jump="ctNeed">연동 필요 리스트</button>';
  document.querySelectorAll('#ctQuickNav [data-jump]').forEach(btn=>btn.onclick=()=>{const target=$(btn.dataset.jump);if(!target)return;if(target.id==='ctAction'&&!actionOpen)openActionBoard();target.scrollIntoView({behavior:'smooth',block:'start'});});
  syncHeroSupportKpis();['kpiAbs','kpiSupply','kpiAbsSub','kpiSupplySub','ctDelta'].forEach(id=>{const node=$(id);if(node)new MutationObserver(syncHeroSupportKpis).observe(node,{childList:true,subtree:true,characterData:true});});['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>setTimeout(syncHeroSupportKpis,80)));
}
function localActions(){try{const x=JSON.parse(localStorage.getItem(ACTION_KEY));return Array.isArray(x)?x:[];}catch(e){return [];}}
function renderReasonPareto(rows){const box=$('ctReasonBars');if(!box)return;const reasons=window.DCM_ACTION_REASONS||{},riskKeys=new Set((rows||window.DCMActionSync?.allRisk?.()||[]).map(r=>r.key));const used={};localActions().filter(a=>riskKeys.has(a.key)).forEach(a=>{if(a.reasonCode&&reasons[a.reasonCode])used[a.reasonCode]=(used[a.reasonCode]||0)+1;});const total=Object.values(used).reduce((a,b)=>a+b,0)||1;box.innerHTML=Object.entries(used).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="ct-bar-row"><span>${esc(reasons[k])}</span><div class="ct-bar"><i style="width:${v/total*100}%"></i></div><b>${v}</b></div>`).join('')||'<div class="ct-note">현재 필터 범위의 Action Board에서 원인코드를 입력하면 자동 집계됩니다.</div>';}
function saveBoardField(k,field,value){const actions=localActions();let a=actions.find(x=>x.key===k);if(!a){const [outlet,businessNo]=k.split('|||');a={key:k,outlet,businessNo,history:[]};actions.push(a);}a[field]=value;a.updatedAt=new Date().toISOString();a.history=Array.isArray(a.history)?a.history:[];a.history.unshift({at:a.updatedAt,field,value});a.history=a.history.slice(0,50);localStorage.setItem(ACTION_KEY,JSON.stringify(actions));if(field==='reasonCode')renderReasonPareto();}
function ensureActionControls(){const panel=$('ctAction'),tbody=$('ctActionBody');if(!panel||!tbody)return;const head=panel.querySelector('.section-head');if(!head)return;panel.classList.add('ct-action-lazy','ct-action-collapsed');if(!$('ctActionToggle')){const btn=document.createElement('button');btn.id='ctActionToggle';btn.className='ct-btn ct-action-toggle';btn.type='button';btn.textContent='Action Board 열기';head.appendChild(btn);btn.addEventListener('click',()=>actionOpen?closeActionBoard():openActionBoard());}const tableWrap=tbody.closest('.table-scroll');if(tableWrap&&!$('ctActionMoreWrap')){const more=document.createElement('div');more.id='ctActionMoreWrap';more.className='ct-action-more';more.innerHTML='<span id="ctActionShown"></span><button class="ct-btn" id="ctActionMore" type="button">50건 더 보기</button><button class="ct-btn" id="ctActionAll" type="button">전체 보기</button>';tableWrap.insertAdjacentElement('afterend',more);$('ctActionMore')?.addEventListener('click',()=>{actionLimit+=PAGE_SIZE;renderAllXActionBoard();});$('ctActionAll')?.addEventListener('click',()=>{actionLimit=Number.MAX_SAFE_INTEGER;renderAllXActionBoard();});}clearActionRows();}
function clearActionRows(){const tbody=$('ctActionBody');if(tbody)tbody.innerHTML='';}
function openActionBoard(){actionOpen=true;actionLimit=PAGE_SIZE;const panel=$('ctAction');panel?.classList.remove('ct-action-collapsed');panel?.classList.add('ct-action-open');const btn=$('ctActionToggle');if(btn)btn.textContent='Action Board 닫기';renderAllXActionBoard();}
function closeActionBoard(){actionOpen=false;actionLimit=PAGE_SIZE;const panel=$('ctAction');panel?.classList.add('ct-action-collapsed');panel?.classList.remove('ct-action-open');const btn=$('ctActionToggle');if(btn)btn.textContent='Action Board 열기';clearActionRows();}
function renderAllXActionBoard(){const api=window.DCMActionSync,tbody=$('ctActionBody');if(!actionOpen||!api?.allRisk||!tbody)return;const rows=api.allRisk(),visible=rows.slice(0,actionLimit);const table=tbody.closest('table'),head=table?.querySelector('thead tr');if(head&&!head.dataset.allX){head.dataset.allX='1';head.innerHTML='<th>Priority</th><th>Score</th><th>실사업자명</th><th>업체/권역</th><th>담당자</th><th>Aging</th><th>원인</th><th>조치계획</th><th>Due</th><th>상태</th>';}const panel=tbody.closest('.ct-panel'),desc=panel?.querySelector('.section-head p');if(desc)desc.textContent=`현재 필터 범위에서 X가 하나라도 있는 전체 거래처 ${rows.length}건 · Risk Score 높은 순`;const reasons=window.DCM_ACTION_REASONS||{};tbody.innerHTML=visible.map(r=>`<tr><td><span class="ct-priority ct-${String(r.priority||'P3').toLowerCase()}">${esc(r.priority||'P3')}</span></td><td><strong>${Number(r.score)||0}</strong></td><td>${esc(r.businessName||'')}</td><td>${esc(r.outlet||'')}</td><td>${esc(r.manager||'')}</td><td>${esc(r.aging||'')}</td><td><select data-allx-field="reasonCode" data-key="${esc(r.key)}"><option value="">원인 선택</option>${Object.entries(reasons).map(([k,v])=>`<option value="${esc(k)}" ${r.reasonCode===k?'selected':''}>${esc(k)} ${esc(v)}</option>`).join('')}</select></td><td><input type="text" data-allx-field="plan" data-key="${esc(r.key)}" value="${esc(r.plan||'')}" placeholder="조치계획"></td><td><input type="date" data-allx-field="dueDate" data-key="${esc(r.key)}" value="${esc(r.dueDate||'')}"></td><td><select data-allx-field="status" data-key="${esc(r.key)}">${['TODO','IN_PROGRESS','WAITING','DONE'].map(s=>`<option value="${s}" ${(r.status||'TODO')===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select></td></tr>`).join('')||'<tr><td colspan="10" class="empty">현재 필터 범위에 X 거래처가 없습니다.</td></tr>';tbody.querySelectorAll('[data-allx-field]').forEach(el=>el.addEventListener('change',()=>saveBoardField(el.dataset.key,el.dataset.allxField,el.value)));renderReasonPareto(rows);const shown=$('ctActionShown'),more=$('ctActionMore'),all=$('ctActionAll');if(shown)shown.textContent=`${Math.min(visible.length,rows.length)} / ${rows.length}건 표시`;if(more)more.hidden=visible.length>=rows.length;if(all)all.hidden=visible.length>=rows.length;}
function scheduleActionRender(delay=100){clearTimeout(actionTimer);actionTimer=setTimeout(()=>{if(actionOpen)renderAllXActionBoard();},delay);}
function installAllXBoard(){const tbody=$('ctActionBody');if(!tbody)return;ensureActionControls();['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>{actionLimit=PAGE_SIZE;scheduleActionRender(140);}));window.addEventListener('dcm-action-sync-applied',()=>scheduleActionRender(80));}
window.addEventListener('load',()=>{installLayout();installChangeFilterFix();installAllXBoard();renderReasonPareto();setTimeout(syncHeroSupportKpis,120);const old=document.getElementById('resetBtn');if(!old)return;const b=old.cloneNode(true);old.replaceWith(b);b.onclick=()=>{if(!confirm('브라우저에 추가한 월별 데이터와 Action 이력을 지우고 최초 6월/7월 데이터로 복원할까요?'))return;localStorage.setItem(DATA_KEY,JSON.stringify(window.DCM_BASE_DATA||[]));localStorage.setItem(ACTION_KEY,'[]');location.reload();};});
})();