import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync('apps-script/Code.gs','utf8');
const fail=message=>{throw new Error('Apps Script regression: '+message)};
const ok=message=>console.log('PASS GAS',message);

class MockSheet {
  constructor(name,rows=[],columns=20){this.name=name;this.rows=rows.map(r=>[...r]);this.columns=columns;this.rules=new Map();this.writes=[];}
  getLastRow(){return this.rows.length;}
  getMaxColumns(){return this.columns;}
  getMaxRows(){return 1000;}
  insertColumnsAfter(col,count){this.columns+=count;}
  hideSheet(){}
  setFrozenRows(){}
  clearContents(){this.rows=[];}
  appendRow(row){this.getRange(this.getLastRow()+1,1,1,row.length).setValues([row]);}
  getRange(start,col,n=1,w=1){
    if(typeof start==='string')throw new Error('Unexpected A1-style test range '+start);
    if(col+w-1>this.columns)throw new Error('Column unavailable');
    const sheet=this;
    function at(r,c){return sheet.rows[r-1]?.[c-1]??'';}
    function store(r,c,value){
      const rule=sheet.rules.get(r+':'+c);
      if(rule && !rule.allowInvalid && c===8 && value &&
        !rule.options.includes(String(value)))throw new Error('H'+r+' 셀의 데이터 확인 규칙 위반');
      while(sheet.rows.length<r)sheet.rows.push([]);
      sheet.rows[r-1][c-1]=value;
      sheet.writes.push({row:r,col:c,value});
    }
    return {
      getDisplayValues(){return Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(at(start+i,col+j))));},
      getDataValidation(){return sheet.rules.get(start+':'+col)||null;},
      setValues(vals){if(vals.length!==n)throw new Error('Row count mismatch');vals.forEach((r,i)=>{if(r.length!==w)throw new Error('Width mismatch');r.forEach((x,j)=>store(start+i,col+j,x));});},
      setValue(value){if(n!==1||w!==1)throw new Error('setValue range mismatch');store(start,col,value);},
      clearDataValidations(){for(let i=0;i<n;i++)for(let j=0;j<w;j++)sheet.rules.delete((start+i)+':'+(col+j));},
      setNumberFormat(format){sheet.lastNumberFormat=format;},
      setDataValidation(rule){for(let i=0;i<n;i++)for(let j=0;j<w;j++)sheet.rules.set((start+i)+':'+(col+j),rule);}
    };
  }
}
const defaults=[
 ['01','ERP/시스템 미구축'],['02','도입 품목 미연동'],['03','전산/데이터 오류'],
 ['04','거래처 연동 거부/미협조'],['05','도매몰 미연동'],
 ['06','신규 거래처 연동 예정'],['07','당월 매출 미발생']
];
const masterRows=[['key','businessNo','priority','businessName','outlet','manager','aging','reason','plan','due','status','editor','time',...Array(7).fill('')]];
for(let i=2;i<=140;i++)masterRows.push(['백제약품 대전|||'+i,String(i),'P2','도도매 '+i,'백제약품 대전','정직한','2M','','','','','','',...Array(7).fill('')]);
masterRows[30][7]='이전 버전 사용자 정의 원인';
masterRows[109][7]='08 도매몰 연동 필요';
const sheet=new MockSheet('Action Board',masterRows);
const cfg=new MockSheet('Config',[['code','label'],...defaults],2);
const history=new MockSheet('History',[['eventId','key','업체/권역','사업자번호','실사업자명','담당자','변경필드','이전값','변경값','수정자','수정시간']],11);
const dashboard=new MockSheet('Dashboard Data',[['month','outlet','manager','businessNo','businessName','대웅제약','대웅바이오','한올바이오','savedAt'],['2026-09','백제약품 대전','정직한','31','도도매 31','X','X','','']],9);
const sheets=new Map([['Action Board',sheet],['Config',cfg],['History',history],['Dashboard Data',dashboard]]);
const ss={getSheetByName:n=>sheets.get(n)||null,insertSheet:n=>{const x=new MockSheet(n,[],21);sheets.set(n,x);return x;}};
for(let i=2;i<=140;i++)sheet.rules.set(i+':8',{options:defaults.map(x=>x.join(' ')),allowInvalid:false});
sheet.rules.set('110:8',{options:[...defaults.map(x=>x.join(' ')),'08 도매몰 미연동'],allowInvalid:false,
  getAllowInvalid(){return false;},getCriteriaValues(){return [this.options,true];}});
