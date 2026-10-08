const DCM_SPREADSHEET_ID = '1LbEuintnEZbnwJXZcrbTWZNECWMg4ry7_UwRsQ9end0';
const DCM_SHEET = 'Action Board';
const DCM_CONFIG_SHEET = 'Config';
const DCM_HISTORY_SHEET = 'History';
const DCM_DATA_SHEET = 'Dashboard Data';
const DCM_DATA_META_SHEET = 'Dashboard Meta';
const DCM_PARTNERS = ['백제약품','인천약품','복산나이스','아이팜코리아','유진약품'];
const DCM_PARTNER_ACTION_HEADERS = ['업체 원인','업체 조치계획','업체 Due','업체 상태','업체 수정자','업체 수정시간','업체 수정필드'];
const DCM_PARTNER_ACTION_FIELDS = ['reasonCode','plan','dueDate','status'];
const DCM_SYNC_API_VERSION = '20261008-fast-batch-1';
const DCM_REASON_DEFAULTS = {
  '01':'ERP/시스템 미구축','02':'도입 품목 미연동','03':'전산/데이터 오류',
  '04':'거래처 연동 거부/미협조','05':'공급·거래 중단 예정',
  '06':'신규 거래처 연동 예정','07':'당월 매출 미발생','08':'도매몰 연동 필요'
};

function doGet(e) {
  try {
    const type = String(e && e.parameter && e.parameter.type || '');
    if (type === 'health') return json_({ok:true, service:'DCM Action Sync',version:DCM_SYNC_API_VERSION});
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
      if (body.type === 'partnerLogin') return json_({ok:true, partner:partner,version:DCM_SYNC_API_VERSION});
      return json_({ok:true, partner:partner, ...loadPartnerDashboardData_(partner)});
    }
    if (body.type === 'partnerActions' || body.type === 'partnerSaveAction' || body.type === 'partnerSaveActions') {
      const partner = normalizePartner_(body.partner);
      assertPartnerPassword_(partner, body.password);
      if (body.type === 'partnerActions') return json_({ok:true, ...loadPartnerActions_(partner)});
      if (body.type === 'partnerSaveActions') return json_({ok:true,...withActionLock_(function(){return savePartnerActionsBatch_(partner,body.changes);})});
      return json_({ok:true, ...withActionLock_(function(){return savePartnerAction_(partner,body);})});
    }
    if (body.type === 'saveDashboard') {
      assertMasterPassword_(body.password);
      const result = saveDashboardData_(Array.isArray(body.data) ? body.data : [], body.editor || 'MASTER');
      return json_({ok:true, ...result});
    }
    assertToken_(body.token);
    if (body.type === 'load') return json_({ok:true, ...loadActions_(), reasons:loadReasons_(),version:DCM_SYNC_API_VERSION});
    if (body.type === 'syncReasons') {
      refreshReasonValidation_();
      return json_({ok:true, reasons:loadReasons_()});
    }
    if (body.type !== 'save') throw new Error('지원하지 않는 요청입니다.');
    const result = withActionLock_(function(){return saveActions_(Array.isArray(body.actions) ? body.actions : [], body.editor || '', body.mode || 'edit');});
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

function assertMasterPassword_(password) {
  const expected = PropertiesService.getScriptProperties().getProperty('DCM_MASTER_PASSWORD');
  if (!expected) throw new Error('Apps Script의 DCM_MASTER_PASSWORD가 설정되지 않았습니다.');
  if (!password || password !== expected) throw new Error('마스터 비밀번호가 올바르지 않습니다.');
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

function loadPartnerDashboardData_(partner) {
  // Login/dashboard must not wait for the much heavier Action Board sheet and History.
  const cache = typeof CacheService === 'undefined' ? null : CacheService.getScriptCache();
  const cacheKey='partnerData-v3-'+partner;
  if(cache){const saved=cache.get(cacheKey);if(saved){try{return JSON.parse(saved);}catch(ignore){}}}
  const all = loadDashboardData_();
  const filtered = (all.data || []).filter(r => partnerOfOutlet_(r.outlet) === partner);
  const result={data:filtered,updatedAt:all.updatedAt,updatedBy:all.updatedBy,rowCount:filtered.length,version:DCM_SYNC_API_VERSION};
  if(cache){const encoded=JSON.stringify(result);if(encoded.length<85000)cache.put(cacheKey,encoded,90);}
  return result;
}


function withActionLock_(callback) {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {return callback();} finally {lock.releaseLock();}
}
function loadPartnerActions_(partner) {
  const shared=loadActions_(false);
  const visible=shared.actions.filter(a => partnerOfOutlet_(a.outlet || String(a.key || '').split('|||')[0]) === partner)
    .map(a => ({key:a.key,businessNo:a.businessNo,priority:a.priority,businessName:a.businessName,
      outlet:a.outlet,manager:canonicalManager_(a.outlet,a.manager),aging:a.aging,reasonCode:a.reasonCode,
      plan:a.plan,dueDate:a.dueDate,status:a.status,modifiedBy:a.modifiedBy,updatedAt:a.updatedAt,
      partnerAction:a.partnerAction||null}));
  return {actions:visible,reasons:loadReasons_(),updatedAt:shared.updatedAt,updatedBy:shared.updatedBy};
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
    const val=String(item&&item.value==null?'':item.value);
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
    clean.sort((a,b)=>String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]),'ko') || String(a[3]).localeCompare(String(b[3])));
    sh.clearContents();
    sh.getRange(1,1,1,9).setValues([['month','outlet','manager','businessNo','businessName','대웅제약','대웅바이오','한올바이오','savedAt']]);
    if (clean.length) sh.getRange(2,1,clean.length,9).setValues(clean);
    meta.clearContents();
    meta.getRange(1,1,1,3).setValues([['updatedAt','updatedBy','rowCount']]);
    meta.getRange(2,1,1,3).setValues([[nowIso, String(editor || 'MASTER'), clean.length]]);
    SpreadsheetApp.flush();
    if(typeof CacheService !== 'undefined'){const cache=CacheService.getScriptCache();DCM_PARTNERS.forEach(p=>cache.remove('partnerData-v3-'+p));}
    return {updatedAt:nowIso, updatedBy:String(editor || 'MASTER'), rowCount:clean.length};
  } finally {
    lock.releaseLock();
  }
}

