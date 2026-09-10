(()=>{
'use strict';
const E=['대웅제약','대웅바이오','한올바이오'];
const $=id=>document.getElementById(id);
function norm(v){return window.DCMLogic?.normStatus?window.DCMLogic.normStatus(v):String(v??'').trim().toUpperCase();}
function currentPartner(){return $('partner')?.value||'백제약품';}
function dataKey(){return `dcm-partner-v1-data::${currentPartner()}`;}
function loadData(){try{const x=JSON.parse(localStorage.getItem(dataKey()));return Array.isArray(x)?x:[];}catch(e){return [];}}
function saveData(rows){localStorage.setItem(dataKey(),JSON.stringify(rows));}
function bizNo(v){if(v==null)return '';const s=String(v).trim();return s.replace(/\.0$/,'').replace(/\D/g,'')||s;}
function entityName(v){const s=String(v??'').replace(/\s/g,'');if(s.includes('한올'))return '한올바이오';if(s.includes('대웅바이오'))return '대웅바이오';if(s.includes('대웅제약'))return '대웅제약';return null;}
function normalizeOutlet(v){const s=String(v??'').trim();if(!s)return '';if(s.includes('원주'))return '백제약품 원주';if(s.includes('영남'))return '백제약품 영남';if(s.includes('대전'))return '백제약품 대전';if(s.includes('영등포'))return '백제약품 영등포';if(s.includes('인천'))return '인천약품';if(s.includes('복산'))return '복산나이스';if(s.includes('유진'))return '유진약품';if(s.includes('아이팜')||s.includes('동보약품'))return '아이팜코리아';return s;}
function fileYear(name){const s=String(name??'');let m=s.match(/(?:^|\D)(20\d{2})[-_. ]?(\d{1,2})(?:\D|$)/);if(m)return Number(m[1]);m=s.match(/(?:^|\D)(\d{2})(\d{2})(?:\D|$)/);if(m)return 2000+Number(m[1]);return new Date().getFullYear();}
function monthFromText(v,fallbackYear){const s=String(v??'');let m=s.match(/(20\d{2})[-./년\s]*(\d{1,2})(?:월|\D|$)/);if(m){const mm=Number(m[2]);if(mm>=1&&mm<=12)return `${m[1]}-${String(mm).padStart(2,'0')}`;}m=s.match(/(?:^|\D)(\d{1,2})월(?:\D|$)/);if(m){const mm=Number(m[1]);if(mm>=1&&mm<=12)return `${fallbackYear}-${String(mm).padStart(2,'0')}`;}return null;}
function findHeaderRow(aoa,required){for(let r=0;r<Math.min(aoa.length,20);r++){const hdr=aoa[r].map(x=>String(x??'').trim());if(required.every(x=>hdr.includes(x)))return {row:r,idx:Object.fromEntries(hdr.map((x,i)=>[x,i]))};}return null;}
function detectMonth(file,sh,aoa){const y=fileYear(file.name);return monthFromText(file.name,y)||monthFromText(aoa?.[0]?.[0],y)||monthFromText(aoa?.[2]?.[0],y)||monthFromText(sh,y);}
function mergeStatus(rec,e,v){if(!e||!v)return;rec.statuses[e]=(rec.statuses[e]&&rec.statuses[e]!==v)?'X':v;}
function partnerMatches(outlet){const p=currentPartner();if(p==='백제약품')return outlet.startsWith('백제약품');return outlet===p;}
async function parseWorkbook(file){
 if(!window.XLSX)throw new Error('Excel 읽기 라이브러리를 불러오지 못했습니다.');
 const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),out=[];
 wb.SheetNames.forEach(sh=>{
   const aoa=XLSX.utils.sheet_to_json(wb.Sheets[sh],{header:1,defval:null,raw:true});if(!aoa.length)return;
   const month=detectMonth(file,sh,aoa);if(!month)return;
   const newFmt=findHeaderRow(aoa,['회사','도도매명','사업자번호','연동']);
   if(newFmt){
     let outlet=normalizeOutlet(sh||aoa?.[0]?.[0]||file.name);
     const map=new Map();
     aoa.slice(newFmt.row+1).forEach(row=>{
       const b=bizNo(row[newFmt.idx['사업자번호']]);if(!b)return;
       const e=entityName(row[newFmt.idx['회사']]),v=norm(row[newFmt.idx['연동']]);if(!e||!v)return;
       const rowOutlet=normalizeOutlet(row[newFmt.idx['도도매명']]);
       const actualOutlet=partnerMatches(outlet)?outlet:(partnerMatches(rowOutlet)?rowOutlet:outlet);
       if(!partnerMatches(actualOutlet))return;
       if(!map.has(b))map.set(b,{month,outlet:actualOutlet,businessNo:b,businessName:String(row[newFmt.idx['도도매명']]??'').trim(),statuses:{'대웅제약':null,'대웅바이오':null,'한올바이오':null}});
       const rec=map.get(b);if(!rec.businessName)rec.businessName=String(row[newFmt.idx['도도매명']]??'').trim();mergeStatus(rec,e,v);
     });
     out.push(...map.values());return;
   }
   const oldFmt=findHeaderRow(aoa,['도매상명','실사업자번호','실사업자명']);if(!oldFmt)return;
   const map=new Map();
   aoa.slice(oldFmt.row+1).forEach(row=>{
     const b=bizNo(row[oldFmt.idx['실사업자번호']]);if(!b)return;
     const outlet=normalizeOutlet(row[oldFmt.idx['도매상명']]);if(!outlet||!partnerMatches(outlet))return;
     const k=`${month}|||${outlet}|||${b}`;
     if(!map.has(k))map.set(k,{month,outlet,businessNo:b,businessName:String(row[oldFmt.idx['실사업자명']]??'').trim(),statuses:{'대웅제약':null,'대웅바이오':null,'한올바이오':null}});
     const rec=map.get(k);E.forEach(e=>{if(oldFmt.idx[e]==null)return;mergeStatus(rec,e,norm(row[oldFmt.idx[e]]));});
   });
   out.push(...map.values());
 });
 return out;
}
async function handle(files){
 const all=[];for(const f of files)all.push(...await parseWorkbook(f));
 if(!all.length)throw new Error('선택한 파트너사에 해당하는 DCM 데이터를 찾지 못했습니다. 파일 형식과 파트너사 선택을 확인해 주세요.');
 let data=loadData();const pairs=new Set(all.map(r=>`${r.month}|||${r.outlet}`));
 data=data.filter(r=>!pairs.has(`${r.month}|||${r.outlet}`));
 const map=new Map(data.map(r=>[`${r.month}|||${r.outlet}|||${r.businessNo}`,r]));all.forEach(r=>map.set(`${r.month}|||${r.outlet}|||${r.businessNo}`,r));
 saveData([...map.values()]);
 const msg=$('uploadMsg');if(msg)msg.textContent=`업로드 완료: ${all.length.toLocaleString()}처 반영 · 이 데이터는 현재 브라우저에만 저장되며 서버로 전송되지 않습니다.`;
 setTimeout(()=>location.reload(),250);
}
function install(){
 const input=$('fileInput');if(!input||input.dataset.uploadV2==='1')return;input.dataset.uploadV2='1';
 input.addEventListener('change',async e=>{
   e.stopImmediatePropagation();
   const files=[...(e.target.files||[])];if(!files.length)return;
   try{const msg=$('uploadMsg');if(msg)msg.textContent='파일 분석 중...';await handle(files);}catch(err){const msg=$('uploadMsg');if(msg)msg.textContent='업로드 실패';alert(err.message||err);}finally{e.target.value='';}
 },true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
