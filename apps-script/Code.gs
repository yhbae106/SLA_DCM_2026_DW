const DCM_SPREADSHEET_ID = '1LbEuintnEZbnwJXZcrbTWZNECWMg4ry7_UwRsQ9end0';
const DCM_SHEET = 'Action Board';
const DCM_CONFIG_SHEET = 'Config';
const DCM_HISTORY_SHEET = 'History';
const DCM_DATA_SHEET = 'Dashboard Data';
const DCM_DATA_META_SHEET = 'Dashboard Meta';
const DCM_PARTNERS = ['백제약품','인천약품','복산나이스','아이팜코리아','유진약품'];
const DCM_PARTNER_ACTION_HEADERS = ['업체 원인','업체 조치계획','업체 Due','업체 상태','업체 수정자','업체 수정시간','업체 수정필드'];
const DCM_PARTNER_ACTION_FIELDS = ['reasonCode','plan','dueDate','status'];
const DCM_SRM_SHEET = 'SRM Events';
const DCM_SRM_FIELDS = ['eventId','key','outlet','businessNo','entity','type','status','reason','erpVendor','contactTarget','detail','nextAction','owner','dueDate','baselineMonth','actor','side','updatedAt','verificationMonth','result','requestId'];
const DCM_SYNC_API_VERSION = '20261008-seven-reasons-fast-v3';
const DCM_SYNC_BUILD = '20261020-partner-fast-bootstrap-v2';
const DCM_ACTION_REVISION_KEY = 'DCM_ACTION_REVISION';
const DCM_DASHBOARD_REVISION_KEY = 'DCM_DASHBOARD_REVISION';
const DCM_PARTNER_CACHE_TTL = 600;
const DCM_REASON_DEFAULTS = {
  '01':'ERP/시스템 미구축','02':'도입 품목 미연동','03':'전산/데이터 오류',
  '04':'거래처 연동 거부/미협조','05':'도매몰 미연동',
  '06':'신규 거래처 연동 예정','07':'당월 매출 미발생'
};