const scriptProps=new Map();
const context={
  SpreadsheetApp:{openById:()=>ss,newDataValidation:()=>{
    const object={options:[],allowInvalid:false,helpText:''};
    return {requireValueInList(x){object.options=x;return this;},setAllowInvalid(v){object.allowInvalid=v;return this;},
      setHelpText(t){object.helpText=t;return this;},
      build(){const snap={...object};return {...snap,getAllowInvalid(){return snap.allowInvalid;},getCriteriaType(){return 'VALUE_IN_LIST';},getCriteriaValues(){return [snap.options,true];}};}};
  },flush(){}},
  Utilities:{getUuid:()=>String(Math.random()),formatDate:()=>new Date('2026-10-08T10:00:00Z').toISOString(),
    base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),Charset:{UTF_8:'utf8'}},
  LockService:{getScriptLock:()=>({waitLock(){},tryLock(){return true;},releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>scriptProps.get(key)||null,setProperty:(key,value)=>scriptProps.set(key,value)})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:x=>({setMimeType(){return x;}})},
  console
};
vm.createContext(context);vm.runInContext(script,context);
const call=(name,...args)=>context[name](...args);
const initial31=sheet.rows[30][7],initial110=sheet.rows[109][7];
call('saveActions_',[{key:'백제약품 대전|||31',changedFields:['plan'],plan:'Master updated plan'}],'배영훈','edit');
if(sheet.rows[30][7]!==initial31||sheet.rows[30][8]!=='Master updated plan')fail('Plan-only save modified historical H31');
ok('H31 remains untouched when master edits plan');
call('saveActions_',[{key:'백제약품 대전|||110',changedFields:['status'],status:'DONE'}],'정직한','edit');
if(sheet.rows[109][7]!==initial110||sheet.rows[109][10]!=='완료')fail('Status-only save modified H110');
ok('H110 remains untouched when master edits status');
call('saveActions_',[{key:'백제약품 대전|||31',priority:'P1',manager:'정직한'}],'','snapshot');
if(sheet.rows[30][7]!==initial31)fail('Risk snapshot overwrote historical H31');
ok('Risk snapshot writes metadata without touching H');
let rejectEight=false;
try{call('saveActions_',[{key:'백제약품 대전|||50',changedFields:['reasonCode'],reasonCode:'08'}],'정직한','edit');}
catch(_){rejectEight=true;}
if(!rejectEight)fail('Retired reason 08 was incorrectly accepted');
call('saveActions_',[{key:'백제약품 대전|||50',changedFields:['reasonCode'],reasonCode:'05'}],'정직한','edit');
if(sheet.rows[49][7]!=='05 도매몰 미연동')fail('05 must be saved with the new label');
if(sheet.rules.get('31:8').getAllowInvalid?.()===true)fail('Unrelated H31 was rewritten during save');
ok('New reason 05 saved; 08 rejected; unrelated H31 untouched');
const historyBefore=history.getLastRow();
call('savePartnerAction_','백제약품',{key:'백제약품 대전|||31',field:'plan',value:'Partner separate plan'});
if(sheet.rows[30][8]!=='Master updated plan'||sheet.rows[30][14]!=='Partner separate plan')fail('Partner overwrote master data');
if(history.getLastRow()!==historyBefore)fail('Partner save should not alter master history');
const loaded=call('loadPartnerActions_','백제약품').actions.find(x=>x.key==='백제약품 대전|||31');
if(loaded.plan!=='Master updated plan'||loaded.partnerAction.plan!=='Partner separate plan')fail('Both authors are not separately readable');
ok('Partner writes only N:T, master values preserved and both sources readable');
let blocked=false;
try{call('savePartnerAction_','유진약품',{key:'백제약품 대전|||31',field:'plan',value:'other partner attempt'});}
catch(e){blocked=true;}
if(!blocked)fail('Unauthorized cross-partner edit not rejected');
ok('Cross-partner edit rejected by server-side ownership check');

