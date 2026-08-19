const DCM_SPREADSHEET_ID = '1LbEuintnEZbnwJXZcrbTWZNECWMg4ry7_UwRsQ9end0';
const DCM_SHEET = 'Action Board';
const DCM_CONFIG_SHEET = 'Config';
const DCM_HISTORY_SHEET = 'History';

function doGet(e) {
  try {
    assertToken_(e && e.parameter && e.parameter.token);
    return json_({ok:true, ...loadActions_()});
  } catch (err) {
    return json_({ok:false, error:String(err && err.message || err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertToken_(body.token);
    if (body.type === 'syncReasons') {
      syncReasons_(body.reasons || {});
      return json_({ok:true});
    }
    if (body.type !== 'save') throw new Error('지원하지 않는 요청입니다.');
    syncReasons_(body.reasons || {});
    const result = saveActions_(Array.isArray(body.actions) ? body.actions : [], body.editor || '');
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

function setupDcmActionSync() {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  let hist = ss.getSheetByName(DCM_HISTORY_SHEET);
  if (!hist) {
    hist = ss.insertSheet(DCM_HISTORY_SHEET);
    hist.hideSheet();
    hist.getRange(1,1,1,11).setValues([['eventId','key','업체/권역','사업자번호','실사업자명','담당자','변경필드','이전값','변경값','수정자','수정시간']]);
  }
  syncReasons_({
    '01':'시스템 미구축','02':'거래처 사용거부','03':'ERP Interface 오류','04':'Master 불일치','05':'신규거래처',
    '06':'공급중단 예정','07':'사용법 미숙','08':'데이터 오류','09':'확인 중','99':'기타'
  });
}

function assertToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('DCM_SYNC_KEY');
  if (!expected) throw new Error('Apps Script의 DCM_SYNC_KEY가 설정되지 않았습니다.');
  if (!token || token !== expected) throw new Error('공유키가 올바르지 않습니다.');
}

function loadActions_() {
  const sh = SpreadsheetApp.openById(DCM_SPREADSHEET_ID).getSheetByName(DCM_SHEET);
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
      key:key,
      businessNo:r[1] || '',
      priority:r[2] || '',
      businessName:r[3] || '',
      outlet:r[4] || '',
      manager:r[5] || '',
      aging:r[6] || '',
      reasonCode:reasonCode_(r[7]),
      plan:r[8] || '',
      dueDate:normalizeDate_(r[9]),
      status:statusCode_(r[10]),
      modifiedBy:r[11] || '',
      updatedAt:r[12] || '',
      history:[]
    });
  });
  return {actions:actions, updatedBy:latestBy, updatedAt:latestAt};
}

function saveActions_(actions, editor) {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh = ss.getSheetByName(DCM_SHEET);
  const last = sh.getLastRow();
  const existing = last >= 2 ? sh.getRange(2,1,last-1,13).getDisplayValues() : [];
  const rowByKey = new Map();
  existing.forEach((r,i) => { if (r[0]) rowByKey.set(r[0], {row:i+2, values:r}); });
  const now = new Date();
  const nowIso = Utilities.formatDate(now, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
  const historyRows = [];

  actions.forEach(a => {
    if (!a || !a.key) return;
    const found = rowByKey.get(a.key);
    const prev = found ? found.values : Array(13).fill('');
    const outlet = a.outlet || prev[4] || String(a.key).split('|||')[0] || '';
    const businessNo = a.businessNo || prev[1] || String(a.key).split('|||')[1] || '';
    const next = [
      a.key,
      businessNo,
      a.priority || prev[2] || '',
      a.businessName || prev[3] || '',
      outlet,
      a.manager || prev[5] || '',
      a.aging || prev[6] || '',
      reasonText_(a.reasonCode),
      a.plan || '',
      a.dueDate || '',
      statusLabel_(a.status),
      editor || a.modifiedBy || prev[11] || '',
      nowIso
    ];
    const editableIndexes = [7,8,9,10];
    editableIndexes.forEach(idx => {
      if (String(prev[idx] || '') !== String(next[idx] || '')) {
        historyRows.push([Utilities.getUuid(),a.key,outlet,businessNo,next[3] || '',next[5] || '',['원인','조치계획','Due','상태'][editableIndexes.indexOf(idx)],prev[idx] || '',next[idx] || '',next[11],nowIso]);
      }
    });
    if (found) sh.getRange(found.row,1,1,13).setValues([next]);
    else { sh.appendRow(next); rowByKey.set(a.key,{row:sh.getLastRow(),values:next}); }
  });

  if (historyRows.length) {
    let hist = ss.getSheetByName(DCM_HISTORY_SHEET);
    if (!hist) { setupDcmActionSync(); hist = ss.getSheetByName(DCM_HISTORY_SHEET); }
    hist.getRange(hist.getLastRow()+1,1,historyRows.length,11).setValues(historyRows);
  }
  return {updatedBy:editor || '', updatedAt:nowIso};
}

function syncReasons_(reasons) {
  const ss = SpreadsheetApp.openById(DCM_SPREADSHEET_ID);
  const sh = ss.getSheetByName(DCM_SHEET);
  let cfg = ss.getSheetByName(DCM_CONFIG_SHEET);
  if (!cfg) { cfg = ss.insertSheet(DCM_CONFIG_SHEET); cfg.hideSheet(); }
  const entries = Object.keys(reasons).sort().map(k => [k, reasons[k]]);
  cfg.clearContents();
  cfg.getRange(1,1,1,2).setValues([['code','label']]);
  if (entries.length) cfg.getRange(2,1,entries.length,2).setValues(entries);
  const labels = entries.map(x => `${x[0]} ${x[1]}`);
  if (labels.length) {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(labels, true).setAllowInvalid(false).build();
    sh.getRange('H2:H1000').setDataValidation(rule);
  }
}

function reasonCode_(text) {
  const m = String(text || '').match(/^(\d{2})/); return m ? m[1] : '';
}
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
