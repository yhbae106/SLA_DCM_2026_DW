const DCM_SPREADSHEET_ID = '1LbEuintnEZbnwJXZcrbTWZNECWMg4ry7_UwRsQ9end0';
const DCM_SHEET = 'Action Board';
const DCM_CONFIG_SHEET = 'Config';
const DCM_HISTORY_SHEET = 'History';
const DCM_DATA_SHEET = 'Dashboard Data';
const DCM_DATA_META_SHEET = 'Dashboard Meta';

function doGet(e) {
  try {
    const type = String(e && e.parameter && e.parameter.type || '');
    if (type === 'dashboard') return json_({ok:true, ...loadDashboardData_()});
    assertToken_(e && e.parameter && e.parameter.token);
    return json_({ok:true, ...loadActions_()});
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
    if (body.type === 'saveDashboard') {
      assertMasterPassword_(body.password);
      const result = saveDashboardData_(Array.isArray(body.data) ? body.data : [], body.editor || 'MASTER');
      return json_({ok:true, ...result});
    }
    assertToken_(body.token);
    if (body.type === 'syncReasons') {
      syncReasons_(body.reasons || {});
      return json_({ok:true});
    }
    if (body.type !== 'save') throw new Error('지원하지 않는 요청입니다.');
    const result = saveActions_(Array.isArray(body.actions) ? body.actions : [], body.editor || '', body.mode || 'edit');
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

function setupDcmActionSync() {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  let hist = ss.getSheetByName(DCM_HISTORY_SHEET);
  if (!hist) {
    hist = ss.insertSheet(DCM_HISTORY_SHEET);
    hist.hideSheet();
    hist.getRange(1,1,1,11).setValues([['eventId','key','업체/권역','사업자번호','실사업자명','담당자','변경필드','이전값','변경값','수정자','수정시간']]);
  }
  ensureDashboardSheets_();
  syncReasons_({
    '01':'ERP/시스템 미구축','02':'도입 품목 미연동','03':'전산/데이터 오류','04':'거래처 연동 거부/미협조',
    '05':'공급·거래 중단 예정','06':'신규 거래처 연동 예정','07':'당월 매출 미발생'
  });
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
        month:r[0] || '', outlet:r[1] || '', manager:r[2] || '', businessNo:r[3] || '', businessName:r[4] || '',
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
        String(r.month), String(r.outlet), String(r.manager || ''), String(r.businessNo), String(r.businessName || ''),
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
    return {updatedAt:nowIso, updatedBy:String(editor || 'MASTER'), rowCount:clean.length};
  } finally {
    lock.releaseLock();
  }
}

function normalizeOx_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'O' || s === 'X' ? s : '';
}

function loadActions_() {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh = ss.getSheetByName(DCM_SHEET);
  const hist = ss.getSheetByName(DCM_HISTORY_SHEET);
  const historyMap = {};
  if (hist && hist.getLastRow() >= 2) {
    hist.getRange(2,1,hist.getLastRow()-1,11).getDisplayValues().forEach(r => {
      const key = r[1]; if (!key) return;
      if (!historyMap[key]) historyMap[key] = [];
      historyMap[key].push({at:r[10] || '', field:r[6] || '', value:r[8] || '', by:r[9] || '', previous:r[7] || ''});
    });
    Object.keys(historyMap).forEach(k => historyMap[k] = historyMap[k].slice(-50).reverse());
  }
  const last = sh.getLastRow();
  if (last < 2) return {actions:[], updatedBy:'', updatedAt:''};
  const values = sh.getRange(2,1,last-1,13).getDisplayValues();
  const actions = [];
  let latestAt = '', latestBy = '';
  values.forEach(r => {
    const key = r[0]; if (!key) return;
    const updatedAt = r[12] || '';
    if (updatedAt && (!latestAt || updatedAt > latestAt)) { latestAt = updatedAt; latestBy = r[11] || ''; }
    actions.push({
      key:key, businessNo:r[1] || '', priority:r[2] || '', businessName:r[3] || '', outlet:r[4] || '', manager:r[5] || '', aging:r[6] || '',
      reasonCode:reasonCode_(r[7]), plan:r[8] || '', dueDate:normalizeDate_(r[9]), status:statusCode_(r[10]), modifiedBy:r[11] || '', updatedAt:r[12] || '', history:historyMap[key] || []
    });
  });
  return {actions:actions, updatedBy:latestBy, updatedAt:latestAt};
}

