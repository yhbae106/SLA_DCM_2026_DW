(()=>{
'use strict';
const DATA_KEY='dcm-dashboard-v8-data',ACTION_KEY='dcm-dashboard-v10-actions';
const PAGE_SIZE=50;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const statusLabel=s=>({TODO:'미조치',IN_PROGRESS:'진행중',WAITING:'업체회신',DONE:'완료'})[s]||'미조치';
let actionOpen=true,actionLimit=PAGE_SIZE,actionTimer=null,actionView='x',actionEntity='all',actionPriority='all',actionSearch='',activeKpi=null;
const ACTION_VIEWS={x:'현재 미연동 X 거래처',persist:'2개월 이상 지속 X',all3:'3개사 모두 X',improved:'X→O 개선 거래처',worsened:'O→X 악화 거래처',compared:'전월 대비 비교 거래처',history:'월별 조치 이력',stopped:'7월 공급 중단(관리분류)',evaluated:'전체 O/X 평가 거래처',supply:'도도매 공급처 전체'};
const KPI_VIEWS={rate:'evaluated',delta:'compared',unlinked:'x',need:'x',persistent:'persist',all3:'all3',improved:'improved',worsened:'worsened',supply:'supply'};
function ensureHeroKpis(){
  const grid=document.querySelector('.ct-hero .ct-kpis');if(!grid)return;
  const rate=$('ctRate')?.closest('.ct-kpi'),delta=$('ctDelta')?.closest('.ct-kpi'),x=$('ctX')?.closest('.ct-kpi'),x2o=$('ctX2O')?.closest('.ct-kpi'),o2x=$('ctO2X')?.closest('.ct-kpi'),persist=$('ctPersist')?.closest('.ct-kpi'),all3=$('ctAll3')?.closest('.ct-kpi');
  if(!$('ctNeedAbs')){const card=document.createElement('div');card.className='ct-kpi ct-kpi-bad';card.innerHTML='<div class="l">연동이 필요한 도도매처수</div><div class="v" id="ctNeedAbs">-</div><div class="s" id="ctNeedAbsSub">실사업자번호 기준 연동 필요 절대처수</div>';grid.appendChild(card);}
  if(!$('ctSupply')){const card=document.createElement('div');card.className='ct-kpi ct-kpi-info';card.innerHTML='<div class="l">도도매 공급처수</div><div class="v" id="ctSupply">-</div><div class="s" id="ctSupplySub">현재 공급 중인 도도매 절대처수</div>';grid.appendChild(card);}
  [rate,delta,x,$('ctNeedAbs')?.closest('.ct-kpi'),persist,all3,x2o,o2x,$('ctSupply')?.closest('.ct-kpi')].forEach(el=>{if(el)grid.appendChild(el);});
  rate?.classList.add('ct-kpi-good');delta?.classList.add('ct-kpi-delta');x?.classList.add('ct-kpi-bad');x2o?.classList.add('ct-kpi-good');o2x?.classList.add('ct-kpi-bad');persist?.classList.add('ct-kpi-warn');all3?.classList.add('ct-kpi-bad');
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
  const risk=null; // Risk TOP20 duplicates the unified Action Board; removed from markup.
  const action=ctPanels.find(x=>x.querySelector('h2')?.textContent.includes('통합 Action Board'));
  if(group){group.id='ctGroup';group.classList.add('ct-overview-section');}if(outlet){outlet.id='ctOutlet';outlet.classList.add('ct-overview-section');}
  if(aging)aging.id='ctAging';if(ai)ai.id='ctAiSection';if(risk)risk.id='ctRisk';if(action)action.id='ctAction';if(changes){changes.id='ctChanges';trimDuplicateChangeCards(changes);}if(need)need.id='ctNeed';if(legacyKpis)legacyKpis.classList.add('ct-source-kpis');
  let anchor=filters;[group,outlet,changes,aging,ai,action,need].forEach(el=>{if(!el)return;anchor.insertAdjacentElement('afterend',el);anchor=el;});
   const srm=$('srmWorkflow');if(srm&&action)action.insertAdjacentElement('afterend',srm);
   if(legacyKpis)main.appendChild(legacyKpis);
  let nav=$('ctQuickNav');if(!nav){nav=document.createElement('div');nav.id='ctQuickNav';nav.className='ct-quick-nav';filters.insertAdjacentElement('afterend',nav);}
  nav.innerHTML='<button data-jump="ctGroup">그룹사별 현황</button><button data-jump="ctOutlet">업체별 현황</button><button data-jump="ctChanges">전월 대비 변화</button><button data-jump="ctAging">Aging & Target</button><button data-jump="ctAction">통합 Action Board</button><button data-jump="ctNeed">연동 필요 리스트</button>';
  document.querySelectorAll('#ctQuickNav [data-jump]').forEach(btn=>btn.onclick=()=>{const target=$(btn.dataset.jump);if(!target)return;target.scrollIntoView({behavior:'smooth',block:'start'});});
  syncHeroSupportKpis();['kpiAbs','kpiSupply','kpiAbsSub','kpiSupplySub','ctDelta'].forEach(id=>{const node=$(id);if(node)new MutationObserver(syncHeroSupportKpis).observe(node,{childList:true,subtree:true,characterData:true});});['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>setTimeout(syncHeroSupportKpis,80)));
}
function localActions(){try{const x=JSON.parse(localStorage.getItem(ACTION_KEY));return Array.isArray(x)?x:[];}catch(e){return [];}}
function renderReasonPareto(rows){const box=$('ctReasonBars');if(!box)return;const reasons=window.DCM_ACTION_REASONS||{},riskKeys=new Set((rows||window.DCMActionSync?.allRisk?.()||[]).map(r=>r.key));const used={};localActions().filter(a=>riskKeys.has(a.key)).forEach(a=>{if(a.reasonCode&&reasons[a.reasonCode])used[a.reasonCode]=(used[a.reasonCode]||0)+1;});const total=Object.values(used).reduce((a,b)=>a+b,0)||1;box.innerHTML=Object.entries(used).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="ct-bar-row"><span>${esc(reasons[k])}</span><div class="ct-bar"><i style="width:${v/total*100}%"></i></div><b>${v}</b></div>`).join('')||'<div class="ct-note">현재 필터 범위의 Action Board에서 원인코드를 입력하면 자동 집계됩니다.</div>';}
function saveBoardField(k,field,value){
 const rows=changeData(),latest=changeMonths(rows).slice(-1)[0],cur=$('month')?.value||latest;
 const record=rows.find(r=>r.month===cur&&r.outlet+'|||'+r.businessNo===k);
 if(cur!==latest||!record||!window.DCMActionSync?.canEditFor?.(record.manager)){
  if($('ctSyncStatus'))$('ctSyncStatus').textContent='수정 권한 없음 · 담당자 선택·개인 PIN 또는 기준월을 확인하세요.';
  renderAllXActionBoard();return;
 }
 const actions=localActions();let a=actions.find(x=>x.key===k);if(!a){const [outlet,businessNo]=k.split('|||');a={key:k,outlet,businessNo,history:[]};actions.push(a);}a[field]=value;a.updatedAt=new Date().toISOString();a.history=Array.isArray(a.history)?a.history:[];a.history.unshift({at:a.updatedAt,field,value});a.history=a.history.slice(0,50);localStorage.setItem(ACTION_KEY,JSON.stringify(actions));if(field==='reasonCode')renderReasonPareto();}
function ensureActionControls(){
 const panel=$('ctAction'),tbody=$('ctActionBody');if(!panel||!tbody)return;
 panel.classList.add('ct-action-open','ct-action-unified');panel.classList.remove('ct-action-lazy','ct-action-collapsed');
 const tableWrap=tbody.closest('.table-scroll');
 if(tableWrap&&!$('ctActionMoreWrap')){
  const more=document.createElement('div');more.id='ctActionMoreWrap';more.className='ct-action-more';
  more.innerHTML='<span id="ctActionShown"></span><button class="ct-btn" id="ctActionMore" type="button">50건 더 보기</button><button class="ct-btn" id="ctActionAll" type="button">전체 보기</button>';
  tableWrap.insertAdjacentElement('afterend',more);
  $('ctActionMore').addEventListener('click',()=>{actionLimit+=PAGE_SIZE;renderAllXActionBoard();});
  $('ctActionAll').addEventListener('click',()=>{actionLimit=Number.MAX_SAFE_INTEGER;renderAllXActionBoard();});
 }
}
function openActionBoard(){
 actionOpen=true;const panel=$('ctAction');panel?.classList.remove('ct-action-collapsed');panel?.classList.add('ct-action-open');renderAllXActionBoard();
}
function closeActionBoard(){/* Unified Action Board remains visible and replaces Risk TOP20. */}
function readonlyPartnerMarkup(r,field){
  const p=r.partnerAction||{},edited=Array.isArray(p.editedFields)&&p.editedFields.includes(field);
  const explanations=window.DCM_ACTION_REASONS||{};
  let value=edited?(p[field]||''):'';
  if(field==='reasonCode'&&value)value=value+' '+(explanations[value]||'');
  if(field==='status'&&value)value=statusLabel(value);
  const display=edited?(value||'(빈 값으로 입력)'):'입력 없음';
  const timestamp=edited?(p.updatedAt||''):'';
  const style=edited?'ct-partner-entry filled':'ct-partner-entry';
  return `<div class="${style}"><b>업체</b><span title="${esc(timestamp)}">${esc(display)}</span></div>`;
}
function masterInputMarkup(r,field){
  const reasons=window.DCM_ACTION_REASONS||{},k=esc(r.key);
  if(field==='reasonCode')return `<select data-allx-field="reasonCode" data-key="${k}"><option value="">원인 선택</option>${Object.entries(reasons).map(([code,label])=>`<option value="${esc(code)}" ${r.reasonCode===code?'selected':''}>${esc(code)} ${esc(label)}</option>`).join('')}</select>`;
  if(field==='status')return `<select data-allx-field="status" data-key="${k}">${['TODO','IN_PROGRESS','WAITING','DONE'].map(x=>`<option value="${x}" ${(r.status||'TODO')===x?'selected':''}>${statusLabel(x)}</option>`).join('')}</select>`;
  if(field==='dueDate')return `<input type="date" data-allx-field="dueDate" data-key="${k}" value="${esc(r.dueDate||'')}">`;
  return `<input type="text" data-allx-field="plan" data-key="${k}" value="${esc(r.plan||'')}" placeholder="마스터 조치계획">`;
}
function buildBoardContext(){
 const L=window.DCMLogic||{},data=changeData(),months=changeMonths(data),cur=$('month')?.value||months[months.length-1]||'',idx=months.indexOf(cur),prev=idx>0?months[idx-1]:null;
 window.DCM_MONTHLY_ACTION_HISTORY?.refresh(data);
 const curr=changeScope(data,cur),prior=prev?changeScope(data,prev):[],changes=L.compare(prior,curr);
 const risk=window.DCMActionSync?.allRisk?.()||[],riskMap=new Map(risk.map(r=>[r.key,r]));
 const stored=new Map(localActions().map(a=>[a.key,a]));
 const prevMap=new Map(prior.map(r=>[r.outlet+'|||'+r.businessNo,r]));
 const improved=new Map(),worsened=new Map();
 for(const [map,list] of [[improved,changes.xToO||[]],[worsened,changes.oToX||[]]]){
  list.forEach(item=>{const k=item.outlet+'|||'+item.businessNo;if(!map.has(k))map.set(k,new Set());map.get(k).add(item.entity);});
 }
 const rowHistory=new Map();
 data.filter(r=>r.month<=cur&&months.includes(r.month)).forEach(r=>{const k=r.outlet+'|||'+r.businessNo;if(!rowHistory.has(k))rowHistory.set(k,new Map());rowHistory.get(k).set(r.month,r);});
 const byKey=new Map();
 for(const r of curr){
  const k=r.outlet+'|||'+r.businessNo,priorRow=byKey.get(k);
  const base=riskMap.get(k)||stored.get(k)||{};
  const entityStreak={};let streak=0;
  for(const e of L.E||[]){
   let n=0;
   for(let i=idx;i>=0;i--){const at=rowHistory.get(k)?.get(months[i]);if(L.normStatus(at?.statuses?.[e])==='X')n++;else break;}
   entityStreak[e]=n;streak=Math.max(streak,n);
  }
  const currentX=(L.E||[]).filter(e=>L.normStatus(r.statuses?.[e])==='X').length;
  const merged={...base,...r,key:k,priority:riskMap.get(k)?.priority||'P3',score:riskMap.get(k)?.score||0,
    xCount:currentX,aging:streak+'M',entityStreak,
    reasonCode:base.reasonCode||'',plan:base.plan||'',dueDate:base.dueDate||'',status:base.status||'TODO',
    partnerAction:base.partnerAction||{},canEdit:currentX>0||stored.has(k)};
  const archived=window.DCM_MONTHLY_ACTION_HISTORY?.get(cur,k);
  if(archived){Object.assign(merged,archived.masterAction,{monthlyHistorical:true,historyType:archived.type||'X2O',masterAction:{...archived.masterAction},partnerAction:{...archived.partnerAction},canEdit:false});}
  if(!merged.monthlyHistorical)
    merged.canEdit=cur===months[months.length-1]&&!!window.DCMActionSync?.canEditFor?.(merged.manager);
  if(!priorRow||merged.score>=priorRow.score)byKey.set(k,merged);
 }
 for(const entry of window.DCM_MONTHLY_ACTION_HISTORY?.forMonth(cur)||[]){
  if(byKey.has(entry.key))continue;
  // Archived July records missing in the month’s sales dataset are synthetic,
  // read-only rows. They must NEVER enter the live Action Board save path.
  const [outlet,businessNo]=entry.key.split('|||');
  const previous=prevMap.get(entry.key)||rowHistory.get(entry.key)?.get('2026-06');
  if($('outlet')?.value!=='전체'&&outlet!==$('outlet')?.value)continue;
  if($('manager')?.value!=='전체'&&entry.manager!==$('manager')?.value&&previous?.manager!==$('manager')?.value)continue;
  byKey.set(entry.key,{
   key:entry.key,outlet,businessNo,businessName:entry.businessName,manager:entry.manager||previous?.manager||'',
   statuses:{'대웅제약':null,'대웅바이오':null,'한올바이오':null},
   priority:'P3',score:0,xCount:0,aging:'0M',entityStreak:{},
   monthlyHistorical:true,historyType:entry.type||'X2O',masterAction:{...entry.masterAction},
   partnerAction:{...entry.partnerAction},reasonCode:'',plan:'',dueDate:'',status:'',canEdit:false
  });
 }
 const rows=[...byKey.values()].sort((a,b)=>b.score-a.score||b.xCount-a.xCount||
   String(a.businessName||'').localeCompare(String(b.businessName||''),'ko'));
 return {rows,improved,worsened,prevMap,month:cur};
}
function filterUnifiedRows(ctx,view='x',entity='all',priority='all',search=''){
 const L=window.DCMLogic||{},E=L.E||[],scope=entity==='all'?E:[entity];
 const q=String(search||'').trim().toLocaleLowerCase('ko');
 return ctx.rows.filter(r=>{
  const key=r.key,current=r.statuses||{},before=ctx.prevMap.get(key)?.statuses||{};
  if(priority!=='all'&&r.priority!==priority)return false;
  let ok=false;
  switch(view){
   case 'x':ok=scope.some(e=>L.normStatus(current[e])==='X');break;
   case 'persist':ok=scope.some(e=>L.normStatus(current[e])==='X'&&(r.entityStreak?.[e]||0)>=2);break;
   case 'all3':ok=E.every(e=>L.normStatus(current[e])==='X');break;
   case 'improved':ok=scope.some(e=>ctx.improved.get(key)?.has(e));break;
   case 'worsened':ok=scope.some(e=>ctx.worsened.get(key)?.has(e));break;
   case 'compared':ok=scope.some(e=>L.normStatus(current[e])&&L.normStatus(before[e]));break;
   case 'history':ok=!!window.DCM_MONTHLY_ACTION_HISTORY?.get(ctx.month,key)?.entities.some(e=>scope.includes(e));break;
   case 'stopped':ok=window.DCM_MONTHLY_ACTION_HISTORY?.get(ctx.month,key)?.type==='SUPPLY_STOP'&&!!window.DCM_MONTHLY_ACTION_HISTORY?.get(ctx.month,key)?.entities.some(e=>scope.includes(e));break;
   case 'evaluated':
   case 'supply':ok=scope.some(e=>L.normStatus(current[e]));break;
   default:ok=false;
  }
  if(!ok)return false;
  return !q||[r.businessName,r.businessNo,r.outlet,r.manager].some(v=>String(v||'').toLocaleLowerCase('ko').includes(q));
 });
}
function renderAllXActionBoard(){
 const tbody=$('ctActionBody');if(!actionOpen||!tbody)return;
 const L=window.DCMLogic,E=L?.E||[],ctx=buildBoardContext();
 const rows=filterUnifiedRows(ctx,actionView,actionEntity,actionPriority,actionSearch),visible=rows.slice(0,actionLimit);
 const reasons=window.DCM_ACTION_REASONS||{};
 const historicalField=(a,field)=>{
    const value=a?.[field]||'';
    if(field==='reasonCode')return value?value+' '+((window.DCM_ACTION_REASONS||{})[value]||''):'—';
    if(field==='status')return value?statusLabel(value):'—';
    return value||'—';
  };
  const dual=(r,field)=>'<td class="ct-dual-cell"><div class="ct-master-entry"><b>마스터</b>'+
   (r.monthlyHistorical?'<span class="ct-historical-value" title="DCM 개선 결과 기반 사후 정리">'+esc(historicalField(r.masterAction,field))+'</span>':
   (r.canEdit?masterInputMarkup(r,field):'<span class="ct-readonly">해당 담당자 수정 PIN으로 공용 Sync에 접속하고 최신월을 선택해야 입력 가능합니다</span>'))+
   '</div>'+readonlyPartnerMarkup(r,field)+'</td>';
 const status=(r,e)=>{
  const st=L.normStatus(r.statuses?.[e])||'—';
  return '<td class="ct-ox-cell"><span class="ct-status-badge '+(st==='O'?'o':st==='X'?'x':'na')+'" title="'+esc(e)+' '+(st==='O'?'연동':st==='X'?'미연동':'미평가')+'">'+st+'</span></td>';
 };
 tbody.innerHTML=visible.map(r=>'<tr>'+
  '<td><span class="ct-priority ct-'+String(r.priority||'P3').toLowerCase()+'">'+esc(r.priority||'P3')+'</span></td>'+
  '<td class="ct-score"><strong title="현재 미연동 그룹사 '+r.xCount+'건 · Risk 기반 점수">'+(Number(r.score)||0)+'</strong></td>'+
  '<td class="ct-merchant"><strong>'+esc(r.businessName||'')+'</strong><small>'+esc(r.businessNo||'')+'</small>'+(r.monthlyHistorical?'<small class="ct-monthly-archive" title="DCM O/X 개선 결과 기반 사후 등록 이력">'+(r.historyType==='SUPPLY_STOP'?'7월 공급 중단(관리분류)':'월별 X→O 조치 이력')+'</small>':'')+'<button type="button" class="srm-launch" data-srm-open="'+esc(r.key)+'">SRM 협의</button></td>'+
  '<td>'+esc(r.outlet||'')+'</td><td>'+esc(r.manager||'')+'</td>'+
  E.map(e=>status(r,e)).join('')+
  '<td>'+esc(r.aging||'0M')+'</td>'+
  ['reasonCode','plan','dueDate','status'].map(f=>dual(r,f)).join('')+'</tr>').join('')||
  '<tr><td colspan="13" class="empty">선택한 조건에 해당하는 거래처가 없습니다. 필터를 변경해 주세요.</td></tr>';
 tbody.querySelectorAll('[data-allx-field]').forEach(el=>el.addEventListener('change',()=>{
  saveBoardField(el.dataset.key,el.dataset.allxField,el.value);
 }));
 const baseRisk=window.DCMActionSync?.allRisk?.()||[];renderReasonPareto(baseRisk);
 const assessed=rows.reduce((n,r)=>n+E.filter(e=>L.normStatus(r.statuses?.[e])).length,0);
 const xcount=rows.reduce((n,r)=>n+E.filter(e=>L.normStatus(r.statuses?.[e])==='X').length,0);
 if($('ctActionViewName'))$('ctActionViewName').textContent=ACTION_VIEWS[actionView]||ACTION_VIEWS.x;
 if($('ctActionCount'))$('ctActionCount').textContent=rows.length.toLocaleString()+'처 · O '+(assessed-xcount).toLocaleString()+'건 / X '+xcount.toLocaleString()+'건';
 const shown=$('ctActionShown'),more=$('ctActionMore'),all=$('ctActionAll');
 if(shown)shown.textContent=Math.min(visible.length,rows.length).toLocaleString()+' / '+rows.length.toLocaleString()+'처 표시';
 if(more)more.hidden=visible.length>=rows.length;
 if(all)all.hidden=visible.length>=rows.length;
 document.querySelectorAll('.ct-hero .ct-kpi[data-kpi]').forEach(card=>{
  const chosen=card.dataset.kpi===activeKpi;card.classList.toggle('ct-kpi-selected',chosen);
  card.setAttribute('aria-pressed',chosen?'true':'false');
 });
}
function scheduleActionRender(delay=100){clearTimeout(actionTimer);actionTimer=setTimeout(renderAllXActionBoard,delay);}
function setActionView(view,{scroll=true,kpi=null}={}){
 actionView=Object.hasOwn(ACTION_VIEWS,view)?view:'x';activeKpi=kpi;
 actionEntity='all';actionPriority='all';actionSearch='';actionLimit=PAGE_SIZE;
 if($('ctActionView'))$('ctActionView').value=actionView;
 if($('ctActionEntity'))$('ctActionEntity').value='all';
 if($('ctActionPriority'))$('ctActionPriority').value='all';
 if($('ctActionSearch'))$('ctActionSearch').value='';
 renderAllXActionBoard();
 if(scroll)$('ctAction')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function installAllXBoard(){
 const tbody=$('ctActionBody');if(!tbody)return;ensureActionControls();
 for(const [id,variable] of [['ctActionView','view'],['ctActionEntity','entity'],['ctActionPriority','priority'],['ctActionSearch','search']]){
  const el=$(id);if(!el)continue;
  el.addEventListener(variable==='search'?'input':'change',()=>{
   actionView=$('ctActionView')?.value||'x';actionEntity=$('ctActionEntity')?.value||'all';
   actionPriority=$('ctActionPriority')?.value||'all';actionSearch=$('ctActionSearch')?.value||'';
   activeKpi=null;actionLimit=PAGE_SIZE;scheduleActionRender(variable==='search'?75:0);
  });
 }
 $('ctActionClear')?.addEventListener('click',()=>setActionView('x',{scroll:false}));
 document.querySelectorAll('.ct-hero .ct-kpi[data-kpi]').forEach(card=>{
  const view=KPI_VIEWS[card.dataset.kpi];if(!view)return;
  card.setAttribute('role','button');card.tabIndex=0;card.setAttribute('aria-controls','ctAction');
  card.title='클릭하면 '+ACTION_VIEWS[view]+' 목록이 열립니다.';
  card.addEventListener('click',()=>setActionView(view,{kpi:card.dataset.kpi}));
  card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setActionView(view,{kpi:card.dataset.kpi});}});
 });
 ['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>{actionLimit=PAGE_SIZE;scheduleActionRender(120);}));
 window.addEventListener('dcm-action-sync-applied',()=>scheduleActionRender(80));
 window.addEventListener('dcm-sync-access-changed',()=>scheduleActionRender(40));
 window.addEventListener('dcm-action-reasons-updated',()=>scheduleActionRender(80));
 window.addEventListener('storage',e=>{if(e.key===ACTION_KEY||e.key===DATA_KEY)scheduleActionRender(80);});
 renderAllXActionBoard();
}
window.DCMUnifiedAction={filter:filterUnifiedRows,build:buildBoardContext,select:setActionView};
window.addEventListener('load',()=>{installLayout();installChangeFilterFix();installAllXBoard();renderReasonPareto();setTimeout(syncHeroSupportKpis,120);const old=document.getElementById('resetBtn');if(!old)return;const b=old.cloneNode(true);old.replaceWith(b);b.onclick=()=>{if(!confirm('브라우저에 추가한 월별 데이터와 Action 이력을 지우고 최초 6월/7월 데이터로 복원할까요?'))return;localStorage.setItem(DATA_KEY,JSON.stringify(window.DCM_BASE_DATA||[]));localStorage.setItem(ACTION_KEY,'[]');location.reload();};});
})();