function doGet(e) {
  try {
    const type = String(e && e.parameter && e.parameter.type || '');
    if (type === 'health') return json_({ok:true, service:'DCM Action Sync',version:DCM_SYNC_API_VERSION,build:DCM_SYNC_BUILD});
    if (type === 'dashboard') throw new Error('마스터 데이터는 인증된 POST 요청으로만 조회할 수 있습니다.');
    assertToken_(e && e.parameter && e.parameter.token);
    return json_({ok:true, ...loadActions_(), reasons:loadReasons_()});
  } catch (err) {
    return json_({ok:false, error:String(err && err.message || err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.type === 'masterLogin') {
      assertMasterPassword_(body.password);
      return json_({ok:true});
    }
    if (body.type === 'dashboardMaster') {
      assertMasterPassword_(body.password);
      return json_({ok:true, ...loadDashboardData_()});
    }
    if (body.type === 'partnerLogin' || body.type === 'partnerDashboard') {
      const partner = normalizePartner_(body.partner);
      assertPartnerPassword_(partner, body.password);
      if (body.type === 'partnerLogin') {
        // Optional single-round-trip bootstrap. Never query the sheet on login:
        // return only fully populated, authorized partner caches, when available.
        const cache=body.preferCachedDashboard&&typeof CacheService!=='undefined'
          ?CacheService.getScriptCache():null;
        const quickData=getPartnerCached_(cache,partner);
        const quickActions=getPartnerCached_(cache,'actions-'+partner);
        const safeActions=quickActions&&quickActions.revision===actionRevision_()?quickActions:null;
        return json_({ok:true,partner:partner,version:DCM_SYNC_API_VERSION,
          dashboardRevision:dashboardRevision_(),
          dashboardSnapshot:quickData&&Array.isArray(quickData.data)?quickData:null,
          actionSnapshot:safeActions});
      }
      return json_({ok:true, partner:partner, ...loadPartnerDashboardData_(partner)});
    }
    if (body.type === 'partnerActionRevision') {
      const partner = normalizePartner_(body.partner);
      assertPartnerPassword_(partner, body.password);
      return json_({ok:true,version:DCM_SYNC_API_VERSION,build:DCM_SYNC_BUILD,revision:actionRevision_(),dashboardRevision:dashboardRevision_()});
    }
    if (body.type === 'partnerActions' || body.type === 'partnerSaveAction' || body.type === 'partnerSaveActions') {
      const partner = normalizePartner_(body.partner);
      assertPartnerPassword_(partner, body.password);
      if (body.type === 'partnerActions') {
        const revision=actionRevision_(); // Capture before reading rows to avoid missing a concurrent write.
        return json_({ok:true, ...loadPartnerActions_(partner),revision:revision});
      }
      if (body.type === 'partnerSaveActions') return json_({ok:true,...withActionLock_(function(){return savePartnerActionsBatch_(partner,body.changes);})});
      return json_({ok:true, ...withActionLock_(function(){return savePartnerAction_(partner,body);})});
    }
    // The partner is authenticated independently; no shared master token is disclosed.
    if (body.type === 'srmList' && body.scope === 'partner') {
      const company=normalizePartner_(body.partner);
      assertPartnerPassword_(company,body.password);
      return json_({ok:true,...loadSrmEvents_(company)});
    }
    if (body.type === 'srmAppend' && body.scope === 'partner') {
      const company=normalizePartner_(body.partner);
      assertPartnerPassword_(company,body.password);
      return json_({ok:true,...withSrmLock_(()=>appendSrmEvent_(body,'partner',company))});
    }
    if (body.type === 'saveDashboard') {
      assertMasterPassword_(body.password);
      const result = saveDashboardData_(Array.isArray(body.data) ? body.data : [], body.editor || 'MASTER');
      return json_({ok:true, ...result});
    }
    assertSyncReadAuth_(body);
    if (body.type === 'syncLogin') return json_({ok:true,version:DCM_SYNC_API_VERSION,build:DCM_SYNC_BUILD});
    if (body.type === 'actionRevision') return json_({ok:true,version:DCM_SYNC_API_VERSION,build:DCM_SYNC_BUILD,revision:actionRevision_()});
    if (body.type === 'srmList') return json_({ok:true,...loadSrmEvents_('')});
    if (body.type === 'srmAppend') return json_({ok:true,...withSrmLock_(()=>appendSrmEvent_(body,'master',''))});
    if (body.type === 'load') {
      const revision=actionRevision_(); // Capture before the sheet read.
      return json_({ok:true, ...loadActions_(false), reasons:loadReasons_(),version:DCM_SYNC_API_VERSION,build:DCM_SYNC_BUILD,revision:revision});
    }
    if (body.type === 'syncReasons') return json_({ok:true,reasons:loadReasons_(),version:DCM_SYNC_API_VERSION});
    if (body.type === 'repairReasonValidation') {
      return json_({ok:true,...withActionLock_(function(){return repairActionReasonValidation();})});
    }
    if (body.type !== 'save') throw new Error('지원하지 않는 요청입니다.');
    const incomingActions=Array.isArray(body.actions)?body.actions:[];
    const mode=String(body.mode||'edit');
    const result=withActionLock_(function(){
      if(mode==='edit')assertActionEditorAccess_(body.editor,body.editorPin,incomingActions,body.masterPassword);
      return saveActions_(incomingActions,body.editor||'',mode);
    });
    return json_({ok:true, ...result});
  } catch (err) {
    return json_({ok:false, error:String(err && err.message || err)});
  }
}

function setSyncKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('DCM 공용 Sync 공유키 설정', '배영훈·정직한·임인숙 세 분이 브라우저에서 입력할 공용키를 설정하세요.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (!key) throw new Error('공유키가 비어 있습니다.');
  PropertiesService.getScriptProperties().setProperty('DCM_SYNC_KEY', key);
  ui.alert('공유키가 저장되었습니다.');
}

function setMasterPassword() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('DCM 마스터 비밀번호 설정', 'Excel 업로드 권한을 가진 마스터 비밀번호를 입력하세요. 이 값은 웹 소스에 노출되지 않고 Script Properties에만 저장됩니다.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const password = res.getResponseText().trim();
  if (!password || password.length < 6) throw new Error('마스터 비밀번호는 6자 이상으로 설정하세요.');
  PropertiesService.getScriptProperties().setProperty('DCM_MASTER_PASSWORD', password);
  ui.alert('마스터 비밀번호가 저장되었습니다.');
}

function setPartnerPassword() {
  const ui = SpreadsheetApp.getUi();
  const p = ui.prompt('파트너 접속코드 설정', '업체명을 정확히 입력하세요: ' + DCM_PARTNERS.join(', '), ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  const partner = normalizePartner_(p.getResponseText());
  const c = ui.prompt(partner + ' 접속코드 설정', '외부 업체에 전달할 접속코드를 6자 이상 입력하세요.', ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  const password = c.getResponseText().trim();
  if (!password || password.length < 6) throw new Error('파트너 접속코드는 6자 이상으로 설정하세요.');
  PropertiesService.getScriptProperties().setProperty(partnerPasswordKey_(partner), password);
  ui.alert(partner + ' 접속코드가 저장되었습니다.');
}

function setupDcmActionSync() {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  let hist = ss.getSheetByName(DCM_HISTORY_SHEET);
  if (!hist) {
    hist = ss.insertSheet(DCM_HISTORY_SHEET);
    hist.hideSheet();
    hist.getRange(1,1,1,11).setValues([['eventId','key','업체/권역','사업자번호','실사업자명','담당자','변경필드','이전값','변경값','수정자','수정시간']]);
  }
  ensureDashboardSheets_();
  refreshReasonValidation_();
  ensurePartnerActionColumns_(ss.getSheetByName(DCM_SHEET));
}

function assertToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('DCM_SYNC_KEY');
  if (!expected) throw new Error('Apps Script의 DCM_SYNC_KEY가 설정되지 않았습니다.');
  if (!token || token !== expected) throw new Error('공유키가 올바르지 않습니다.');
}

function assertSyncReadAuth_(body) {
  // An authenticated Bae master session may read/write Action Sync without a second shared key.
  // Every request still checks the server-side master secret. Other editors require DCM_SYNC_KEY.
  if (body && body.editor === '배영훈' && body.masterPassword) {
    assertMasterPassword_(body.masterPassword);
    return;
  }
  assertToken_(body && body.token);
}
function actionRevision_() {
  return PropertiesService.getScriptProperties().getProperty(DCM_ACTION_REVISION_KEY) || '';
}
function markActionRevision_() {
  PropertiesService.getScriptProperties().setProperty(DCM_ACTION_REVISION_KEY, Utilities.getUuid());
}
function dashboardRevision_() {
  return PropertiesService.getScriptProperties().getProperty(DCM_DASHBOARD_REVISION_KEY) || '';
}

function assertMasterPassword_(password) {
  const expected = PropertiesService.getScriptProperties().getProperty('DCM_MASTER_PASSWORD');
  if (!expected) throw new Error('Apps Script의 DCM_MASTER_PASSWORD가 설정되지 않았습니다.');
  if (!password || password !== expected) throw new Error('마스터 비밀번호가 올바르지 않습니다.');
}


/* Named editor authorization for shared Sync writes. The shared Sync key grants
 * read/snapshot access, NOT the authority to impersonate another editor.
 * Configure Script Properties: DCM_EDITOR_PIN_BAE, DCM_EDITOR_PIN_JEONG, DCM_EDITOR_PIN_LIM.
 */
const DCM_EDITOR_PIN_PROPERTIES={'배영훈':'DCM_EDITOR_PIN_BAE','정직한':'DCM_EDITOR_PIN_JEONG','임인숙':'DCM_EDITOR_PIN_LIM'};
function setNamedEditorPin() {
  // Run manually by the authorized Apps Script administrator.
  const ui=SpreadsheetApp.getUi();
  const who=ui.prompt('공용 Sync 개인 수정 PIN 설정',
    '설정할 담당자명을 입력하세요: 배영훈 / 정직한 / 임인숙',ui.ButtonSet.OK_CANCEL);
  if(who.getSelectedButton()!==ui.Button.OK)return;
  const editor=String(who.getResponseText()||'').trim();
  const key=DCM_EDITOR_PIN_PROPERTIES[editor];
  if(!key)throw new Error('배영훈, 정직한, 임인숙 중 선택해야 합니다.');
  const answer=ui.prompt(editor+' 개인 수정 PIN',
    '본인만 아는 8자리 이상의 수정 PIN을 입력하세요. 공유키와 다른 값을 사용하세요.',
    ui.ButtonSet.OK_CANCEL);
  if(answer.getSelectedButton()!==ui.Button.OK)return;
  const pin=String(answer.getResponseText()||'').trim();
  if(pin.length<8)throw new Error('수정 PIN은 8자리 이상이어야 합니다.');
  PropertiesService.getScriptProperties().setProperty(key,pin);
  ui.alert(editor+' 개인 PIN이 저장되었습니다. PIN은 팀 공용 채팅에 공유하지 마세요.');
}
function assertNamedEditorPin_(editor,pin){
  const name=String(editor||'').trim(),property=DCM_EDITOR_PIN_PROPERTIES[name];
  if(!property)throw new Error('등록되지 않은 공용 Sync 수정자입니다.');
  const expected=PropertiesService.getScriptProperties().getProperty(property);
  if(!expected||expected.length<6)throw new Error(name+' 수정 PIN 미설정: 관리자가 Apps Script 속성을 설정해야 합니다.');
  if(String(pin||'')!==String(expected))throw new Error(name+' 수정 PIN 인증에 실패했습니다.');
  return name;
}
function getAuthoritativeActionManagers_(keys){
  const allowed=new Set(keys),out=new Map(),dates=new Map();
  const sh=SpreadsheetApp.openById(DCM_SPREADSHEET_ID).getSheetByName(DCM_DATA_SHEET);
  if(!sh||sh.getLastRow()<2)throw new Error('담당자 검증용 DCM 원자료가 없습니다.');
  const values=sh.getRange(2,1,sh.getLastRow()-1,4).getDisplayValues();
  for(const row of values){
    const key=String(row[1]||'')+'|||'+String(row[3]||'');
    if(!allowed.has(key))continue;
    const month=String(row[0]||''),manager=canonicalManager_(row[1],row[2]);
    if(!out.has(key)||month>dates.get(key)){out.set(key,manager);dates.set(key,month);}
  }
  return out;
}
function assertActionEditorAccess_(editor,pin,actions,masterPassword){
  const name=String(editor||'').trim();
  if(name==='배영훈'&&masterPassword)assertMasterPassword_(masterPassword);
  else assertNamedEditorPin_(name,pin);
  const keys=[...new Set((actions||[]).map(a=>String(a?.key||'')))];
  if(!keys.length)return;
  const managers=getAuthoritativeActionManagers_(keys);
  keys.forEach(key=>{
    const owner=managers.get(key);
    if(!owner||!Object.prototype.hasOwnProperty.call(DCM_EDITOR_PIN_PROPERTIES,owner))
      throw new Error('원자료의 담당자가 확인되지 않거나 편집 허용 담당자가 아닙니다: '+key);
    if(name!=='배영훈'&&name!==owner)
      throw new Error('편집 권한 없음: '+name+' 담당 거래처만 수정할 수 있습니다 ('+key+').');
  });
}

function normalizePartner_(partner) {
  const p = String(partner || '').trim();
  if (DCM_PARTNERS.indexOf(p) < 0) throw new Error('지원하지 않는 파트너사입니다.');
  return p;
}

function partnerPasswordKey_(partner) {
  return 'DCM_PARTNER_PASSWORD_' + Utilities.base64EncodeWebSafe(partner, Utilities.Charset.UTF_8).replace(/=+$/,'');
}

function assertPartnerPassword_(partner, password) {
  const expected = PropertiesService.getScriptProperties().getProperty(partnerPasswordKey_(partner));
  if (!expected) throw new Error(partner + ' 접속코드가 아직 설정되지 않았습니다.');
  if (!password || password !== expected) throw new Error('업체명 또는 접속코드가 올바르지 않습니다.');
}

function partnerOfOutlet_(outlet) {
  const s = String(outlet || '');
  if (s.indexOf('백제') >= 0) return '백제약품';
  if (s.indexOf('인천') >= 0) return '인천약품';
  if (s.indexOf('복산') >= 0) return '복산나이스';
  if (s.indexOf('아이팜') >= 0 || s.indexOf('동보') >= 0) return '아이팜코리아';
  if (s.indexOf('유진') >= 0) return '유진약품';
  return '';
}

function canonicalManager_(outlet, manager) {return String(outlet || '').trim() === '백제약품 대전' ? '정직한' : String(manager || '');}

function partnerCacheKey_(partner) { return 'partnerData-v5-'+partner; }
function partnerDataFromRows_(rows,partner) {
  const result=[];
  for(const r of rows){
    if(!r[0]||!r[1]||!r[3]||partnerOfOutlet_(r[1])!==partner)continue;
    result.push({
      month:r[0],outlet:r[1],manager:canonicalManager_(r[1],r[2]),
      businessNo:r[3],businessName:r[4]||'',
      statuses:{'대웅제약':r[5]||null,'대웅바이오':r[6]||null,'한올바이오':r[7]||null}
    });
  }
  return result;
}
function getPartnerCached_(cache,partner) {
  if(!cache)return null;
  try{
    const meta=JSON.parse(cache.get(partnerCacheKey_(partner))||'null');
    if(!meta||!meta.prefix||!Number.isInteger(meta.n)||meta.n<1||meta.n>120)return null;
    const keys=Array.from({length:meta.n},(_,i)=>meta.prefix+'-'+i);
    const parts=cache.getAll(keys);
    if(!keys.every(k=>typeof parts[k]==='string'))return null;
    const parsed=JSON.parse(keys.map(k=>parts[k]).join(''));
    return Array.isArray(parsed.data)||Array.isArray(parsed.actions)?parsed:null;
  }catch(e){console.warn('Partner dashboard cache read skipped: '+String(e));return null;}
}
function putPartnerCached_(cache,partner,result) {
  if(!cache)return;
  try{
    const encoded=JSON.stringify(result);
    // CacheService has a 100 KB BYTE limit per entry, not 100K UTF-16 chars.
    // 20K code units also accommodates Hangul and surrogate-pair symbols.
    const chunkSize=20000,count=Math.ceil(encoded.length/chunkSize);
    if(count<1||count>120)return;
    const prefix=partnerCacheKey_(partner)+'-'+Utilities.getUuid().slice(0,14);
    const pages={};
    for(let i=0;i<count;i++)pages[prefix+'-'+i]=encoded.slice(i*chunkSize,(i+1)*chunkSize);
    cache.putAll(pages,DCM_PARTNER_CACHE_TTL);
    // Metadata is published last, so readers never assemble partial snapshots.
    cache.put(partnerCacheKey_(partner),JSON.stringify({prefix:prefix,n:count}),DCM_PARTNER_CACHE_TTL);
  }catch(e){
    // A transient cache error must NEVER prevent authenticated dashboard access.
    console.warn('Partner dashboard cache write skipped: '+String(e));
  }
}
function loadPartnerDashboardData_(partner) {
  // Read only this partner's rows into objects. Never return another partner's records.
  const cache=typeof CacheService==='undefined'?null:CacheService.getScriptCache();
  const cached=getPartnerCached_(cache,partner);
  if(cached)return cached;
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh=ss.getSheetByName(DCM_DATA_SHEET),meta=ss.getSheetByName(DCM_DATA_META_SHEET);
  const count=sh?sh.getLastRow():0;
  const rows=count>=2?sh.getRange(2,1,count-1,8).getDisplayValues():[];
  const data=partnerDataFromRows_(rows,partner);
  let updatedAt='',updatedBy='';
  if(meta&&meta.getLastRow()>=2){
    const values=meta.getRange(2,1,1,2).getDisplayValues()[0];
    updatedAt=values[0]||'';updatedBy=values[1]||'';
  }
  const result={data:data,updatedAt:updatedAt,updatedBy:updatedBy,
    rowCount:data.length,version:DCM_SYNC_API_VERSION,dashboardRevision:dashboardRevision_()};
  putPartnerCached_(cache,partner,result);
  return result;
}

function withActionLock_(callback) {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {return callback();} finally {lock.releaseLock();}
}
function loadPartnerActions_(partner) {
  const revision=actionRevision_();
  const cache=typeof CacheService==='undefined'?null:CacheService.getScriptCache();
  const cachePartner='actions-'+partner;
  const hit=getPartnerCached_(cache,cachePartner);
  if(hit&&hit.revision===revision)return hit;
  const shared=loadActions_(false);
  const visible=shared.actions.filter(a => partnerOfOutlet_(a.outlet || String(a.key || '').split('|||')[0]) === partner)
    .map(a => ({key:a.key,businessNo:a.businessNo,priority:a.priority,businessName:a.businessName,
      outlet:a.outlet,manager:canonicalManager_(a.outlet,a.manager),aging:a.aging,reasonCode:a.reasonCode,
      plan:a.plan,dueDate:a.dueDate,status:a.status,modifiedBy:a.modifiedBy,updatedAt:a.updatedAt,
      partnerAction:a.partnerAction||null}));
  const result={actions:visible,reasons:loadReasons_(),updatedAt:shared.updatedAt,
    updatedBy:shared.updatedBy,revision:revision,version:DCM_SYNC_API_VERSION};
  putPartnerCached_(cache,cachePartner,result);
  return result;
}

/* A:M: master only. N:T: independent Partner entries. */
function ensurePartnerActionColumns_(sh) {
  if (!sh) throw new Error('Action Board 시트를 찾을 수 없습니다.');
  const start=14, headers=DCM_PARTNER_ACTION_HEADERS;
  if (sh.getMaxColumns() < 20) sh.insertColumnsAfter(sh.getMaxColumns(),20-sh.getMaxColumns());
  const range=sh.getRange(1,start,1,headers.length);
  const current=range.getDisplayValues()[0];
  if (current.some((v,i)=>String(v||'').trim() && String(v).trim()!==headers[i])) {
    throw new Error('Action Board N:T 열에 다른 데이터 헤더가 있습니다. 기존 내용을 확인해 주세요.');
  }
  if (current.some((v,i)=>v!==headers[i])) range.setValues([headers]);
}
function partnerEditedFields_(cell) {
  try {
    const fields=JSON.parse(String(cell||'[]'));
    return Array.isArray(fields)?DCM_PARTNER_ACTION_FIELDS.filter(f=>fields.includes(f)):[];
  }catch(err){return [];}
}
function partnerActionFromCells_(row, reasonDict) {
  const fields=partnerEditedFields_(row[19]);
  if (!fields.length) return null;
  return {
    reasonCode:fields.includes('reasonCode')?reasonCode_(row[13],reasonDict):'',
    plan:fields.includes('plan')?String(row[14]||''):'',
    dueDate:fields.includes('dueDate')?normalizeDate_(row[15]):'',
    status:fields.includes('status')?(row[16]?statusCode_(row[16]):''):'',
    modifiedBy:row[17]||'',updatedAt:row[18]||'',editedFields:fields
  };
}
function safeSheetText_(raw) {
  const value=String(raw == null?'':raw);
  return /^[=+\-@]/.test(value)?("'"+value):value;
}
function savePartnerAction_(partner, body) {
  const key=String(body.key||''),parts=key.split('|||'),field=String(body.field||'');
  if(parts.length!==2 || !parts[0] || !parts[1] || key.length>240 ||
      partnerOfOutlet_(parts[0])!==partner) throw new Error('업체에 속하지 않는 거래처입니다.');
  if(!DCM_PARTNER_ACTION_FIELDS.includes(field)) throw new Error('수정할 수 없는 필드입니다.');
  const value=String(body.value == null?'':body.value);
  if(value.length>3000) throw new Error('입력 내용은 최대 3000자입니다.');
  if(field==='reasonCode' && value) {
    if (!Object.prototype.hasOwnProperty.call(loadReasons_(),value)) throw new Error('허용되지 않은 원인코드입니다.');
  }
  if(field==='dueDate' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('기한은 YYYY-MM-DD 형식이어야 합니다.');
  if(field==='status' && value && !['TODO','IN_PROGRESS','WAITING','DONE'].includes(value))throw new Error('허용되지 않은 진행상태입니다.');
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID),sh=ss.getSheetByName(DCM_SHEET);
  ensurePartnerActionColumns_(sh);
  const total=sh.getLastRow();
  const keys=total>=2?sh.getRange(2,1,total-1,1).getDisplayValues():[];
  assertUniqueActionKeys_(keys);
  const offset=keys.findIndex(r=>r[0]===key);
  let rowNumber=offset<0?0:offset+2;
  if(!rowNumber) {
    const dash=ss.getSheetByName(DCM_DATA_SHEET),cnt=dash?.getLastRow()||0;
    const records=cnt>=2?dash.getRange(2,1,cnt-1,9).getDisplayValues():[];
    const matches=records.filter(r=>r[1]===parts[0]&&r[3]===parts[1]);
    if(!matches.length)throw new Error('마스터 데이터에 없는 거래처입니다.');
    const last=matches[matches.length-1];
    if(![last[5],last[6],last[7]].some(v=>String(v).trim().toUpperCase()==='X'))
      throw new Error('현재 연동 필요 대상이 아닙니다.');
    const fixed=[key,last[3],'',last[4],last[1],canonicalManager_(last[1],last[2]),'', '', '', '', '', '', ''];
    rowNumber=sh.getLastRow()+1;sh.getRange(rowNumber,1,1,13).setValues([fixed]);
  }
  const row=sh.getRange(rowNumber,14,1,7).getDisplayValues()[0];
  const idx=DCM_PARTNER_ACTION_FIELDS.indexOf(field);
  const dictionary=field==='reasonCode'?loadReasons_():null;
  row[idx]=field==='reasonCode'?(value?value+' '+dictionary[value]:'') :
           field==='plan'?safeSheetText_(value):value;
  const now=Utilities.formatDate(new Date(),'Asia/Seoul',"yyyy-MM-dd'T'HH:mm:ssXXX");
  row[4]='업체:'+partner;row[5]=now;
  const edited=new Set(partnerEditedFields_(row[6]));edited.add(field);row[6]=JSON.stringify([...edited]);
  sh.getRange(rowNumber,14,1,7).setValues([row]);
  SpreadsheetApp.flush();
  markActionRevision_();
  return {key:key,field:field,value:value,updatedAt:now,modifiedBy:row[4]};
}


/**
 * One authenticated POST saves up to 50 changed fields.
 * Never updates master H:M; all Partner fields live in N:T.
 */
function savePartnerActionsBatch_(partner, incoming) {
  if(!Array.isArray(incoming)||!incoming.length||incoming.length>50)
    throw new Error('저장 항목은 한 번에 1~50개까지 전송할 수 있습니다.');
  const dict=loadReasons_(),updates=new Map(),fields=DCM_PARTNER_ACTION_FIELDS;
  incoming.forEach(function(item){
    const k=String(item&&item.key||''),parts=k.split('|||'),f=String(item&&item.field||'');
    if(!item||typeof item!=='object')throw new Error('저장 항목 형식이 올바르지 않습니다.');
    const val=String(item.value==null?'':item.value);
    if(parts.length!==2||!parts[0]||!parts[1]||k.length>240||partnerOfOutlet_(parts[0])!==partner)
      throw new Error('접근할 수 없는 거래처입니다.');
    if(!fields.includes(f))throw new Error('허용되지 않은 수정 필드입니다.');
    if(val.length>3000)throw new Error('입력값 길이 제한을 초과했습니다.');
    if(f==='reasonCode'&&val&&!Object.prototype.hasOwnProperty.call(dict,val))
      throw new Error('원인코드가 Config에 없습니다: '+val);
    if(f==='dueDate'&&val&&!/^\d{4}-\d{2}-\d{2}$/.test(val))throw new Error('기한 형식이 올바르지 않습니다.');
    if(f==='status'&&val&&!['TODO','IN_PROGRESS','WAITING','DONE'].includes(val))
      throw new Error('진행상태가 올바르지 않습니다.');
    if(!updates.has(k))updates.set(k,new Map());
    updates.get(k).set(f,val);
  });
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID),sh=ss.getSheetByName(DCM_SHEET);
  ensurePartnerActionColumns_(sh);
  const n=Math.max(0,sh.getLastRow()-1);
  const keyRows=n?sh.getRange(2,1,n,1).getDisplayValues():[];
  const existingPartners=n?sh.getRange(2,14,n,7).getDisplayValues():[];
  assertUniqueActionKeys_(keyRows);
  const index=new Map();
  keyRows.forEach((r,i)=>{if(r[0])index.set(String(r[0]),{row:i+2,cells:existingPartners[i]});});
  let sourceMap=null;
  if([...updates.keys()].some(k=>!index.has(k))){
    const dash=ss.getSheetByName(DCM_DATA_SHEET),last=dash?.getLastRow()||0;
    const records=last>=2?dash.getRange(2,1,last-1,9).getDisplayValues():[];
    sourceMap=new Map();
    records.forEach(r=>{
      if(partnerOfOutlet_(r[1])===partner&&r[1]&&r[3])sourceMap.set(String(r[1])+'|||'+String(r[3]),r);
    });
    for(const k of updates.keys()){
      if(index.has(k))continue;
      const row=sourceMap.get(k);
      if(!row||![row[5],row[6],row[7]].some(v=>String(v).trim().toUpperCase()==='X'))
        throw new Error('마스터 미연동 목록에 없는 거래처: '+k);
    }
  }
  const now=Utilities.formatDate(new Date(),'Asia/Seoul',"yyyy-MM-dd'T'HH:mm:ssXXX");
  const results=[];
  for(const [key,changeMap] of updates){
    let entry=index.get(key);
    if(!entry){
      const record=sourceMap.get(key);
      const fixed=[key,record[3],'',record[4],record[1],canonicalManager_(record[1],record[2]),'', '', '', '', '', '', ''];
      const rowNumber=sh.getLastRow()+1;
      sh.getRange(rowNumber,1,1,13).setValues([fixed]);
      entry={row:rowNumber,cells:['','','','','','','']};
      index.set(key,entry);
    }
    const cells=[...entry.cells],modified=new Set(partnerEditedFields_(cells[6]));
    for(const [field,value] of changeMap){
      const col=fields.indexOf(field);
      cells[col]=field==='reasonCode'?(value?value+' '+dict[value]:''):
        field==='plan'?safeSheetText_(value):value;
      modified.add(field);
      results.push({key:key,field:field,value:value,updatedAt:now,modifiedBy:'업체:'+partner});
    }
    cells[4]='업체:'+partner;cells[5]=now;cells[6]=JSON.stringify([...modified]);
    sh.getRange(entry.row,14,1,7).setValues([cells]);
  }
  SpreadsheetApp.flush();
  markActionRevision_();
  return {saved:results.length,results:results,updatedAt:now,version:DCM_SYNC_API_VERSION};
}

function ensureDashboardSheets_() {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  let sh = ss.getSheetByName(DCM_DATA_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DCM_DATA_SHEET);
    sh.getRange(1,1,1,9).setValues([['month','outlet','manager','businessNo','businessName','대웅제약','대웅바이오','한올바이오','savedAt']]);
  }
  let meta = ss.getSheetByName(DCM_DATA_META_SHEET);
  if (!meta) {
    meta = ss.insertSheet(DCM_DATA_META_SHEET);
    meta.getRange(1,1,1,3).setValues([['updatedAt','updatedBy','rowCount']]);
    meta.hideSheet();
  }
  return {sh:sh, meta:meta};
}

function loadDashboardData_() {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh = ss.getSheetByName(DCM_DATA_SHEET);
  const meta = ss.getSheetByName(DCM_DATA_META_SHEET);
  const data = [];
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2,1,sh.getLastRow()-1,9).getDisplayValues().forEach(r => {
      if (!r[0] || !r[1] || !r[3]) return;
      data.push({
        month:r[0] || '', outlet:r[1] || '', manager:canonicalManager_(r[1],r[2]), businessNo:r[3] || '', businessName:r[4] || '',
        statuses:{'대웅제약':r[5] || null,'대웅바이오':r[6] || null,'한올바이오':r[7] || null}
      });
    });
  }
  let updatedAt='', updatedBy='';
  if (meta && meta.getLastRow() >= 2) {
    const m = meta.getRange(2,1,1,3).getDisplayValues()[0];
    updatedAt = m[0] || ''; updatedBy = m[1] || '';
  }
  return {data:data, updatedAt:updatedAt, updatedBy:updatedBy, rowCount:data.length};
}