const masterBefore=sheet.rows[30][8],hBefore=sheet.rows[30][7];
const batch=call('savePartnerActionsBatch_','백제약품',[
 {key:'백제약품 대전|||31',field:'plan',value:'batch partner edit'},
 {key:'백제약품 대전|||31',field:'status',value:'DONE'}
]);
if(batch.saved!==2||batch.results.length!==2)fail('Partner batch response length');
if(sheet.rows[30][14]!=='batch partner edit'||sheet.rows[30][16]!=='DONE')fail('Partner batch was not saved to N:T');
if(sheet.rows[30][8]!==masterBefore||sheet.rows[30][7]!==hBefore)fail('Partner batch altered master H/I cells');
ok('Partner batch writes once per key and does not modify master H/M');
let batchBlocked=false;
try{call('savePartnerActionsBatch_','유진약품',[{key:'백제약품 대전|||31',field:'plan',value:'attack'}]);}
catch(_){batchBlocked=true;}
if(!batchBlocked)fail('Batch write skipped partner ownership check');
ok('Partner batch rejects cross-company writes');

const previousProps=context.PropertiesService;
context.PropertiesService={getScriptProperties:()=>({getProperty:k=>k.startsWith('DCM_PARTNER_PASSWORD_')?'test-secret':null})};
const loginJson=JSON.parse(call('doPost',{postData:{contents:JSON.stringify({type:'partnerLogin',partner:'백제약품',password:'test-secret'})}}));
if(!loginJson.ok||!loginJson.partner||loginJson.data||loginJson.actions)fail('Login unnecessarily waits for data and actions');
ok('Partner authentication returns lightweight response without Dashboard or Action data');
context.PropertiesService=previousProps;

const cellValue31=sheet.rows[30][7],cellValue110=sheet.rows[109][7];
for(const row of [31,110,150])sheet.rules.set(row+':8',{options:['01 ERP/시스템 미구축'],allowInvalid:false,getAllowInvalid(){return false;}});
const previousHwriteCount=sheet.writes.filter(w=>w.col===8).length;
const repaired=call('repairActionReasonValidation');
if(!repaired.repaired||!repaired.audit.H31.validSeven||!repaired.audit.H110.validSeven)
  fail('One-time repair did not set seven approved dropdown values');
if(repaired.acceptedCodes.length!==7||repaired.acceptedCodes.includes('08'))fail('Wrong number of reasons');
if(sheet.rows[30][7]!==cellValue31||sheet.rows[109][7]!==cellValue110)
  fail('Validation repair changed historical H values');
if(sheet.writes.filter(w=>w.col===8).length!==previousHwriteCount)fail('Repair rewrote H cell contents');
ok('One-time repair changes only H validation, not historic values');
sheet.rules.set('31:8',{options:['01 ERP/시스템 미구축'],allowInvalid:false,getAllowInvalid(){return false;}});
call('saveActions_',[{key:'백제약품 대전|||31',changedFields:['reasonCode'],reasonCode:'05'}],'정직한','edit');
if(sheet.rows[30][7]!=='05 도매몰 미연동')fail('Single-cell validation fallback failed');
if(sheet.rules.get('110:8').getAllowInvalid()!==true)fail('Single-cell repair modified other H rules');
ok('Saving reason repairs only the affected H31 cell');

