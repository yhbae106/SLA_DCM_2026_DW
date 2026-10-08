import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync('apps-script/Code.gs','utf8');
const fail=message=>{throw new Error('Apps Script regression: '+message)};
const ok=message=>console.log('PASS GAS',message);

class MockSheet {
  constructor(name,rows=[],columns=20){this.name=name;this.rows=rows.map(r=>[...r]);this.columns=columns;this.rules=new Map();this.writes=[];}
  getLastRow(){return this.rows.length;}
  getMaxColumns(){return this.columns;}
  insertColumnsAfter(col,count){this.columns+=count;}
  hideSheet(){}
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
      setValues(vals){if(vals.length!==n)throw new Error('Row count mismatch');vals.forEach((r,i)=>{if(r.length!==w)throw new Error('Width mismatch');r.forEach((x,j)=>store(start+i,col+j,x));});},
      setValue(value){if(n!==1||w!==1)throw new Error('setValue range mismatch');store(start,col,value);},
      clearDataValidations(){for(let i=0;i<n;i++)for(let j=0;j<w;j++)sheet.rules.delete((start+i)+':'+(col+j));},
      setDataValidation(rule){for(let i=0;i<n;i++)for(let j=0;j<w;j++)sheet.rules.set((start+i)+':'+(col+j),rule);}
    };
  }
}
const defaults=[
 ['01','ERP/시스템 미구축'],['02','도입 품목 미연동'],['03','전산/데이터 오류'],
 ['04','거래처 연동 거부/미협조'],['05','공급·거래 중단 예정'],
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
const ss={getSheetByName:n=>sheets.get(n)||null,insertSheet:n=>{const x=new MockSheet(n);sheets.set(n,x);return x;}};
for(let i=2;i<=140;i++)sheet.rules.set(i+':8',{options:defaults.map(x=>x.join(' ')),allowInvalid:false});
const context={
  SpreadsheetApp:{openById:()=>ss,newDataValidation:()=>{
    const object={options:[],allowInvalid:false};
    return {requireValueInList(x){object.options=x;return this;},setAllowInvalid(v){object.allowInvalid=v;return this;},build(){return {...object}}};
  },flush(){}},
  Utilities:{getUuid:()=>String(Math.random()),formatDate:()=>new Date('2026-10-08T10:00:00Z').toISOString(),
    base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),Charset:{UTF_8:'utf8'}},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
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
call('saveActions_',[{key:'백제약품 대전|||50',changedFields:['reasonCode'],reasonCode:'08'}],'정직한','edit');
if(sheet.rows[49][7]!=='08 도매몰 연동 필요')fail('Reason 08 could not be saved');
if(!cfg.rows.some(r=>r[0]==='08'))fail('Code 08 not added to sheet config');
if(sheet.rules.get('31:8').allowInvalid!==true)fail('Historical H rules still strict');
ok('Reason 08 accepted, Config aligned, legacy H validation relaxed');
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
console.log('GAS_REGRESSION_OK');