function saveDashboardData_(data, editor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheets = ensureDashboardSheets_();
    const sh = sheets.sh, meta = sheets.meta;
    const nowIso = Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
    const clean = [];
    data.forEach(r => {
      if (!r || !r.month || !r.outlet || !r.businessNo) return;
      const s = r.statuses || {};
      clean.push([
        String(r.month), String(r.outlet), canonicalManager_(r.outlet,r.manager), String(r.businessNo), String(r.businessName || ''),
        normalizeOx_(s['대웅제약']), normalizeOx_(s['대웅바이오']), normalizeOx_(s['한올바이오']), nowIso
      ]);
    });
    // Validate before clearing the sheet: month/outlet/business number is unique.
    const sourceKeys=new Set(),duplicates=new Set();
    clean.forEach(r=>{const k=[r[0],r[1],r[3]].join('|||');if(sourceKeys.has(k))duplicates.add(k);else sourceKeys.add(k);});
    if(duplicates.size)throw new Error('Dashboard Data 중복 '+duplicates.size+
      '건(월·권역·사업자번호). 원본 유지: '+[...duplicates].slice(0,3).join(', '));
    clean.sort((a,b)=>String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]),'ko') || String(a[3]).localeCompare(String(b[3])));
    sh.clearContents();
    sh.getRange(1,1,1,9).setValues([['month','outlet','manager','businessNo','businessName','대웅제약','대웅바이오','한올바이오','savedAt']]);
    if (clean.length) sh.getRange(2,1,clean.length,9).setValues(clean);
    meta.clearContents();
    meta.getRange(1,1,1,3).setValues([['updatedAt','updatedBy','rowCount']]);
    meta.getRange(2,1,1,3).setValues([[nowIso, String(editor || 'MASTER'), clean.length]]);
    SpreadsheetApp.flush();
    // Invalidate cache immediately after a successful sheet commit.
    const revision=Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty(DCM_DASHBOARD_REVISION_KEY,revision);
    if(typeof CacheService!=='undefined'){
      try{
        const cache=CacheService.getScriptCache();
        DCM_PARTNERS.forEach(p=>{cache.remove('partnerData-v4-'+p);cache.remove(partnerCacheKey_(p));});
        // The master upload already has all rows in memory; warming partner-only
        // snapshots avoids scanning the 5,000-row master sheet at their first login.
        for(const p of DCM_PARTNERS){
          const partnerData=partnerDataFromRows_(clean,p);
          putPartnerCached_(cache,p,{data:partnerData,updatedAt:nowIso,
            updatedBy:String(editor||'MASTER'),rowCount:partnerData.length,
            version:DCM_SYNC_API_VERSION,dashboardRevision:revision});
        }
      }catch(e){console.warn('Partner cache warmup skipped: '+String(e));}
    }
    return {updatedAt:nowIso, updatedBy:String(editor || 'MASTER'), rowCount:clean.length};
  } finally {
    lock.releaseLock();
  }
}