const sampleKey='백제약품 대전|||31';
const copy=[...sheet.rows[30]];
sheet.rows.push(copy);
const loadedDedup=call('loadActions_',false);
if(loadedDedup.actions.filter(a=>a.key===sampleKey).length!==1)fail('Duplicate key emitted more than one Action card');
if(!loadedDedup.duplicateKeys.includes(sampleKey))fail('Duplicate anomaly not reported');
ok('Action reads collapse duplicate keys and report anomaly');
let masterBlocked=false;
try{call('saveActions_',[{key:sampleKey,changedFields:['plan'],plan:'should not save'}],'정직한','edit');}
catch(e){masterBlocked=/거래처 키 중복/.test(e.message);}
if(!masterBlocked)fail('Master write did not block pre-existing duplicate keys');
let partnerBlocked=false;
try{call('savePartnerActionsBatch_','백제약품',[{key:sampleKey,field:'plan',value:'should not save'}]);}
catch(e){partnerBlocked=/거래처 키 중복/.test(e.message);}
if(!partnerBlocked)fail('Partner batch did not block duplicate key');
ok('Master and Partner writes reject ambiguous stored keys');
sheet.rows.pop();
const beforeUnique=sheet.getLastRow();
call('saveActions_',[{key:'인천약품|||new-unique',outlet:'인천약품',businessNo:'new-unique',businessName:'New vendor',priority:'P3'},
                      {key:'인천약품|||new-unique',outlet:'인천약품',businessNo:'new-unique',businessName:'New vendor',priority:'P2'}],
'정직한','snapshot');
if(sheet.getLastRow()!==beforeUnique+1)fail('Duplicate items in same snapshot produced multiple rows');
ok('Incoming duplicate snapshot rows are coalesced to one unique key');
const dashboardBefore=JSON.stringify(dashboard.rows);
let duplicateDashboardBlocked=false;
try{
  call('saveDashboardData_',[{
    month:'2026-09',outlet:'인천약품',businessNo:'8818801139',businessName:'수정약품 DD(강동구)',manager:'배영훈',statuses:{'한올바이오':'O'}
  },{
    month:'2026-09',outlet:'인천약품',businessNo:'8818801139',businessName:'수정약품 DD(강동구)',manager:'배영훈',statuses:{'한올바이오':'O'}
  }],'MASTER');
}catch(e){duplicateDashboardBlocked=/중복/.test(e.message);}
if(!duplicateDashboardBlocked||JSON.stringify(dashboard.rows)!==dashboardBefore)
  fail('Duplicate monthly dashboard upload overwrote existing data');
ok('Dashboard duplicate-month key rejected before clearing original data');

const srmRowCountBefore=sheet.getLastRow();
const firstSrm=call('appendSrmEvent_',{
 key:'백제약품 대전|||31',entity:'대웅바이오',eventType:'CONTACT',
 status:'ERP_WAIT',reason:'03',contactTarget:'ERP 업체',erpVendor:'테스트 ERP',
 detail:'전산 연동 점검 협의',nextAction:'재시험',owner:'정직한',dueDate:'2026-10-20',
 baselineMonth:'2026-06',requestId:'srm-test-unique-001'
},'partner','백제약품');
if(!firstSrm.saved)fail('SRM append failed');
if(sheet.getLastRow()!==srmRowCountBefore)fail('SRM event wrote Action Board');
const srmSheet=sheets.get('SRM Events');
if(!srmSheet||srmSheet.getLastRow()!==2)fail('Append-only SRM sheet not created');
const retry=call('appendSrmEvent_',{
 key:'백제약품 대전|||31',entity:'대웅바이오',eventType:'CONTACT',
 status:'ERP_WAIT',detail:'retry',requestId:'srm-test-unique-001'
},'partner','백제약품');
if(!retry.duplicate||srmSheet.getLastRow()!==2)fail('SRM idempotent retry generated duplicate row');
let foreignBlocked=false;
try{call('appendSrmEvent_',{
 key:'백제약품 대전|||31',entity:'대웅바이오',eventType:'CONTACT',
 status:'OPEN',detail:'unauthorized',requestId:'srm-test-unique-002'
},'partner','인천약품');}catch(_){foreignBlocked=true;}
if(!foreignBlocked)fail('Partner cross-tenant event append allowed');
const partnerRead=call('loadSrmEvents_','백제약품');
if(partnerRead.events.length!==1||call('loadSrmEvents_','인천약품').events.length!==0)
 fail('SRM partner read leaked another partner’s events');
