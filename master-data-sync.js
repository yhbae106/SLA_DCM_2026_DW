(()=>{
'use strict';
const CFG=window.DCM_ACTION_SYNC||{};
const DATA_KEY='dcm-dashboard-v8-data';
const MASTER_KEY='dcm-dashboard-master-password';
const REMOTE_HASH_KEY='dcm-dashboard-remote-hash';
const $=id=>document.getElementById(id);
let master=false,generation=0,pullTask=null,saveTask=null,saveAgain=false,loginBusy=false,dataEpoch=0;
const requests=new Set(),C=window.DCMDashboardData;
function retired(){const e=Error('종료된 세션의 요청입니다.');e.stale=true;return e;}
function current(ticket){if(ticket!==generation)throw retired();}
function retire(){generation++;requests.forEach(c=>c.abort());requests.clear();pullTask=null;saveTask=null;saveAgain=false;loginBusy=false;}
function logout(){retire();sessionStorage.removeItem(MASTER_KEY);setMasterUI(false);window.dispatchEvent(new CustomEvent('dcm-master-logged-out'));setStatus('마스터 모드를 종료했습니다.','idle');}
function endpoint(){return String(CFG.endpoint||'').trim();}
function hash(v){try{return JSON.stringify(v||[]);}catch(e){return '';}}
function password(){return sessionStorage.getItem(MASTER_KEY)||'';}
function setStatus(text,state='idle'){const el=$('masterSyncStatus');if(!el)return;el.textContent=text;el.dataset.state=state;}
function installStyles(){if($('masterSyncStyle'))return;const s=document.createElement('style');s.id='masterSyncStyle';s.textContent=`.master-sync{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:10px 12px;border-radius:12px;background:#f7f9fc;border:1px solid #e6eaf0}.master-sync .master-label{font-weight:700;font-size:13px}.master-sync input{height:34px;padding:0 10px;border:1px solid #d8dee8;border-radius:8px;min-width:170px}.master-sync .master-state{font-size:12px;color:#667085}.master-sync .master-state[data-state="ok"]{color:#087a55;font-weight:700}.master-sync .master-state[data-state="error"]{color:#b42318;font-weight:700}.master-sync .master-state[data-state="working"]{color:#175cd3;font-weight:700}.master-sync .master-readonly{font-size:12px;padding:5px 8px;border-radius:999px;background:#eef2f6;color:#475467;font-weight:700}.master-sync .master-readonly.on{background:#ecfdf3;color:#067647}.master-only-locked{opacity:.55;pointer-events:none}`;document.head.appendChild(s);}
function setMasterUI(on){master=!!on;const file=$('fileInput');if(file){file.disabled=!master;file.closest('.uploadbox')?.classList.toggle('master-only-locked',!master);}['backupBtn','backupInput','resetBtn','masterSaveBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=!master;});const badge=$('masterModeBadge');if(badge){badge.textContent=master?'MASTER ON':'읽기 전용';badge.classList.toggle('on',master);}const login=$('masterLoginBtn');if(login)login.textContent=master?'마스터 종료':'마스터 로그인';const pw=$('masterPassword');if(pw){pw.disabled=master;if(master)pw.value='';}}
function installUI(){installStyles();const filters=document.querySelector('.panel.filters');if(!filters||$('masterSyncBar'))return;const bar=document.createElement('div');bar.id='masterSyncBar';bar.className='master-sync';bar.innerHTML=`<span id="masterModeBadge" class="master-readonly">읽기 전용</span><span class="master-label">마스터 모드</span><input id="masterPassword" type="password" autocomplete="current-password" placeholder="마스터 비밀번호"><button class="btn" id="masterLoginBtn">마스터 로그인</button><button class="btn" id="masterRefreshBtn">공용 데이터 새로고침</button><button class="btn" id="masterSaveBtn" disabled>공용 저장</button><span id="masterSyncStatus" class="master-state" role="status" aria-live="polite">마스터 로그인 후 공용 데이터를 불러옵니다.</span>`;filters.appendChild(bar);$('masterLoginBtn')?.addEventListener('click',async()=>{if(master||loginBusy){logout();return;}const pw=$('masterPassword')?.value||'';if(!pw){setStatus('비밀번호를 입력해 주세요.','error');return;}await authenticate(pw,true);});$('masterPassword')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('masterLoginBtn')?.click();});$('masterRefreshBtn')?.addEventListener('click',()=>master?pullRemote(true):pullSharedRemote());$('masterSaveBtn')?.addEventListener('click',saveRemote);setMasterUI(false);}
async function request(payload,ticket=generation){
 if(!endpoint())throw Error('공용 저장소 주소가 설정되지 않았습니다.');
 current(ticket);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);requests.add(controller);
 try{
  const res=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),signal:controller.signal});
  current(ticket);if(!res.ok)throw Error('HTTP '+res.status);
  const json=await res.json();current(ticket);
  if(json?.ok!==true)throw Error(json?.error||'요청 결과를 확인하지 못했습니다.');
  return json;
 }catch(e){current(ticket);if(e.name==='AbortError')throw Error('응답 시간 초과 · 연결을 확인한 후 다시 시도해 주세요.');throw e;}
 finally{clearTimeout(timer);requests.delete(controller);}
}
async function authenticate(pw,force){
 retire();const ticket=generation;loginBusy=true;
 setStatus('마스터 인증 중…','working');const b=$('masterLoginBtn');if(b)b.textContent='인증 취소';
 try{
  await request({type:'masterLogin',password:pw},ticket);current(ticket);
  sessionStorage.setItem(MASTER_KEY,pw);setMasterUI(true);
  window.dispatchEvent(new CustomEvent('dcm-master-authenticated'));
  await pullRemote(force);
 }catch(e){if(ticket!==generation)return;sessionStorage.removeItem(MASTER_KEY);setMasterUI(false);setStatus(e.message||'마스터 인증 실패','error');}
 finally{if(ticket===generation){loginBusy=false;if(!master&&b)b.textContent='마스터 로그인';}}
}
function readLocal(){return C.validate(JSON.parse(localStorage.getItem(DATA_KEY)||'[]'));}
function saveRemote(){
 if(!master||!password()){setStatus('마스터 로그인 후 저장할 수 있습니다.','idle');return Promise.resolve(false);}
 saveAgain=true;dataEpoch++;if(saveTask)return saveTask;
 const ticket=generation,pw=password();
 const task=(async()=>{
  try{
   while(saveAgain){
    saveAgain=false;current(ticket);const data=readLocal(),sent=hash(data);
    setStatus('공용 데이터 저장 중…','working');
    const json=await request({type:'saveDashboard',password:pw,editor:'MASTER',data},ticket);current(ticket);
    if(!Number.isInteger(json.rowCount)||json.rowCount!==data.length)throw Error('전송한 데이터와 저장 확인 건수가 다릅니다. 다시 확인해 주세요.');
    sessionStorage.setItem(REMOTE_HASH_KEY,sent);
    const unchanged=hash(readLocal())===sent;
    if(unchanged){C.mark(data,'shared',{updatedAt:json.updatedAt});setStatus('공용 저장 확인 · 월별 거래처 '+json.rowCount.toLocaleString()+'건 · 파트너는 다음 조회 시 반영','ok');}
    else if(!saveAgain)setStatus('이전 자료 저장 확인 · 새 변경사항은 공용 저장 확인 전','working');
   }
   return true;
  }catch(e){if(ticket===generation)setStatus('공용 저장 확인 필요 · '+e.message+' · 이 브라우저의 자료는 유지됩니다.','error');return false;}
 })();
 saveTask=task;
 task.finally(()=>{if(ticket===generation&&saveTask===task)saveTask=null;});
 return task;
}
function pullSharedRemote(){
 if(pullTask)return pullTask;
 const ticket=generation,epoch=dataEpoch,before=localStorage.getItem(DATA_KEY);
 const task=(async()=>{
  try{
   setStatus('공용 최신 데이터 확인 중…','working');
   const json=await request({type:'dashboardShared'},ticket);current(ticket);
   const remote=C.validate(json.data,{allowEmpty:true});
   remote.forEach(r=>{if(r.outlet==='백제약품 대전')r.manager='정직한';});
   if(epoch!==dataEpoch||localStorage.getItem(DATA_KEY)!==before||saveTask){setStatus('현재 브라우저의 새 변경사항 유지 · 공용 동기화 보류','working');return false;}
   if(!remote.length){setStatus('공용 저장 데이터 없음','idle');return true;}
   const rh=hash(remote);let lh='';try{lh=hash(JSON.parse(before||'[]'));}catch(_){}
   if(rh!==lh)localStorage.setItem(DATA_KEY,rh);
   sessionStorage.setItem(REMOTE_HASH_KEY,rh);C.mark(remote,'shared',{updatedAt:json.updatedAt});
   setStatus('공용 최신 데이터 적용'+(json.updatedAt?' · 저장 '+new Date(json.updatedAt).toLocaleString('ko-KR'):''),'ok');
   if(rh!==lh){window.dispatchEvent(new CustomEvent('dcm-dashboard-remote-applied'));location.reload();}
   return true;
  }catch(e){if(ticket===generation)setStatus('공용 데이터 조회 실패 · 기존 브라우저 자료 유지 · '+e.message,'error');return false;}
 })();
 pullTask=task;task.finally(()=>{if(ticket===generation&&pullTask===task)pullTask=null;});return task;
}
function pullRemote(force=false){
 if(pullTask)return pullTask;
 if(!master||!password()){setStatus('마스터 로그인 후 공용 데이터를 불러올 수 있습니다.','idle');return Promise.resolve(false);}
 if(saveTask){setStatus('저장을 마친 후 새로고침해 주세요.','working');return Promise.resolve(false);}
 const ticket=generation,epoch=dataEpoch,before=localStorage.getItem(DATA_KEY),pw=password();
 const task=(async()=>{
  try{
   setStatus('공용 데이터 확인 중…','working');
   const json=await request({type:'dashboardMaster',password:pw},ticket);current(ticket);
   const remote=C.validate(json.data,{allowEmpty:true});
   remote.forEach(r=>{if(r.outlet==='백제약품 대전')r.manager='정직한';});
   if(epoch!==dataEpoch||localStorage.getItem(DATA_KEY)!==before||saveTask){setStatus('새로 수정한 자료 유지 · 공용 새로고침 보류','working');return false;}
   if(!remote.length){setStatus('공용 저장 데이터 없음 · 최초 마스터 업로드 필요','idle');return true;}
   const rh=hash(remote);let lh='';try{lh=hash(JSON.parse(before||'[]'));}catch(_){}
   if(rh!==lh)localStorage.setItem(DATA_KEY,rh);
   sessionStorage.setItem(REMOTE_HASH_KEY,rh);C.mark(remote,'shared',{updatedAt:json.updatedAt});
   setStatus('공용 데이터 조회 확인'+(json.updatedAt?' · 저장 '+new Date(json.updatedAt).toLocaleString('ko-KR'):''),'ok');
   if(rh!==lh){window.dispatchEvent(new CustomEvent('dcm-dashboard-remote-applied'));location.reload();}
   return true;
  }catch(e){if(ticket===generation)setStatus('공용 데이터 조회 실패 · 이전 자료 유지 · '+e.message,'error');return false;}
 })();
 pullTask=task;task.finally(()=>{if(ticket===generation&&pullTask===task)pullTask=null;});return task;
}
function observeExcelUpload(){
 window.addEventListener('dcm-dashboard-data-committed',e=>{if(e.detail?.source==='excel'&&master)void saveRemote();});
}
function start(){installUI();observeExcelUpload();const saved=password();if(saved)void authenticate(saved,false);else void pullSharedRemote();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,150),{once:true});else setTimeout(start,150);
window.DCMMasterSync={pull:()=>master?pullRemote(true):pullSharedRemote(),save:saveRemote,isMaster:()=>master,generation:()=>generation,logout};
})();