function normalizeOx_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'O' || s === 'X' ? s : '';
}

function assertUniqueActionKeys_(rows) {
  const seen=new Set(),duplicates=new Set();
  (rows||[]).forEach(r=>{
    const key=String(Array.isArray(r)?r[0]:(r&&r.key)||'').trim();
    if(!key)return;
    if(seen.has(key))duplicates.add(key);
    else seen.add(key);
  });
  if(duplicates.size)throw new Error('Action Board 거래처 키 중복 '+duplicates.size+
    '건 감지. 입력을 중단했습니다. 중복 행 정리 후 다시 저장하세요.');
}
function uniqueSnapshotActions_(rows) {
  const by=new Map();
  (rows||[]).forEach(a=>{if(a&&a.key)by.set(String(a.key),a);});
  return [...by.values()];
}
function loadActions_(includeHistory) {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh = ss.getSheetByName(DCM_SHEET);
  const hist = ss.getSheetByName(DCM_HISTORY_SHEET);
  const historyMap = {};
  if (includeHistory !== false && hist && hist.getLastRow() >= 2) {
    hist.getRange(2,1,hist.getLastRow()-1,11).getDisplayValues().forEach(r => {
      const key = r[1]; if (!key) return;
      if (!historyMap[key]) historyMap[key] = [];
      historyMap[key].push({at:r[10] || '', field:r[6] || '', value:r[8] || '', by:r[9] || '', previous:r[7] || ''});
    });
    Object.keys(historyMap).forEach(k => historyMap[k] = historyMap[k].slice(-50).reverse());
  }
  const last = sh.getLastRow();
  if (last < 2) return {actions:[], updatedBy:'', updatedAt:''};
  // Existing legacy Action Board may still have fewer than 20 columns before setup runs.
  const width=Math.min(20,sh.getMaxColumns());
  const values=sh.getRange(2,1,last-1,width).getDisplayValues().map(r=>r.concat(Array(20-r.length).fill('')));
  const byKey=new Map(),duplicateKeys=new Set(),reasonDict = loadReasons_();
  let latestAt = '', latestBy = '';
  values.forEach(r => {
    const key = r[0]; if (!key) return;
    const updatedAt = r[12] || '';
    if (updatedAt && (!latestAt || updatedAt > latestAt)) { latestAt = updatedAt; latestBy = r[11] || ''; }
    if (r[18] && (!latestAt || r[18] > latestAt)) { latestAt=r[18];latestBy=r[17]||''; }
    const next={
      key:key, businessNo:r[1] || '', priority:r[2] || '', businessName:r[3] || '', outlet:r[4] || '', manager:canonicalManager_(r[4],r[5]), aging:r[6] || '',
      reasonCode:reasonCode_(r[7], reasonDict), plan:r[8] || '', dueDate:normalizeDate_(r[9]), status:statusCode_(r[10]), modifiedBy:r[11] || '', updatedAt:r[12] || '', partnerAction:partnerActionFromCells_(r,reasonDict), history:historyMap[key] || []
    };
    const previous=byKey.get(String(key));
    if(previous){
      duplicateKeys.add(String(key));
      // Last edited record wins; no duplicate Action cards may reach either dashboard.
      const hasPartner=x=>x.partnerAction&&x.partnerAction.editedFields&&x.partnerAction.editedFields.length;
      const score=x=>(hasPartner(x)?100:0)+(x.updatedAt?10:0);
      if(score(next)>score(previous)||score(next)===score(previous)&&String(next.updatedAt||'')>=String(previous.updatedAt||''))byKey.set(String(key),next);
    }else byKey.set(String(key),next);
  });
  return {actions:[...byKey.values()], duplicateKeys:[...duplicateKeys], updatedBy:latestBy, updatedAt:latestAt};
}