let falseVerifiedBlocked=false;
try{call('appendSrmEvent_',{
 key:'백제약품 대전|||31',entity:'대웅제약',eventType:'VERIFICATION',
 status:'VERIFIED',detail:'manual complete',baselineMonth:'2026-06',requestId:'srm-test-unique-003'
},'master','');}catch(e){falseVerifiedBlocked=/검증 실패/.test(e.message);}
if(!falseVerifiedBlocked)fail('SRM verified without historical X to current O');
dashboard.rows.push(['2026-06','백제약품 대전','정직한','31','도도매 31','X','X','X','']);
dashboard.rows[1][5]='O';
const verified=call('appendSrmEvent_',{
 key:'백제약품 대전|||31',entity:'대웅제약',eventType:'VERIFICATION',
 status:'VERIFIED',detail:'X→O 전환 확인',baselineMonth:'2026-06',requestId:'srm-test-unique-004'
},'master','');
if(!verified.saved||verified.result!=='X→O 확인')fail('Observed X-to-O transition not accepted');
if(call('loadSrmEvents_','').events.length!==2)fail('SRM append-only history incomplete');
ok('SRM append-only events, partner boundaries, idempotent retry and evidence-backed X-to-O verification');

scriptProps.set('DCM_EDITOR_PIN_BAE','bae-secret-1234');
scriptProps.set('DCM_EDITOR_PIN_JEONG','jeong-secret-1234');
scriptProps.set('DCM_EDITOR_PIN_LIM','lim-secret-1234');
scriptProps.set('DCM_MASTER_PASSWORD','master-only-test');
dashboard.rows.push(
 ['2026-09','기타 대리점','배영훈','B','Owner B','X','','',''],
 ['2026-09','기타 대리점','임인숙','L','Owner L','X','','','']
);
const edits=[
 {key:'백제약품 대전|||31'}, {key:'기타 대리점|||B'}, {key:'기타 대리점|||L'}
];
call('assertActionEditorAccess_','배영훈','bae-secret-1234',edits);
call('assertActionEditorAccess_','배영훈','',edits,'master-only-test');
call('assertActionEditorAccess_','정직한','jeong-secret-1234',[edits[0]]);
call('assertActionEditorAccess_','임인숙','lim-secret-1234',[edits[2]]);
const accessMustFail=(editor,pin,list,masterPassword)=>{
 let blocked=false;
 try{call('assertActionEditorAccess_',editor,pin,list,masterPassword);}catch(_){blocked=true;}
 if(!blocked)fail('Master Sync unauthorized write allowed for '+editor+'/'+list.map(x=>x.key).join(','));
};
accessMustFail('정직한','jeong-secret-1234',[edits[1]]);
accessMustFail('임인숙','lim-secret-1234',[edits[0]]);
accessMustFail('정직한','',[edits[0]]);
accessMustFail('정직한','invalid-pin',[edits[0]]);
accessMustFail('정직한','',[edits[0]],'master-only-test');
accessMustFail('배영훈','',[edits[0]]);
accessMustFail('배영훈','bae-secret-1234',[{key:'임의 권역|||없는 번호'}]);
if(!script.includes("if(mode==='edit')assertActionEditorAccess_"))
 fail('Action edit route no longer enforces per-user ownership');
ok('Master Sync server permissions: Bae full access, Jeong/Lim own only, PIN and master auth, no unknown merchant');

console.log('GAS_REGRESSION_OK');
