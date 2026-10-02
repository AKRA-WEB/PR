const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
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

const pendingPayload={requester:'Fixture',warehouse:'W1',items:[
 {sku:'F-1',product:'Fixture product',quantity:'2.5000',unit:'กล่อง',remark:'Fixture remark'},
 {sku:'',product:'Fixture free-text product',quantity:'1',unit:'',remark:''}
]};
function restoreFixture(client){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
 const from=html.indexOf('    function restorePendingPR(ask) {');
 const to=html.indexOf('  </script>',from);
 assert.ok(from>=0&&to>from,'actual pending restoration function exists');
 const control=(initial='')=>{
  let value=String(initial);
  return{get value(){return value;},set value(next){value=String(next);}};
 };
 const rows=[],warehouse=control('W4'),button={hidden:true},notices=[];
 let dirty=0,confirmed=true,confirmations=0,clears=0;
 function addRow(seed={}){
  const fields=Object.fromEntries(['sku','product','qty','unit','remark'].map(key=>[key,control(seed[key]||'')]));
  rows.push({fields,querySelector(selector){
   const match=/^\.p-(sku|product|qty|unit|remark)-input$/.exec(selector);
   assert.ok(match,'only actual row field selectors are supported');return fields[match[1]];
  }});
 }
 addRow({sku:'existing',product:'Existing unsent fixture',qty:'9',unit:'ชิ้น',remark:'Keep unless confirmed'});
 const container={set innerHTML(value){assert.equal(value,'');rows.length=0;clears++;}};
 const nodes={'pr-restore-pending':button,'pr-warehouse':warehouse,'pr-items-container':container};
 const context={
  prClient:()=>client,addEmptyItemRow:()=>addRow(),
  document:{getElementById(id){assert.ok(Object.hasOwn(nodes,id));return nodes[id];},querySelector(selector){assert.equal(selector,'#pr-items-container .item-row:last-child');return rows.at(-1);}},
  window:{AkraModule:{markDirty:()=>dirty++}},
  confirm:()=>{confirmations++;return confirmed;},showNotification:(message,type)=>notices.push({message,type})
 };
 vm.createContext(context);new vm.Script(html.slice(from,to),{filename:'index.html:restorePendingPR'}).runInContext(context);
 const read=()=>({warehouse:warehouse.value,items:rows.map(row=>({sku:row.fields.sku.value,product:row.fields.product.value,quantity:row.fields.qty.value,unit:row.fields.unit.value,remark:row.fields.remark.value}))});
 return{restore:ask=>context.restorePendingPR(ask),read,warehouse,button,notices,
  setConfirmed:value=>{confirmed=value;},counts:()=>({dirty,confirmations,clears})};
}

test('PR actual pending restoration maps all form fields and rebuilt same-owner payload retries only its original request',async()=>{
 const r=fixture();assert.equal((await r.client.call('createPR',pendingPayload)).pending,true);
 const dom=restoreFixture(r.client);dom.restore(false);
 assert.deepEqual(dom.read(),{warehouse:pendingPayload.warehouse,items:pendingPayload.items});
 assert.equal(dom.button.hidden,false);assert.deepEqual(dom.counts(),{dirty:1,confirmations:0,clears:1});
 assert.equal(dom.notices.at(-1).type,'warning');assert.equal(r.requests.length,1,'restoration performs no request');
 dom.warehouse.value='W2';
 const changed=await r.client.call('createPR',{requester:pendingPayload.requester,...dom.read()});
 assert.equal(changed.reason,'pending_submission_mismatch');assert.equal(r.requests.length,1);
 assert.deepEqual(r.client.pending().data,pendingPayload,'warehouse edit retains the original unknown-outcome receipt');
 dom.restore(false);r.setToken('refreshed-token');r.setMode('success');
 const retried=await r.client.call('createPR',{requester:pendingPayload.requester,...dom.read()});
 assert.equal(retried.success,true);assert.equal(r.requests.length,2);
 assert.equal(r.requests[1].body.clientRequestId,r.requests[0].body.clientRequestId);
 assert.deepEqual(r.requests[1].body.data,pendingPayload);assert.equal(r.requests[1].body.token,'refreshed-token');
 assert.equal(r.client.pending(),null);
 const savedForm=dom.read();const savedCounts=dom.counts();dom.restore(false);
 assert.equal(dom.button.hidden,true);assert.deepEqual(dom.read(),savedForm);assert.deepEqual(dom.counts(),savedCounts);
});

test('PR actual pending restoration cannot cross identity or replace current form after declined confirmation',async()=>{
 const r=fixture();assert.equal((await r.client.call('createPR',pendingPayload)).pending,true);
 const dom=restoreFixture(r.client),existing=dom.read();
 r.setUser('other-fixture');dom.restore(false);
 assert.equal(dom.button.hidden,true);assert.deepEqual(dom.read(),existing);
 assert.deepEqual(dom.counts(),{dirty:0,confirmations:0,clears:0});assert.equal(dom.notices.length,0);
 r.setUser('fixture');dom.setConfirmed(false);dom.restore(true);
 assert.equal(dom.button.hidden,false);assert.deepEqual(dom.read(),existing);
 assert.deepEqual(dom.counts(),{dirty:0,confirmations:1,clears:0});
 assert.deepEqual(r.client.pending().data,pendingPayload);
 dom.setConfirmed(true);dom.restore(true);
 assert.deepEqual(dom.read(),{warehouse:pendingPayload.warehouse,items:pendingPayload.items});
 assert.deepEqual(dom.counts(),{dirty:1,confirmations:2,clears:1});
 assert.equal(r.requests.length,1,'identity checks and confirmation never submit');
});