function saveActions_(actions, editor, mode) {
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID),sh=ss.getSheetByName(DCM_SHEET);
  if(!sh)throw new Error('Action Board 시트가 없습니다.');
  const last=sh.getLastRow(),prior=last>=2?sh.getRange(2,1,last-1,13).getDisplayValues():[];
  assertUniqueActionKeys_(prior);
  const rowByKey=new Map();
  prior.forEach((r,i)=>{if(r[0])rowByKey.set(r[0],{row:i+2,values:r});});
  const isSnapshot=mode==='snapshot';
  const reasons=isSnapshot?null:loadReasons_();
  const nowIso=Utilities.formatDate(new Date(),'Asia/Seoul',"yyyy-MM-dd'T'HH:mm:ssXXX");
  const historyRows=[];
  let changedRows=0,latestAt='',latestBy='';
  const incoming=isSnapshot?uniqueSnapshotActions_(actions):(actions||[]);
  if(!isSnapshot)assertUniqueActionKeys_(incoming);
  incoming.forEach(function(a){
    if(!a||!a.key)return;
    const found=rowByKey.get(a.key),parts=String(a.key).split('|||'),prev=found?found.values:Array(13).fill('');
    const outlet=String(a.outlet||prev[4]||parts[0]||''),businessNo=String(a.businessNo||prev[1]||parts[1]||'');
    const fixed=[a.key,businessNo,a.priority||prev[2]||'',a.businessName||prev[3]||'',
      outlet,canonicalManager_(outlet,a.manager||prev[5]||''),a.aging||prev[6]||''];
    let row=found?found.row:sh.getLastRow()+1;
    let changed=!found;
    // The H:K columns belong to master Action content. Never rewrite H when only I/K/A:G changed.
    if(!found){
      sh.getRange(row,1,1,7).setValues([fixed]);
      rowByKey.set(a.key,{row:row,values:fixed.concat(Array(6).fill(''))});
    }else if(fixed.some((v,i)=>String(v||'')!==String(prev[i]||''))){
      sh.getRange(row,1,1,7).setValues([fixed]);
      changed=true;
    }
    if(isSnapshot){if(changed)changedRows++;return;}
    const hasFieldList=Array.isArray(a.changedFields);
    const editableFields=hasFieldList
      ?DCM_PARTNER_ACTION_FIELDS.filter(f=>a.changedFields.includes(f))
      :DCM_PARTNER_ACTION_FIELDS.filter(f=>Object.prototype.hasOwnProperty.call(a,f));
    const selected={reasonCode:a.reasonCode,plan:a.plan,dueDate:a.dueDate,status:a.status};
    const idxByField={reasonCode:7,plan:8,dueDate:9,status:10};
    let edited=false;
    editableFields.forEach(function(field){
      const idx=idxByField[field],old=String(prev[idx]||''),raw=selected[field]==null?'':String(selected[field]);
      let value='';
      if(field==='reasonCode'){
        // Never rewrite a historical H cell solely because a label changed in Config.
        const oldCode=reasonCode_(old,reasons);
        if(!hasFieldList && raw==='' && old) return; // Guard older browsers with stale cached selections.
        if(raw && !Object.prototype.hasOwnProperty.call(reasons,raw))throw new Error('원인코드 '+raw+'가 Config에 등록되지 않았습니다.');
        if(oldCode===raw && (old||raw===''))return;
        value=raw?reasonText_(raw,reasons):'';
        // Never rebuild column validation on ordinary saves. A single-cell repair occurs only on mismatch.
      }else if(field==='status'){
        if(raw && !['TODO','IN_PROGRESS','WAITING','DONE'].includes(raw))throw new Error('유효하지 않은 Action 상태입니다.');
        value=statusLabel_(raw||'TODO');
        if(!old && !hasFieldList && raw==='TODO')return;
      }else if(field==='dueDate'){
        if(raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw))throw new Error('Due 입력형식은 YYYY-MM-DD이어야 합니다.');
        value=raw;
      }else {
        if(raw.length>3000)throw new Error('조치계획은 최대 3000자입니다.');
        value=safeSheetText_(raw);
      }
      if(old===value)return;
      // Only the changed cell: prevents legacy invalid H31/H110 from aborting an unrelated edit.
      if(field==='reasonCode')setReasonCellSafely_(sh,row,value);
      else sh.getRange(row,idx+1).setValue(value);
      historyRows.push([Utilities.getUuid(),a.key,outlet,businessNo,fixed[3],fixed[5],
        ({reasonCode:'원인',plan:'조치계획',dueDate:'Due',status:'상태'})[field],old,value,editor||a.modifiedBy||'',nowIso]);
      edited=true;changed=true;
    });
    if(edited){
      const nextEditor=String(editor||a.modifiedBy||prev[11]||'');
      sh.getRange(row,12,1,2).setValues([[nextEditor,nowIso]]);
      latestAt=nowIso;latestBy=nextEditor;
    }
    if(changed)changedRows++;
  });
  if(historyRows.length){
    let hist=ss.getSheetByName(DCM_HISTORY_SHEET);
    if(!hist){setupDcmActionSync();hist=ss.getSheetByName(DCM_HISTORY_SHEET);}
    hist.getRange(hist.getLastRow()+1,1,historyRows.length,11).setValues(historyRows);
  }
  if(changedRows)markActionRevision_();
  return {updatedAt:latestAt,updatedBy:latestBy,changedRows:changedRows};
}


