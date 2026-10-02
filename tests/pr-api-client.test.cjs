const test=require('node:test');
const assert=require('node:assert/strict');
const {create,can}=require('../js/pr-api-client.js');
test('PR UI cache and write capabilities follow explicit grants, never ADMIN bypass',()=>{
 const user={id:'fixture',roles:['ADMIN'],permissionCatalog:{'app-pr':['viewPR','createPR']},perms:{'app-pr':['viewPR']}};
 assert.equal(can(user,'viewPR'),true);assert.equal(can(user,'createPR'),false);
 assert.equal(can({...user,perms:{'app-pr':[]}},'viewPR'),false);
 assert.equal(can({...user,permissionCatalog:null},'viewPR'),false);
 assert.equal(can({id:'fixture'},'viewPR'),true);assert.equal(can(null,'viewPR'),false);
});
function fixture(){
 const values=new Map(),requests=[];let user='fixture',token='fresh-token',mode='timeout';
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const client=create({getUserId:()=>user,getIdentityId:()=>user==='fixture'?'10000000-0000-4000-8000-000000000001':'10000000-0000-4000-8000-000000000002',getToken:()=>token,storage,requestId:()=> 'fixture-request-'+requests.length,fetch:async(url,options)=>{
  requests.push({url,body:JSON.parse(options.body)});
  if(mode==='timeout')throw new Error('network lost');
  return{ok:mode==='success',status:mode==='success'?200:mode==='denied'?403:400,json:async()=>mode==='success'?{success:true,prId:'fixture',prNumber:'PR-20260917-1234'}:{success:false,reason:mode==='denied'?'permission_denied':'invalid_pr_item'}};
 }});
 return{client,storage,values,requests,setUser:value=>user=value,setToken:value=>token=value,setMode:value=>mode=value};
}
const data={requester:'Fixture',warehouse:'W1',items:[{product:'Fixture product',quantity:1}]};
test('PR saves request identity before sending; unknown outcome retries same identity with latest token',async()=>{
 const r=fixture();const result=await r.client.call('createPR',data);assert.equal(result.success,false);assert.equal(result.pending,true);
 assert.equal(r.values.size,1);assert.deepEqual(r.client.pending().data,data);
 r.setToken('refreshed-token');r.setMode('success');const retry=await r.client.call('createPR',data);
 assert.equal(retry.success,true);assert.equal(r.requests[1].body.clientRequestId,r.requests[0].body.clientRequestId);assert.equal(r.requests[1].body.token,'refreshed-token');assert.equal(r.values.size,0);
});
test('PR pending write cannot silently become a new request after editing or switching identity',async()=>{
 const r=fixture();await r.client.call('createPR',data);
 const changed=await r.client.call('createPR',{...data,warehouse:'W2'});assert.equal(changed.reason,'pending_submission_mismatch');assert.equal(r.requests.length,1);
 r.setUser('other-fixture');assert.equal(r.client.pending(),null);assert.equal(r.client.storageKey('CACHE_PR_HIST_DATA'),'CACHE_PR_HIST_DATA::identity:10000000-0000-4000-8000-000000000002');
 r.setUser('fixture');assert.deepEqual(r.client.pending().data,data);
});
test('PR storage failure blocks submission, server validation permits correction, and denial never becomes success',async()=>{
 const r=fixture();r.storage.setItem=()=>{throw new Error('quota');};const full=await r.client.call('createPR',data);assert.equal(full.reason,'pending_storage_unavailable');assert.equal(r.requests.length,0);
 const q=fixture();q.setMode('invalid');const invalid=await q.client.call('createPR',data);assert.equal(invalid.success,false);assert.equal(q.client.pending(),null);
 q.setMode('denied');const denied=await q.client.call('createPR',data);assert.equal(denied.success,false);assert.equal(denied.reason,'permission_denied');assert.match(denied.message,/BUYMORETH/);
});