function normalizeOx_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'O' || s === 'X' ? s : '';
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
  const actions = [], reasonDict = loadReasons_();
  let latestAt = '', latestBy = '';
  values.forEach(r => {
    const key = r[0]; if (!key) return;
    const updatedAt = r[12] || '';
    if (updatedAt && (!latestAt || updatedAt > latestAt)) { latestAt = updatedAt; latestBy = r[11] || ''; }
    if (r[18] && (!latestAt || r[18] > latestAt)) { latestAt=r[18];latestBy=r[17]||''; }
    actions.push({
      key:key, businessNo:r[1] || '', priority:r[2] || '', businessName:r[3] || '', outlet:r[4] || '', manager:canonicalManager_(r[4],r[5]), aging:r[6] || '',
      reasonCode:reasonCode_(r[7], reasonDict), plan:r[8] || '', dueDate:normalizeDate_(r[9]), status:statusCode_(r[10]), modifiedBy:r[11] || '', updatedAt:r[12] || '', partnerAction:partnerActionFromCells_(r,reasonDict), history:historyMap[key] || []
    });
  });
  return {actions:actions, updatedBy:latestBy, updatedAt:latestAt};
}

function saveActions_(actions, editor, mode) {
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID),sh=ss.getSheetByName(DCM_SHEET);
  if(!sh)throw new Error('Action Board 시트가 없습니다.');
  const last=sh.getLastRow(),prior=last>=2?sh.getRange(2,1,last-1,13).getDisplayValues():[];
  const rowByKey=new Map();
  prior.forEach((r,i)=>{if(r[0])rowByKey.set(r[0],{row:i+2,values:r});});
  const isSnapshot=mode==='snapshot';
  const reasons=isSnapshot?null:loadReasons_();
  const nowIso=Utilities.formatDate(new Date(),'Asia/Seoul',"yyyy-MM-dd'T'HH:mm:ssXXX");
  const historyRows=[];
  let changedRows=0,latestAt='',latestBy='',reasonRuleReady=false;
  (actions||[]).forEach(function(a){
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
        if(!reasonRuleReady){refreshReasonValidation_();reasonRuleReady=true;}
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
      sh.getRange(row,idx+1).setValue(value);
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
  return {updatedAt:latestAt,updatedBy:latestBy,changedRows:changedRows};
}

function syncReasons_(reasons) {
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  let cfg=ss.getSheetByName(DCM_CONFIG_SHEET);
  if(!cfg){cfg=ss.insertSheet(DCM_CONFIG_SHEET);cfg.hideSheet();}
  const existing=cfg.getLastRow()>=2?cfg.getRange(2,1,cfg.getLastRow()-1,2).getDisplayValues():[];
  const current=new Map(existing.map(r=>[String(r[0]||'').trim(),String(r[1]||'').trim()]));
  if(cfg.getLastRow()<1)cfg.getRange(1,1,1,2).setValues([['code','label']]);
  const incoming={...DCM_REASON_DEFAULTS,...(reasons||{})};
  const add=Object.entries(incoming).filter(([code,label])=>/^\d{2}$/.test(code)&&String(label||'').trim()&&!current.has(code));
  if(add.length)cfg.getRange(cfg.getLastRow()+1,1,add.length,2).setValues(add);
  refreshReasonValidation_();
}
function loadReasons_() {
  // Include the default vocabulary even if an older Config tab only holds codes 01–07.
  const dictionary={...DCM_REASON_DEFAULTS},cfg=SpreadsheetApp.openById(DCM_SPREADSHEET_ID).getSheetByName(DCM_CONFIG_SHEET);
  if(cfg&&cfg.getLastRow()>=2)cfg.getRange(2,1,cfg.getLastRow()-1,2).getDisplayValues().forEach(r=>{
    const code=String(r[0]||'').trim(),label=String(r[1]||'').trim();
    if(/^\d{2}$/.test(code)&&label)dictionary[code]=label;
  });
  return dictionary;
}
function refreshReasonValidation_() {
  const ss=SpreadsheetApp.openById(DCM_SPREADSHEET_ID),sh=ss.getSheetByName(DCM_SHEET);
  if(!sh)return;
  const dict=loadReasons_(),cfg=ss.getSheetByName(DCM_CONFIG_SHEET);
  // Add only missing codes; do not replace user-customized Config labels.
  if(cfg){
    const existing=cfg.getLastRow()>=2?cfg.getRange(2,1,cfg.getLastRow()-1,1).getDisplayValues().map(r=>String(r[0]).trim()):[];
    const missing=Object.entries(dict).filter(([c])=>!existing.includes(c));
    if(missing.length)cfg.getRange(cfg.getLastRow()+1,1,missing.length,2).setValues(missing);
  }
  const labels=Object.entries(dict).map(([c,t])=>c+' '+t);
  // Warning-only validation permits historical labels in H31/H110; the API still validates new values.
  const rule=SpreadsheetApp.newDataValidation().requireValueInList(labels,true).setAllowInvalid(true).build();
  const last=Math.max(sh.getLastRow(),1000);
  sh.getRange(2,8,last-1,1).setDataValidation(rule);
}
function repairActionReasonValidation() {
  refreshReasonValidation_();
  return '원인코드 01~08 및 기존 값 수용 규칙 복구 완료';
}
function reasonCode_(text, cachedReasons) {
  const str=String(text||'').trim(),reasons=cachedReasons||loadReasons_();
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