function canonicalReasonCode_(code) {
  const raw=String(code===null||code===undefined?'':code).trim();
  const match=raw.match(/^(\d{1,2})(?:\.0+)?(?:\s|$)/);
  return match?match[1].padStart(2,'0'):'';
}
function ensureReasonConfig_() {
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  let cfg=ss.getSheetByName(DCM_CONFIG_SHEET);
  if(!cfg){cfg=ss.insertSheet(DCM_CONFIG_SHEET);cfg.hideSheet();}
  if(cfg.getLastRow()<1)cfg.getRange(1,1,1,2).setValues([['code','label']]);
  const last=cfg.getLastRow();
  const existing=last>=2?cfg.getRange(2,1,last-1,2).getDisplayValues():[];
  // Preserve "08" as text, not numeric 8 or 8.0.
  cfg.getRange(2,1,Math.max(8,existing.length),1).setNumberFormat('@');
  const found=new Set();
  existing.forEach((row,i)=>{
    const code=canonicalReasonCode_(row[0]);
    if(!/^\d{2}$/.test(code))return;
    if(String(row[0]).trim()!==code)cfg.getRange(i+2,1).setValue(code);
    found.add(code);
  });
  const missing=Object.entries(DCM_REASON_DEFAULTS).filter(([code])=>!found.has(code));
  if(missing.length)cfg.getRange(cfg.getLastRow()+1,1,missing.length,2).setValues(missing);
  return cfg;
}

