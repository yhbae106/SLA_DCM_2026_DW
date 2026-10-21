(()=>{
'use strict';
const CFG=window.DCM_ACTION_SYNC||{}, REASONS=window.DCM_ACTION_REASONS||{};
const ACTION_KEY='dcm-dashboard-v10-actions';
const DATA_KEY='dcm-dashboard-v8-data';
const EDITOR_KEY='dcm-action-sync-editor';
const LEGACY_TOKEN_KEY='dcm-action-sync-key';
const SESSION_TOKEN_KEY='dcm-action-sync-session-token';
const SESSION_EDITOR_KEY='dcm-action-sync-session-editor';
const REMOTE_HASH_KEY='dcm-action-sync-last-remote';
const REASON_HASH_KEY='dcm-action-sync-reason-hash';
const RISK_HASH_KEY='dcm-action-sync-risk-hash';
const REASON_SCHEMA_KEY='dcm-action-reason-schema-v2';
const REQUIRED_API_VERSION='20261008-seven-reasons-fast-v3';
const PENDING_KEY='dcm-action-master-pending-v1';
const ACTIVE_ACTION_FIELDS=['reasonCode','plan','status'];
const originalSetItem=Storage.prototype.setItem;
let suppressSync=false,pollTimer=null,snapshotTimer=null,lastMeta=null,lastPullAt=0,lastEditAt=0,syncBroken=false,serverReady=false,flushingPending=false,signedIn=false,loginBusy=false,lastRevision=null,revisionSupported=false;
let authGeneration=0,actionEpoch=0,pullTask=null;
const activeRequests=new Set();
function retireSession(){authGeneration++;actionEpoch++;activeRequests.forEach(c=>c.abort());activeRequests.clear();clearTimeout(snapshotTimer);snapshotTimer=null;pullTask=null;flushingPending=false;loginBusy=false;}
function retiredRequest(){const e=Error('종료된 세션의 요청입니다.');e.stale=true;return e;}
function validateActions(rows){
 if(!Array.isArray(rows))throw Error('공용 조치 목록의 형식을 확인할 수 없습니다.');
 const keys=new Set();for(const a of rows){
  if(!a||typeof a.key!=='string'||a.key.split('|||').length!==2||a.key.split('|||').some(v=>!v.trim())||keys.has(a.key))throw Error('공용 조치 목록에 잘못되거나 중복된 거래처가 있습니다.');
  if(a.status!=null&&!['','TODO','IN_PROGRESS','WAITING','DONE'].includes(a.status))throw Error('공용 조치 상태를 확인할 수 없습니다.');
  keys.add(a.key);
 }
 return rows;
}
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
function endpoint(){return String(CFG.endpoint||'').trim();}
function token(){return sessionStorage.getItem(SESSION_TOKEN_KEY)||'';}
function masterPassword(){return editor()==='배영훈'&&window.DCMMasterSync?.isMaster?.()?sessionStorage.getItem('dcm-dashboard-master-password')||'':'';}
function hasReadAuth(){return !!token()||!!masterPassword();}
function editor(){return localStorage.getItem(EDITOR_KEY)||CFG.editors?.[0]||'';}
const EDITOR_PIN_SESSION='dcm-sync-editor-pin-session';
const SYNC_EDITOR_NAMES=['배영훈','정직한','임인숙'];
function editorPin(){return sessionStorage.getItem(EDITOR_PIN_SESSION)||'';}
function canEditFor(manager){
 const user=editor(),owner=String(manager||'').trim();
 return hasReadAuth()&&SYNC_EDITOR_NAMES.includes(owner)&&
   ((user==='배영훈'&&!!window.DCMMasterSync?.isMaster?.())||
    (!!editorPin()&&(user==='배영훈'||user===owner)));
}
function updateEditAccess(){window.dispatchEvent(new CustomEvent('dcm-sync-access-changed',{detail:{editor:editor(),hasPin:!!editorPin()}}));}
function hash(v){try{return JSON.stringify(v||[]);}catch(e){return ''}}
function getLocalActions(){try{const x=JSON.parse(localStorage.getItem(ACTION_KEY));return Array.isArray(x)?x:[];}catch(e){return []}}
function migrateRetiredReason08(){
  const actions=getLocalActions(),pending=pendingEdits();let changed=false,pendingChanged=false;
  actions.forEach(a=>{if(a?.reasonCode==='08'){a.reasonCode='05';changed=true;}});
  pending.forEach(a=>{if(a?.reasonCode==='08'){a.reasonCode='05';pendingChanged=true;}});
  if(changed){suppressSync=true;originalSetItem.call(localStorage,ACTION_KEY,JSON.stringify(actions));suppressSync=false;}
  if(pendingChanged)originalSetItem.call(localStorage,PENDING_KEY,JSON.stringify(pending));
}
function migrateLegacyLocalReasons(){
 if(localStorage.getItem(REASON_SCHEMA_KEY)==='1')return;
 const map={'01':'01','02':'04','03':'03','04':'03','05':'06','06':'05','07':'','08':'03','09':'','99':''};
 const actions=getLocalActions();let changed=false;
 actions.forEach(a=>{const old=String(a?.reasonCode||'');if(old&&Object.prototype.hasOwnProperty.call(map,old)){const next=map[old];if(next!==old){a.reasonCode=next;changed=true;}}});
 if(changed){suppressSync=true;originalSetItem.call(localStorage,ACTION_KEY,JSON.stringify(actions));suppressSync=false;}
 localStorage.setItem(REASON_SCHEMA_KEY,'1');
}
function getData(){let rows=[];try{const x=JSON.parse(localStorage.getItem(DATA_KEY));if(Array.isArray(x)&&x.length)rows=x;}catch(e){}if(!rows.length){try{rows=JSON.parse(JSON.stringify(window.DCM_BASE_DATA||[]));}catch(e){rows=[];}}rows.forEach(r=>{if(r.outlet==='백제약품 대전')r.manager='정직한';});return rows;}
function rowKey(r){return `${r.outlet}|||${r.businessNo}`;}
function months(data){return [...new Set(data.map(r=>r.month).filter(Boolean))].sort();}
function currentMonth(data){return $('month')?.value||months(data).slice(-1)[0]||null;}
function scoped(data,m){const manager=$('manager')?.value||'전체',outlet=$('outlet')?.value||'전체';return data.filter(r=>r.month===m&&(manager==='전체'||r.manager===manager)&&(outlet==='전체'||r.outlet===outlet));}
function stableActions(actions){return (actions||[]).map(a=>({key:a.key||'',priority:a.priority||'',businessName:a.businessName||'',outlet:a.outlet||'',manager:a.manager||'',aging:a.aging||'',reasonCode:a.reasonCode||'',plan:a.plan||'',dueDate:a.dueDate||'',status:a.status||'TODO',modifiedBy:a.modifiedBy||'',updatedAt:a.updatedAt||'',partnerAction:a.partnerAction||null})).sort((a,b)=>String(a.key).localeCompare(String(b.key)));}
function actionHash(actions){return hash(stableActions(actions));}
function editableSig(a){return hash([a?.reasonCode||'',a?.plan||'',a?.status||'TODO']);}
function setStatus(text,state='idle',meta){const el=$('ctSyncStatus');if(!el)return;el.className=`ct-sync-status ${state}`;el.textContent=text;if(meta!==undefined){lastMeta=meta;const m=$('ctSyncMeta');if(m)m.textContent=meta||'';}}

function renderLoginUI(){
 const key=$('ctSyncKey'),login=$('ctSyncConnect'),pin=$('ctSyncPinRow');
 if(key)key.hidden=signedIn;
 if(login){login.textContent=loginBusy?'로그인 확인 중…':signedIn?'로그아웃':'로그인';login.disabled=loginBusy;}
 if($('ctSyncRefresh'))$('ctSyncRefresh').hidden=!signedIn;
 if($('ctSyncEditAuth')){
  $('ctSyncEditAuth').hidden=!signedIn;
  $('ctSyncEditAuth').textContent=editorPin()?'수정 PIN 변경':'수정 PIN 입력';
 }
 if(!signedIn&&pin)pin.hidden=true;
 if(masterPassword()&&key)key.hidden=true;
 if($('ctSyncSavePending'))$('ctSyncSavePending').hidden=!signedIn||!pendingEdits().length;
 const dot=$('ctSyncBar')?.querySelector('.ct-sync-dot');
 if(dot)dot.classList.toggle('connected',signedIn);
}
function logoutSync(reason='로그아웃했습니다.'){
 retireSession();
 sessionStorage.removeItem(SESSION_TOKEN_KEY);sessionStorage.removeItem(SESSION_EDITOR_KEY);
 sessionStorage.removeItem(EDITOR_PIN_SESSION);
 if($('ctSyncKey'))$('ctSyncKey').value='';
 if($('ctSyncEditorPin'))$('ctSyncEditorPin').value='';
 signedIn=false;serverReady=false;syncBroken=false;
 renderLoginUI();updateEditAccess();
 setStatus(reason,'idle','로그인하려면 올바른 공유키를 입력해 주세요.');
}
async function quickLogin(){
 const ticket=authGeneration;
 const json=await post({type:'syncLogin'});
 if(ticket!==authGeneration)throw retiredRequest();
 if(json.version!==REQUIRED_API_VERSION)throw new Error('연동 서버 버전 불일치 · Apps Script 최신 버전을 배포해 주세요.');
 signedIn=true;serverReady=true;syncBroken=false;renderLoginUI();updateEditAccess();
 setStatus('인증 완료 · Action 데이터 로딩 중','working');
 void pullRemote(true);
}
async function signInFromButton(){
 if(loginBusy)return;
 if(signedIn){logoutSync();return;}
 const key=String($('ctSyncKey')?.value||'').trim();
 if(!key){setStatus('공유키를 입력해 주세요.','error','로그인 버튼을 누르면 서버에서 실제 연결을 확인합니다.');return;}
 retireSession();const ticket=authGeneration;loginBusy=true;renderLoginUI();
 syncBroken=false;serverReady=false;
 sessionStorage.setItem(SESSION_TOKEN_KEY,key);
 sessionStorage.setItem(SESSION_EDITOR_KEY,editor());
 try{
  await quickLogin();
  if(ticket!==authGeneration)return;
  signedIn=true;
  if($('ctSyncKey'))$('ctSyncKey').value='';
  const n=pendingEdits().length;
  if(n)setStatus('로그인 인증 완료 · 미전송 수정 보관','working','미전송 수정 '+n+'건 · 수정 PIN 적용 후 저장해 주세요.');
 }catch(e){if(ticket!==authGeneration||e.stale)return;signedIn=false;serverReady=false;sessionStorage.removeItem(SESSION_TOKEN_KEY);sessionStorage.removeItem(SESSION_EDITOR_KEY);setStatus(e.status===404?'Apps Script 배포 주소 오류':e.message.includes('공유키')?'공유키 로그인 실패':'로그인 연결 실패','error',e.message);}finally{if(ticket===authGeneration){loginBusy=false;renderLoginUI();updateEditAccess();}}
}
function installUI(){
 const board=[...document.querySelectorAll('.ct-panel')].find(x=>x.querySelector('h2')?.textContent.includes('Action Board'));
 if(!board||$('ctSyncBar'))return;
 const head=board.querySelector('.section-head');if(!head)return;
 const wrap=document.createElement('div');wrap.id='ctSyncBar';wrap.className='ct-sync-bar';
 const opts=(CFG.editors||[]).map(x=>'<option value="'+esc(x)+'" '+(x===editor()?'selected':'')+'>'+esc(x)+'</option>').join('');
 wrap.innerHTML='<span class="ct-sync-title"><span class="ct-sync-dot"></span><strong>공용 Sync</strong></span>'+
 '<select id="ctSyncEditor" title="수정자" aria-label="수정자 선택">'+opts+'</select>'+
 '<input id="ctSyncKey" type="password" autocomplete="off" spellcheck="false" placeholder="공유키 입력" aria-label="공용 공유키">'+
 '<button type="button" class="ct-btn ct-sync-primary" id="ctSyncConnect">로그인</button>'+
 '<button type="button" class="ct-btn" id="ctSyncRefresh" hidden>새로고침</button>'+
 '<button type="button" class="ct-btn" id="ctSyncEditAuth" hidden>수정 PIN 입력</button>'+
 '<button type="button" class="ct-btn" id="ctSyncSavePending" hidden>미전송 저장</button>'+
 '<span id="ctSyncPinRow" class="ct-sync-pin-row" hidden><input id="ctSyncEditorPin" type="password" autocomplete="off" spellcheck="false" placeholder="개인 수정 PIN" aria-label="개인 수정 PIN"><button type="button" class="ct-btn" id="ctSyncPinApply">PIN 적용</button></span>'+
 '<span id="ctSyncStatus" class="ct-sync-status idle" role="status" aria-live="polite">로그인 필요</span>'+
 '<small id="ctSyncMeta" class="ct-sync-meta">공유키로 로그인 후 필요한 경우 수정 PIN을 입력합니다.</small>';
 head.appendChild(wrap);
 $('ctSyncEditor')?.addEventListener('change',e=>{
  localStorage.setItem(EDITOR_KEY,e.target.value);
  logoutSync('수정자가 변경되었습니다. 다시 로그인해 주세요.');
 });
 $('ctSyncConnect')?.addEventListener('click',signInFromButton);
 $('ctSyncKey')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void signInFromButton();}});
 $('ctSyncRefresh')?.addEventListener('click',()=>{if(signedIn)void pullRemote(true);});
 $('ctSyncEditAuth')?.addEventListener('click',()=>{if(!signedIn)return;const row=$('ctSyncPinRow');if(row){row.hidden=!row.hidden;if(!row.hidden)$('ctSyncEditorPin')?.focus();}});
 $('ctSyncPinApply')?.addEventListener('click',()=>{
  if(!signedIn)return;
  const pin=String($('ctSyncEditorPin')?.value||'').trim();
  if(!pin){setStatus('개인 수정 PIN을 입력해 주세요.','error');return;}
  sessionStorage.setItem(EDITOR_PIN_SESSION,pin);
  if($('ctSyncEditorPin'))$('ctSyncEditorPin').value='';
  if($('ctSyncPinRow'))$('ctSyncPinRow').hidden=true;
  renderLoginUI();updateEditAccess();
  setStatus('PIN 입력됨 · 실제 저장 시 서버에서 인증','ok','개인 PIN은 공유키와 별개이며, 저장 시 담당자 권한을 확인합니다.');
 });
 $('ctSyncSavePending')?.addEventListener('click',async()=>{
  if(!signedIn)return;
  if(!editorPin()&&!(editor()==='배영훈'&&!!window.DCMMasterSync?.isMaster?.())){
   setStatus('미전송 내용 저장에는 개인 수정 PIN이 필요합니다.','error');
   if($('ctSyncPinRow'))$('ctSyncPinRow').hidden=false;return;
  }
  const saved=await flushPendingEdits();
  if(saved)await pullRemote(true);
  renderLoginUI();
 });
 renderLoginUI();
}
function syncReasonOptions(){
 document.querySelectorAll('#ctActionBody select[data-field="reasonCode"],#ctActionBody select[data-allx-field="reasonCode"]').forEach(sel=>{
   const cur=sel.value;
   const html=['<option value="">원인 선택</option>',...Object.entries(REASONS).map(([k,v])=>`<option value="${esc(k)}">${esc(k)} ${esc(v)}</option>`)].join('');
   if(sel.dataset.reasonHtml!==html){sel.innerHTML=html;sel.dataset.reasonHtml=html;if(cur&&!Object.prototype.hasOwnProperty.call(REASONS,cur))sel.add(new Option(cur+' (이전 원인)',cur));sel.value=cur;}
 });
}
function allRiskRows(){
 const L=window.DCMLogic;if(!L)return [];
 const E=L.E||[],data=getData(),cur=currentMonth(data);if(!cur)return [];
 const ms=months(data),idx=ms.indexOf(cur),prev=idx>0?ms[idx-1]:null,curr=scoped(data,cur),prior=prev?scoped(data,prev):[];
 const pmap=new Map(prior.map(r=>[rowKey(r),r])),ch=L.compare(prior,curr),o2x=new Set((ch.oToX||[]).map(x=>`${x.outlet}|||${x.businessNo}|||${x.entity}`)),currentKeys=new Set(curr.map(rowKey));
 const by=new Map();data.filter(r=>ms.includes(r.month)&&r.month<=cur).forEach(r=>{const k=rowKey(r);if(!by.has(k))by.set(k,{});by.get(k)[r.month]=r;});
 const localMap=new Map(getLocalActions().map(a=>[a.key,a]));
 const out=[];
 by.forEach(hist=>{
   const r=hist[cur],k=r&&rowKey(r);if(!r||!currentKeys.has(k)||!E.some(e=>L.normStatus(r.statuses?.[e])==='X'))return;
   let streak=0,score=0,xCount=0;
   E.forEach(e=>{const n=L.consecutiveX(cur,m=>hist[m]?.statuses?.[e]);streak=Math.max(streak,n);if(L.normStatus(r.statuses?.[e])!=='X')return;xCount++;score+=2;if(n>=2)score+=3*Math.min(n-1,3);if(o2x.has(`${r.outlet}|||${r.businessNo}|||${e}`))score+=4;if(!L.normStatus(pmap.get(k)?.statuses?.[e]))score+=2;});
   const existing=localMap.get(k)||{};
   out.push({...existing,key:k,outlet:r.outlet||'',businessNo:r.businessNo||'',priority:score>=12?'P1':score>=7?'P2':'P3',businessName:r.businessName||'',manager:r.manager||'',aging:`${streak}M`,reasonCode:existing.reasonCode||'',plan:existing.plan||'',dueDate:existing.dueDate||'',status:existing.status||'TODO',modifiedBy:existing.modifiedBy||'',score,xCount});
 });
 return out.sort((a,b)=>b.score-a.score||b.xCount-a.xCount||String(a.businessName).localeCompare(String(b.businessName),'ko'));
}
function observeBoard(){
 const root=$('ctActionBody');if(root){
   const obs=new MutationObserver(()=>syncReasonOptions());obs.observe(root,{childList:true,subtree:true});
   root.addEventListener('change',()=>{lastEditAt=Date.now();},{capture:true});
 }
 syncReasonOptions();
 ['manager','outlet','month'].forEach(id=>$(id)?.addEventListener('change',()=>scheduleRiskSnapshot(900,false)));
 window.addEventListener('dcm-dashboard-data-committed',e=>{if(e.detail?.source==='excel')scheduleRiskSnapshot(100,false);});
}
function enrichActions(actions){
  // Resolve metadata from underlying merchant records, not from 9-/13-column DOM positions.
  const data=getData(),month=currentMonth(data),current=new Map(scoped(data,month).map(r=>[rowKey(r),r]));
  const risks=new Map(allRiskRows().map(r=>[r.key,r]));
  return (actions||[]).map(a=>{
    const record=current.get(a.key),risk=risks.get(a.key),metadata={};
    if(record){
      metadata.businessName=record.businessName||'';
      metadata.outlet=record.outlet||'';
      metadata.businessNo=record.businessNo||'';
      metadata.manager=record.manager||'';
    }
    if(risk){metadata.priority=risk.priority||'';metadata.aging=risk.aging||'';}
    return {...a,...metadata,modifiedBy:editor()};
  });
}
async function post(payload){
 if(!endpoint()||!hasReadAuth())throw new Error(!endpoint()?'Apps Script URL 미설정':'먼저 공용 Sync에 로그인해 주세요');
 if(payload.type==='save'&&!serverReady)throw new Error('공용 연결이 확인되지 않아 저장하지 않았습니다. 변경 내용은 이 브라우저에 남아 있습니다.');
 const ticket=authGeneration,identity=JSON.stringify([token(),editor(),masterPassword()]),controller=new AbortController();
 const timeout=['syncLogin','actionRevision'].includes(payload.type)?9000:payload.type==='load'?30000:24000;
 const timer=setTimeout(()=>controller.abort(),timeout);activeRequests.add(controller);
 const check=()=>{if(ticket!==authGeneration||identity!==JSON.stringify([token(),editor(),masterPassword()]))throw retiredRequest();};
 try{
  const res=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token:token(),editor:editor(),masterPassword:masterPassword()}),signal:controller.signal});
  check();if(!res.ok){const error=new Error(res.status===404?'HTTP 404 · Google Apps Script 배포 URL이 유효하지 않습니다':'HTTP '+res.status);error.status=res.status;throw error;}
  let json;try{json=await res.json();}catch(_){throw new Error('공용 저장소 응답을 읽지 못했습니다. 다시 조회해 주세요.');}
  check();if(json?.ok!==true)throw new Error(json?.error||'Sync 실패');return json;
 }catch(e){check();if(e.name==='AbortError')throw new Error('공용 저장소 응답 시간 초과 · '+timeout/1000+'초 · 연결을 확인해 주세요');throw e;}
 finally{clearTimeout(timer);activeRequests.delete(controller);}
}
function pendingEdits(){
 try{const x=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');return Array.isArray(x)?x.map(a=>({...a,changedFields:(a.changedFields||[]).filter(f=>ACTIVE_ACTION_FIELDS.includes(f))})).filter(a=>a.changedFields.length):[];}catch(e){return [];}
}
function stagePendingEdits(changes){
 const map=new Map(pendingEdits().filter(a=>a&&a.key).map(a=>[a.key,a]));
 (changes||[]).forEach(a=>{
   if(!a||!a.key)return;
   const old=map.get(a.key)||{key:a.key,changedFields:[]};
   ['outlet','businessNo','priority','businessName','manager','aging'].forEach(f=>{
     if(a[f]!==undefined)old[f]=a[f];
   });
   const fields=Array.isArray(a.changedFields)?a.changedFields:
     ACTIVE_ACTION_FIELDS.filter(f=>Object.prototype.hasOwnProperty.call(a,f));
   fields.forEach(f=>{
     if(!ACTIVE_ACTION_FIELDS.includes(f))return;
     old[f]=String(a[f]??'');
     if(!old.changedFields.includes(f))old.changedFields.push(f);
   });
   if(old.changedFields.length)map.set(a.key,old);
 });
 originalSetItem.call(localStorage,PENDING_KEY,JSON.stringify([...map.values()]));
}
function acknowledgePendingEdits(sent){
 const map=new Map(pendingEdits().filter(a=>a?.key).map(a=>[a.key,a]));
 sent.forEach(a=>{
   const current=map.get(a.key);
   if(!current)return;
   (a.changedFields||[]).forEach(f=>{
     if(String(current[f]??'')===String(a[f]??'')){
       current.changedFields=current.changedFields.filter(x=>x!==f);
       delete current[f];
     }
   });
   if(!current.changedFields.length)map.delete(a.key);
 });
 originalSetItem.call(localStorage,PENDING_KEY,JSON.stringify([...map.values()]));
}
async function flushPendingEdits(){
 if(flushingPending||!serverReady)return false;
 const ticket=authGeneration;if(!pendingEdits().length)return true;
 flushingPending=true;
 try{
  let items;
  while((items=pendingEdits()).length){
   if(ticket!==authGeneration)throw retiredRequest();
   setStatus('저장 대기 '+items.length+'건 전송 중…','working');
   const enriched=enrichActions(items),expected=editor(),isMaster=expected==='배영훈'&&!!window.DCMMasterSync?.isMaster?.();
   if(!isMaster&&!editorPin())throw new Error('개인별 수정 PIN을 입력한 후 공용 Sync에 연결해 주세요.');
   for(const a of enriched){if(!canEditFor(a.manager))throw new Error('편집 권한 없음: '+expected+' 담당 거래처만 수정할 수 있습니다 ('+a.key+').');}
   actionEpoch++;
   const json=await post({type:'save',mode:'edit',editor:expected,editorPin:editorPin(),masterPassword:isMaster?sessionStorage.getItem('dcm-dashboard-master-password')||'':'',actions:enriched});
   if(ticket!==authGeneration)throw retiredRequest();
   if(!Number.isInteger(json.changedRows)||json.changedRows<0||json.changedRows>items.length)throw Error('공용 저장 결과를 확인하지 못했습니다. 미전송 내용을 보관합니다.');
   acknowledgePendingEdits(items);actionEpoch++;
   const remaining=pendingEdits().length;
   setStatus(remaining?'새 수정 '+remaining+'건 저장 대기':'저장 확인 ✓',remaining?'working':'ok',json.updatedAt?
    '공용 마지막 수정: '+(json.updatedBy||editor())+' · '+new Date(json.updatedAt).toLocaleString('ko-KR'):'전송한 변경사항의 공용 저장을 확인했습니다.');
  }
  return true;
 }catch(e){
  if(ticket===authGeneration&&!e.stale){console.warn('[DCM Action Sync] pending save failed',e);setStatus('로컬 임시보관 · 공용 저장 확인 필요','error',e.message);}
  return false;
 }finally{if(ticket===authGeneration){flushingPending=false;renderLoginUI();}}
}
async function pushChanged(actions){
 if(!actions?.length)return;
 stagePendingEdits(actions);
 if(!serverReady){
   setStatus('미전송 수정 내용 보관 중','error','공용 Sync 로그인과 수정 PIN 인증 후 다시 저장해 주세요.');
   return;
 }
 await flushPendingEdits();
}

function riskSignature(snapshot){return hash((snapshot||[]).map(a=>[a.key,a.priority,a.businessName,a.outlet,a.manager,a.aging]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
async function pushRiskSnapshot(force=false){
 if(!endpoint()||!hasReadAuth()||syncBroken||!serverReady)return;
 const snapshot=allRiskRows();if(!snapshot.length)return;
 const ticket=authGeneration,sig=riskSignature(snapshot);if(!force&&sessionStorage.getItem(RISK_HASH_KEY)===sig)return;
 try{
   if(!pendingEdits().length&&!flushingPending)setStatus('거래처 목록 동기화 중…','working');
   actionEpoch++;
   const json=await post({type:'save',mode:'snapshot',editor:editor(),actions:snapshot});
   if(ticket!==authGeneration)return;
   if(!Number.isInteger(json.changedRows)||json.changedRows<0||json.changedRows>snapshot.length)throw Error('거래처 목록 저장 결과를 확인하지 못했습니다.');
   actionEpoch++;sessionStorage.setItem(RISK_HASH_KEY,sig);
   const meta=json.updatedAt?`마지막 수정: ${json.updatedBy||'-'} · ${new Date(json.updatedAt).toLocaleString('ko-KR')}`:`Risk ${snapshot.length}건 확인`;
   if(!pendingEdits().length&&!flushingPending)setStatus(`거래처 목록 ${snapshot.length}건 동기화 확인`,'ok',meta);
 }catch(e){if(ticket!==authGeneration||e.stale)return;console.warn('[DCM Action Sync] risk snapshot failed',e);if(!pendingEdits().length&&!flushingPending)setStatus('거래처 목록 동기화 확인 필요','error',e.message);}
}
function scheduleRiskSnapshot(delay=900,force=false){if(snapshotTimer)clearTimeout(snapshotTimer);const ticket=authGeneration;snapshotTimer=setTimeout(()=>{if(ticket===authGeneration)void pushRiskSnapshot(force);},delay);}
function isEditing(){return !!document.activeElement?.closest?.('#ctActionBody')||Date.now()-lastEditAt<8000;}
function pullRemote(force=false){
 if(pullTask)return pullTask;
 installUI();
 if(!endpoint()){setStatus('Apps Script 연동 주소 미설정','error');return Promise.resolve(false);}
 if(!hasReadAuth()){setStatus('공유키 로그인 필요','idle');return Promise.resolve(false);}
 if(!force&&(syncBroken||!signedIn||document.visibilityState!=='visible'||isEditing()))return Promise.resolve(false);
 const ticket=authGeneration,epoch=actionEpoch,before=localStorage.getItem(ACTION_KEY);
 const task=(async()=>{
  try{
   setStatus('공용 조치 데이터 확인 중…','working');
   const json=await post({type:'load'});if(ticket!==authGeneration)return false;
   if(json.version!==REQUIRED_API_VERSION){serverReady=false;syncBroken=true;setStatus('연동 서버 버전 불일치','error','관리자가 서버 배포 버전을 확인해야 합니다.');return false;}
   const remote=validateActions(json.actions);
   serverReady=true;syncBroken=false;signedIn=true;renderLoginUI();updateEditAccess();
   const pending=pendingEdits().length;
   if(pending){
    setStatus('연결됨 · 미전송 수정 '+pending+'건 보존','working','공용 조회 인증은 성공했습니다. 수정 PIN을 적용하고 미전송 저장을 눌러주세요.');return true;
   }
   if(epoch!==actionEpoch||localStorage.getItem(ACTION_KEY)!==before||flushingPending){setStatus('조회 중 변경한 내용 유지','working','다음 새로고침에서 최신 공용 자료를 다시 확인합니다.');return true;}
   if(Object.prototype.hasOwnProperty.call(json,'revision')){lastRevision=json.revision;revisionSupported=true;}
   const rHash=actionHash(remote),lHash=actionHash(getLocalActions());
   const meta='조회 확인: '+new Date().toLocaleString('ko-KR')+(json.updatedAt?' · 공용 마지막 수정: '+(json.updatedBy||'-')+' · '+new Date(json.updatedAt).toLocaleString('ko-KR'):'');
   if(rHash!==lHash){
    if(isEditing()&&!force){setStatus('새 공용 데이터 있음 · 작성 내용 유지','working',meta);return true;}
    originalSetItem.call(localStorage,ACTION_KEY,JSON.stringify(remote));sessionStorage.setItem(REMOTE_HASH_KEY,rHash);
    window.dispatchEvent(new CustomEvent('dcm-action-sync-applied',{detail:{actions:remote}}));
   }
   lastPullAt=Date.now();setStatus(remote.length?'공용 조치 데이터 조회 확인':'공용 조치 데이터 0건 확인','ok',meta);syncReasonOptions();return true;
  }catch(e){
   if(ticket!==authGeneration||e.stale)return false;
   console.warn('[DCM Action Sync] load failed',e);serverReady=false;
   const message=String(e?.message||'요청 실패'),wrongKey=message.includes('공유키가 올바르지 않습니다')||message.includes('DCM_SYNC_KEY가 설정되지 않았습니다');
   if(e.status===404)syncBroken=true;
   if(wrongKey){logoutSync('공유키 로그인 실패');setStatus('공유키 로그인 실패','error',message);}
   else setStatus(e.status===404?'Apps Script 배포 주소 오류':'공용 조회 실패 · 이전 자료 유지','error',message);
   renderLoginUI();updateEditAccess();return false;
  }
 })();
 pullTask=task;task.finally(()=>{if(ticket===authGeneration&&pullTask===task)pullTask=null;});return task;
}
Storage.prototype.setItem=function(k,v){
 if(this!==localStorage||k!==ACTION_KEY||suppressSync){originalSetItem.call(this,k,v);return;}
 const before=getLocalActions();originalSetItem.call(this,k,v);
 try{
   const after=JSON.parse(v);if(!Array.isArray(after))return;
   const beforeMap=new Map(before.map(a=>[a.key,a]));
   const fields=ACTIVE_ACTION_FIELDS;
   const changed=after.filter(a=>a?.key).map(a=>{
     const old=beforeMap.get(a.key),changedFields=fields.filter(f=>{
       const v=a[f]??(f==='status'?'TODO':''),p=old?.[f]??(f==='status'?'TODO':'');
       return String(v)!==String(p);
     });
     return changedFields.length?{...a,changedFields}:null;
   }).filter(Boolean);
   if(changed.length){lastEditAt=Date.now();actionEpoch++;stagePendingEdits(changed);renderLoginUI();const ticket=authGeneration;setTimeout(()=>{if(ticket===authGeneration)void flushPendingEdits();},80);}
 }catch(e){}
};
async function checkRevision(){
 if(!signedIn||!serverReady||!hasReadAuth()||document.visibilityState!=='visible'||isEditing())return;
 try{
  const json=await post({type:'actionRevision'});
  if(json.version!==REQUIRED_API_VERSION)return;
  if(!revisionSupported||json.revision!==lastRevision){await pullRemote(false);}
 }catch(e){if(!e.stale)console.warn('[DCM Action Sync] revision check failed',e);}
}
function start(){
 // Preserve historic user-selected reason codes; remapping is not safe without server mapping.
 migrateRetiredReason08();
 // The previous browser-persisted shared secret caused stale-key login loops.
 localStorage.removeItem(LEGACY_TOKEN_KEY);
 if(sessionStorage.getItem(SESSION_EDITOR_KEY)!==editor()){
  sessionStorage.removeItem(SESSION_TOKEN_KEY);sessionStorage.removeItem(EDITOR_PIN_SESSION);
 }
 installUI();observeBoard();
 if(masterPassword()&&!token()){
  signedIn=true;serverReady=true;renderLoginUI();updateEditAccess();void pullRemote(true);
 }else if(token()){
  quickLogin().catch(e=>{if(e.stale)return;serverReady=false;signedIn=false;setStatus('공용 Sync 재인증 필요','error',e.message);});
 }
 else setStatus('로그인 필요','idle','담당자 선택 후 공유키를 입력하고 로그인 버튼을 눌러주세요.');
 if(pollTimer)clearInterval(pollTimer);const poll=Math.max(30000,Number(CFG.pollMs)||30000);pollTimer=setInterval(()=>checkRevision(),Math.min(poll,12000));
 window.addEventListener('dcm-master-authenticated',()=>{if(masterPassword()){retireSession();signedIn=true;serverReady=true;renderLoginUI();updateEditAccess();void pullRemote(true);}});
 window.addEventListener('dcm-master-logged-out',()=>{if(editor()==='배영훈')logoutSync('마스터 모드가 종료되었습니다.');});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastPullAt>poll)pullRemote(false);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,100),{once:true});else setTimeout(start,100);
window.DCMActionSync={pull:()=>pullRemote(true),push:()=>flushPendingEdits(),pushRisk:()=>pushRiskSnapshot(true),allRisk:()=>allRiskRows(),srmRows:()=>getData(),srmActions:()=>getLocalActions(),canEditFor,editorName:()=>editor(),isConnected:()=>signedIn,srmRequest:payload=>post({...payload,actor:editor()}),reasons:REASONS};
})();