function saveActions_(actions, editor, mode) {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh = ss.getSheetByName(DCM_SHEET);
  const last = sh.getLastRow();
  const existing = last >= 2 ? sh.getRange(2,1,last-1,13).getDisplayValues() : [];
  const rowByKey = new Map();
  existing.forEach((r,i) => { if (r[0]) rowByKey.set(r[0], {row:i+2, values:r}); });
  const nowIso = Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
  const historyRows = [];
  let changedRows = 0;
  let latestBy = '';
  let latestAt = '';
  actions.forEach(a => {
    if (!a || !a.key) return;
    const found = rowByKey.get(a.key);
    const prev = found ? found.values : Array(13).fill('');
    const outlet = a.outlet || prev[4] || String(a.key).split('|||')[0] || '';
    const businessNo = a.businessNo || prev[1] || String(a.key).split('|||')[1] || '';
    const fixed = [a.key,businessNo,a.priority || prev[2] || '',a.businessName || prev[3] || '',outlet,a.manager || prev[5] || '',a.aging || prev[6] || ''];
    const editable = [reasonText_(a.reasonCode),a.plan || '',a.dueDate || '',statusLabel_(a.status)];
    const fixedChanged = !found || fixed.some((v,i)=>String(prev[i]||'')!==String(v||''));
    const editableIndexes = [7,8,9,10];
    const editableChanged = found && editableIndexes.some((idx,i)=>String(prev[idx]||'')!==String(editable[i]||''));
    const hasUserContent = !!(a.reasonCode || a.plan || a.dueDate || (a.status && a.status !== 'TODO'));
    const stampEdit = editableChanged || (!found && hasUserContent && mode !== 'snapshot');
    const nextEditor = stampEdit ? (editor || a.modifiedBy || prev[11] || '') : (prev[11] || '');
    const nextTime = stampEdit ? nowIso : (prev[12] || '');
    const next = [...fixed, ...editable, nextEditor, nextTime];
    if (editableChanged) {
      editableIndexes.forEach((idx,i) => {
        if (String(prev[idx] || '') !== String(editable[i] || '')) historyRows.push([Utilities.getUuid(),a.key,outlet,businessNo,next[3] || '',next[5] || '',['원인','조치계획','Due','상태'][i],prev[idx] || '',editable[i] || '',editor || a.modifiedBy || '',nowIso]);
      });
    }
    const rowChanged = !found || fixedChanged || editableChanged;
    if (!rowChanged) return;
    changedRows++;
    if (stampEdit) { latestBy = nextEditor; latestAt = nextTime; }
    if (found) sh.getRange(found.row,1,1,13).setValues([next]);
    else { sh.appendRow(next); rowByKey.set(a.key,{row:sh.getLastRow(),values:next}); }
  });
  if (historyRows.length) {
    let hist = ss.getSheetByName(DCM_HISTORY_SHEET);
    if (!hist) { setupDcmActionSync(); hist = ss.getSheetByName(DCM_HISTORY_SHEET); }
    hist.getRange(hist.getLastRow()+1,1,historyRows.length,11).setValues(historyRows);
  }
  return {updatedBy:latestBy, updatedAt:latestAt, changedRows:changedRows};
}

function syncReasons_(reasons) {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh = ss.getSheetByName(DCM_SHEET);
  let cfg = ss.getSheetByName(DCM_CONFIG_SHEET);
  if (!cfg) { cfg = ss.insertSheet(DCM_CONFIG_SHEET); cfg.hideSheet(); }
  const entries = Object.keys(reasons).sort().map(k => [k, reasons[k]]);
  const current = cfg.getLastRow() >= 2 ? cfg.getRange(2,1,cfg.getLastRow()-1,2).getDisplayValues() : [];
  if (JSON.stringify(current) !== JSON.stringify(entries)) {
    cfg.clearContents(); cfg.getRange(1,1,1,2).setValues([['code','label']]); if (entries.length) cfg.getRange(2,1,entries.length,2).setValues(entries);
  }
  const labels = entries.map(x => `${x[0]} ${x[1]}`);
  if (labels.length) sh.getRange('H2:H1000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(labels, true).setAllowInvalid(false).build());
}

function reasonCode_(text) { const m = String(text || '').match(/^(\d{2})/); return m ? m[1] : ''; }
function reasonText_(code) {
  const cfg = SpreadsheetApp.openById(DCM_SPREADSHEET_ID).getSheetByName(DCM_CONFIG_SHEET);
  if (!code || !cfg || cfg.getLastRow() < 2) return '';
  const vals = cfg.getRange(2,1,cfg.getLastRow()-1,2).getDisplayValues();
  const row = vals.find(r => r[0] === String(code)); return row ? `${row[0]} ${row[1]}` : String(code);
}
function statusLabel_(s) { return ({TODO:'미조치',IN_PROGRESS:'진행중',WAITING:'업체회신',DONE:'완료'})[s] || (s || '미조치'); }
function statusCode_(s) { return ({'미조치':'TODO','진행중':'IN_PROGRESS','업체회신':'WAITING','완료':'DONE'})[s] || (s || 'TODO'); }
function normalizeDate_(s) { const m=String(s||'').match(/\d{4}-\d{2}-\d{2}/); return m?m[0]:String(s||''); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