function syncReasons_(reasons) {
  // Legacy callers must not trigger a full H-column rewrite during routine Sync.
  // Vocabulary is fixed to seven options regardless of a stale Config 08 row.
  return {...DCM_REASON_DEFAULTS};
}
function loadReasons_() {
  // Static canonical vocabulary. Do not open/modify Spreadsheet Config on read requests.
  return {...DCM_REASON_DEFAULTS};
}

function refreshReasonValidation_() {
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID),sh=ss.getSheetByName(DCM_SHEET);
  if(!sh)throw new Error('Action Board 시트가 없습니다.');
  ensureReasonConfig_();
  const dict=loadReasons_();
  const labels=Object.entries(dict).map(([c,t])=>c+' '+t);
  // The dropdown remains, but old labels cannot block other changes.
  const rule=SpreadsheetApp.newDataValidation()
    .requireValueInList(labels,true)
    .setAllowInvalid(true)
    .setHelpText('원인코드 01~07 중 선택하세요. 이전 기록은 관리자가 검토하세요.')
    .build();
  const rowCount=Math.max(2,sh.getMaxRows?sh.getMaxRows():Math.max(sh.getLastRow(),1000));
  const entireH=sh.getRange(2,8,rowCount-1,1);
  // Existing sheet really has 6 fragmented validation rules (H31 only 01-07).
  // Clearing first avoids leaving single-cell override exceptions behind.
  entireH.clearDataValidations();
  entireH.setDataValidation(rule);
  return {updatedRows:rowCount-1,acceptedCodes:Object.keys(dict),allowedLabels:labels};
}
/**
 * Read-back validation audit for two reported cells and the next new row.
 * Running this repairs H2:H(maxRows) without overwriting any contents.
 */
function inspectActionReasonValidation_() {
  const sh=SpreadsheetApp.openById(DCM_SPREADSHEET_ID).getSheetByName(DCM_SHEET);
  if(!sh)throw new Error('Action Board 시트가 없습니다.');
  const rows=[31,110,Math.max(2,sh.getLastRow()+1)];
  const result={};
  rows.forEach(function(row){
    if(sh.getMaxRows && row>sh.getMaxRows())return;
    const range=sh.getRange(row,8,1,1),rule=range.getDataValidation();
    const criteria=rule&&typeof rule.getCriteriaValues==='function'?rule.getCriteriaValues():null;
    const options=criteria&&Array.isArray(criteria[0])?criteria[0]:null;
    result['H'+row]={
      hasRule:!!rule,
      allowInvalid:rule&&typeof rule.getAllowInvalid==='function'?rule.getAllowInvalid():null,
      type:rule&&typeof rule.getCriteriaType==='function'?String(rule.getCriteriaType()):null,
      validSeven:options?options.length===7&&options.some(s=>String(s)==='05 도매몰 미연동')&&!options.some(s=>String(s).startsWith('08 ')):null
    };
  });
  return result;
}
function repairActionReasonValidation() {
  const result=refreshReasonValidation_();
  const audit=inspectActionReasonValidation_();
  const blocked=Object.entries(audit).filter(([key,value])=>!value.hasRule||value.allowInvalid!==true||value.validSeven!==true);
  if(blocked.length)throw new Error('H열 입력 규칙 복구 후 검증이 실패했습니다: '+blocked.map(x=>x[0]).join(','));
  return {repaired:true,version:DCM_SYNC_API_VERSION,changedCellContents:0,
    updatedRows:result.updatedRows,acceptedCodes:result.acceptedCodes,audit:audit};
}
/**
 * Only called for an actual reason change. Self-heals a stale strict H-row
 * and retries once if Sheets still returns a validation rejection.
 */
function setReasonCellSafely_(sh,row,value) {
  const cell=sh.getRange(row,8,1,1);
  // Normal case is a single cell write; no 1,000-row validation rewrite here.
  try {cell.setValue(value);return;}
  catch(err) {
    const message=String(err&&err.message||err);
    if(!/validation|유효성|데이터 확인 규칙|입력 규칙|violates/i.test(message))throw err;
    const labels=Object.entries(DCM_REASON_DEFAULTS).map(([k,v])=>k+' '+v);
    const rule=SpreadsheetApp.newDataValidation().requireValueInList(labels,true)
      .setAllowInvalid(false).build();
    // Repair only the offending cell, retry once and report a real failure.
    cell.setDataValidation(rule);
    cell.setValue(value);
  }
}

function reasonCode_(text, cachedReasons) {
  const str=String(text||'').trim(),reasons=cachedReasons||loadReasons_();
  // 08 used to mean a mall-linkage issue; the approved seven-code scale now maps it to 05.
  if(/^0?8(?:\s|$)/.test(str))return '05';
  return Object.keys(reasons).sort((a,b)=>b.length-a.length).find(k=>str===k||str.startsWith(k+' '))||'';
}
function reasonText_(code, cachedReasons) {
  if(!code)return '';
  const reasons=cachedReasons||loadReasons_();
  return Object.prototype.hasOwnProperty.call(reasons,code)?code+' '+reasons[code]:String(code);
}


