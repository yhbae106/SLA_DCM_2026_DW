import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('action-sync.js','utf8');
const start=source.indexOf('async function checkRevision()');
const end=source.indexOf('\nfunction ',start+1);
let now=100000,calls=0,pulls=0,resolve,reject;
const env={navigator:{onLine:true},document:{visibilityState:'visible',activeElement:null},console:{warn(){}},Date:{now:()=>now},post:()=>{calls++;return new Promise((a,b)=>{resolve=a;reject=b;});},pullRemote:async()=>{pulls++;}};
vm.createContext(env);
vm.runInContext(`let revisionRetryAt=0,revisionFailures=0,revisionSupported=true;let signedIn=true,serverReady=true,revisionBusy=false,authGeneration=0,lastRevision='same';const REQUIRED_API_VERSION='test',hasReadAuth=()=>true,isEditing=()=>false;

${source.slice(start,end)}
this.check=checkRevision;`,env);
const first=env.check();await env.check();assert.equal(calls,1,'coalesce in-flight revision checks');
reject(new Error('network'));await first;await env.check();assert.equal(calls,1,'backoff suppresses retries');
now+=30000;const retry=env.check();assert.equal(calls,2);resolve({version:'test',revision:'same'});await retry;assert.equal(pulls,0,'unchanged revision avoids full download');
env.navigator.onLine=false;await env.check();assert.equal(calls,2,'offline skips automatic requests');
env.navigator.onLine=true;env.document.visibilityState='hidden';await env.check();assert.equal(calls,2,'hidden skips automatic requests');
env.document.visibilityState='visible';const changed=env.check();resolve({version:'test',revision:'new'});await changed;assert.equal(pulls,1,'changed revision refreshes data');
console.log('PASS polling: coalescing, bounded retry, offline/hidden suppression and revision-only refresh');