function statusLabel_(s) { return ({TODO:'미조치',IN_PROGRESS:'진행중',WAITING:'업체회신',DONE:'완료'})[s] || (s || '미조치'); }
function statusCode_(s) { return ({'미조치':'TODO','진행중':'IN_PROGRESS','업체회신':'WAITING','완료':'DONE'})[s] || (s || 'TODO'); }
function normalizeDate_(s) { const m=String(s||'').match(/\d{4}-\d{2}-\d{2}/); return m?m[0]:String(s||''); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/**
 * Owner-operated one-time repair, callable in the Apps Script editor after deployment.
 * Fixes historical Dashboard Data and Action Board manager labels without touching other fields.
 */
function fixDaejeonManagersInSheets() {
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  let changed=0;
  [[DCM_DATA_SHEET,2,3],[DCM_SHEET,5,6]].forEach(function(spec){
    const sh=ss.getSheetByName(spec[0]);if(!sh||sh.getLastRow()<2)return;
    const count=sh.getLastRow()-1,outs=sh.getRange(2,spec[1],count,1).getDisplayValues(),
      managers=sh.getRange(2,spec[2],count,1).getDisplayValues();
    for(let i=0;i<count;i++){
      if(String(outs[i][0]||'').trim()==='백제약품 대전'&&String(managers[i][0]||'').trim()!=='정직한'){
        sh.getRange(i+2,spec[2]).setValue('정직한');changed++;
      }
    }
  });
  SpreadsheetApp.flush();return '수정한 담당자 셀: '+changed;
}


/* SRM workflow: append-only audit history, one case per outlet/business/entity.
 * No writes to existing Dashboard Data, Action Board or master/partner cells.
 * "조치 완료" (DONE) remains distinct from observed X->O (VERIFIED).
 */
function withSrmLock_(callback) {
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('동시에 저장 중입니다. 잠시 후 다시 저장해 주세요.');
  try{return callback();}finally{lock.releaseLock();}
}
function ensureSrmSheet_(){
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  let sh=ss.getSheetByName(DCM_SRM_SHEET);
  if(!sh){
    sh=ss.insertSheet(DCM_SRM_SHEET);
    sh.getRange(1,1,1,DCM_SRM_FIELDS.length).setValues([DCM_SRM_FIELDS]);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }else{
    const row=sh.getRange(1,1,1,DCM_SRM_FIELDS.length).getDisplayValues()[0];
    if(row.some((v,i)=>String(v)!==DCM_SRM_FIELDS[i]))
      throw new Error('SRM Events 헤더가 규격과 다릅니다. 기존 원본은 변경하지 않았습니다.');
  }
  return sh;
}
function loadSrmEvents_(partner){
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh=ss.getSheetByName(DCM_SRM_SHEET);
  if(!sh||sh.getLastRow()<2)return {events:[],updatedAt:'',hasMore:false};
  const count=Math.min(sh.getLastRow()-1,3000),start=sh.getLastRow()-count+1;
  const records=sh.getRange(start,1,count,DCM_SRM_FIELDS.length).getDisplayValues();
  let events=records.map(r=>Object.fromEntries(DCM_SRM_FIELDS.map((f,i)=>[f,r[i]||''])))
    .filter(e=>!partner||partnerOfOutlet_(e.outlet)===partner);
  const hasMore=events.length>1000;
  events=events.slice(-1000);
  return {events:events,updatedAt:events.length?events[events.length-1].updatedAt:'',hasMore:hasMore};
}
function srmCheckTransition_(key,entity,baselineMonth){
  const companyIndex={'대웅제약':5,'대웅바이오':6,'한올바이오':7}[entity];
  if(companyIndex===undefined)return {passed:false,reason:'검증할 그룹사를 선택해 주세요.'};
  if(!/^\d{4}-\d{2}$/.test(baselineMonth))return {passed:false,reason:'검증 기준월을 선택해 주세요.'};
  const sh=SpreadsheetApp.openById(DCM_SPREADSHEET_ID).getSheetByName(DCM_DATA_SHEET);
  if(!sh||sh.getLastRow()<2)return {passed:false,reason:'연동 평가 데이터가 없습니다.'};
  const rows=sh.getRange(2,1,sh.getLastRow()-1,9).getDisplayValues();
  let baseline='',latest='',latestMonth='';
  rows.forEach(r=>{
    if(String(r[1])+'|||'+String(r[3])!==key)return;
    if(r[0]===baselineMonth)baseline=String(r[companyIndex]||'').toUpperCase();
    if(r[0]>=baselineMonth&&r[0]>=latestMonth){latestMonth=r[0];latest=String(r[companyIndex]||'').toUpperCase();}
  });
  const passed=baseline==='X'&&latest==='O'&&latestMonth>baselineMonth;
  return {passed,verificationMonth:latestMonth,reason:passed?'실제 X→O 전환 확인':'기준월 X 및 이후 최신월 O 조건을 만족하지 않습니다.'};
}
function appendSrmEvent_(body,side,partner){
  const key=String(body.key||''),parts=key.split('|||'),entity=String(body.entity||''),
    status=String(body.status||'OPEN'),type=String(body.eventType||'CASE_UPDATE'),
    baseline=String(body.baselineMonth||''), requestId=String(body.requestId||'');
  if(parts.length!==2||!parts[0]||!parts[1]||key.length>240)throw new Error('거래처 식별값이 유효하지 않습니다.');
  if(side==='partner'&&partnerOfOutlet_(parts[0])!==partner)throw new Error('해당 파트너사의 거래처만 저장할 수 있습니다.');
  if(!['대웅제약','대웅바이오','한올바이오'].includes(entity))throw new Error('그룹사 선택이 필요합니다.');
  if(!['CASE_UPDATE','CONTACT','VERIFICATION'].includes(type))throw new Error('잘못된 활동 유형입니다.');
  if(!['OPEN','CHECKING','ERP_WAIT','IN_PROGRESS','DONE','VERIFIED','REOPENED'].includes(status))
    throw new Error('허용되지 않는 SRM 진행상태입니다.');
  if(requestId.length<8||requestId.length>100)throw new Error('중복 저장 방지 요청번호가 필요합니다.');
  const columns=['reason','erpVendor','contactTarget','detail','nextAction','owner','dueDate','baselineMonth'];
  const clean={};
  columns.forEach(f=>{
    clean[f]=String(body[f]||'').trim();
    if(clean[f].length>1000)throw new Error(f+' 입력값이 1000자를 초과했습니다.');
  });
  if(clean.reason&&!Object.prototype.hasOwnProperty.call(DCM_REASON_DEFAULTS,clean.reason))throw new Error('SRM 원인코드는 01~07만 허용합니다.');
  if(clean.dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(clean.dueDate))throw new Error('기한은 YYYY-MM-DD 형식이어야 합니다.');
  if(clean.baselineMonth&&!/^\d{4}-\d{2}$/.test(clean.baselineMonth))throw new Error('기준월 형식이 올바르지 않습니다.');
  if(!clean.detail&&!clean.nextAction)throw new Error('협의내용 또는 다음 조치를 입력해 주세요.');
  const sh=ensureSrmSheet_(),last=sh.getLastRow();
  const n=Math.min(300,last-1);
  if(n>0){
    const ids=sh.getRange(last-n+1,21,n,1).getDisplayValues().flat();
    if(ids.includes(requestId))return {saved:true,duplicate:true,requestId:requestId};
  }
  let verificationMonth='',result='';
  if(status==='VERIFIED'){
    const x=srmCheckTransition_(key,entity,clean.baselineMonth);
    if(!x.passed)throw new Error('X→O 검증 실패: '+x.reason);
    verificationMonth=x.verificationMonth;
    result='X→O 확인';
  }else if(status==='DONE')result='조치 완료·연동 검증 대기';
  else result='진행 중';
  const now=Utilities.formatDate(new Date(),'Asia/Seoul',"yyyy-MM-dd'T'HH:mm:ssXXX");
  const actor=side==='partner'?'유통협력사:'+partner:String(body.actor||'마스터').slice(0,100);
  const eventId=Utilities.getUuid();
  const v=[eventId,key,parts[0],parts[1],entity,type,status,clean.reason,clean.erpVendor,
    clean.contactTarget,clean.detail,clean.nextAction,clean.owner,clean.dueDate,
    clean.baselineMonth,actor,side,now,verificationMonth,result,requestId];
  const safe=v.map(x=>/^[=+\-@]/.test(String(x))?"'"+x:x);
  sh.getRange(sh.getLastRow()+1,1,1,DCM_SRM_FIELDS.length).setValues([safe]);
  return {saved:true,eventId:eventId,requestId:requestId,updatedAt:now,result:result};
}
