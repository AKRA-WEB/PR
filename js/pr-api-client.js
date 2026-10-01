/* Trusted PR transport. Persist only per-user draft/request identity, never JWTs. */
(function(root,factory){
    const api=factory();
    if(typeof module==='object' && module.exports) module.exports=api;
    else root.AkraPR=api;
}(typeof window==='undefined'?{}:window,function(){
    'use strict';
    const endpoint='https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/pr-api';
    function can(user,key){
        if(!user?.id)return false;
        const catalog=user.permissionCatalog;
        if(catalog===undefined)return true;
        if(!catalog || typeof catalog!=='object' || Array.isArray(catalog))return false;
        const defined=catalog['app-pr'];
        if(defined===undefined)return true;
        if(!Array.isArray(defined))return false;
        return !defined.includes(key) || (Array.isArray(user.perms?.['app-pr']) && user.perms['app-pr'].includes(key));
    }
    function message(reason){
        if(reason==='permission_denied') return 'ไม่มีสิทธิ์ดำเนินการนี้ กรุณาตรวจสิทธิ์ใน BUYMORETH';
        if(['invalid_or_expired_token','shell_session_unavailable','no_token','identity_required','session_changed'].includes(reason)) return 'กรุณากลับเข้าใช้งานจาก BUYMORETH เพื่อยืนยันเซสชันใหม่';
        if(reason==='legacy_pending_reconciliation_required') return 'มีคำขอค้างที่ยังระบุเจ้าของบัญชีถาวรไม่ได้ กรุณาให้ผู้ดูแลตรวจผลรายการเดิมก่อนส่งใหม่';
        if(reason==='pending_submission_mismatch') return 'มีคำขอที่ยังไม่ทราบผล ห้ามส่งเป็นรายการใหม่ กรุณาใช้ปุ่มกู้คืนคำขอค้างและส่งซ้ำด้วยข้อมูลเดิม';
        if(reason==='pending_storage_unavailable' || reason==='pending_storage_corrupt') return 'เก็บข้อมูลป้องกันการส่งซ้ำไม่ได้ จึงยังไม่ได้ส่งคำขอ กรุณาตรวจพื้นที่จัดเก็บของเบราว์เซอร์';
        if(reason==='idempotency_conflict') return 'รหัสส่งคำขอนี้มีข้อมูลไม่ตรงกับรายการเดิม กรุณาตรวจประวัติและติดต่อผู้ดูแลก่อนส่งใหม่';
        if(reason.startsWith('invalid_pr_')) return 'ข้อมูลคำขอไม่ถูกต้อง กรุณาตรวจชื่อผู้ขอ คลัง จำนวนสินค้า และข้อความในแต่ละรายการ';
        return 'ยังยืนยันผลบันทึกไม่ได้ ข้อมูลและรหัสส่งซ้ำยังเก็บไว้ กรุณาส่งซ้ำด้วยข้อมูลเดิมเมื่อเชื่อมต่อได้';
    }
    function create(options){
        const storage=options.storage;
        const fetcher=options.fetch || fetch;
        const requestId=options.requestId || (()=>crypto.randomUUID());
        function ownerId(){
            const id=options.getIdentityId?.();
            if(typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new Error('identity_required');
            return id;
        }
        function storageKey(key){
            return key+'::identity:'+ownerId();
        }
        function pending(){
            const key=storageKey('PR_PENDING_SUBMISSION');let raw,legacy;
            try{legacy=storage.getItem('PR_PENDING_SUBMISSION::'+encodeURIComponent(String(options.getUserId() || '')));raw=storage.getItem(key);}catch(_){throw new Error('pending_storage_unavailable');}
            if(legacy)throw new Error('legacy_pending_reconciliation_required');
            if(!raw)return null;
            try{
                const value=JSON.parse(raw);
                if(!value.clientRequestId || !value.data || !Array.isArray(value.data.items))throw new Error('invalid');
                return value;
            }catch(_){throw new Error('pending_storage_corrupt');}
        }
        async function call(action,data=null){
            let draft=null,key='';
            try{
                const owner=ownerId();
                const token=options.getToken();
                if(!token)throw new Error('no_token');
                if(action==='createPR'){
                    key=storageKey('PR_PENDING_SUBMISSION');
                    draft=pending();
                    if(draft && JSON.stringify(draft.data)!==JSON.stringify(data))throw new Error('pending_submission_mismatch');
                    if(!draft){
                        draft={clientRequestId:requestId(),data:JSON.parse(JSON.stringify(data))};
                        try{const raw=JSON.stringify(draft);storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('not_persisted');}catch(_){throw new Error('pending_storage_unavailable');}
                    }
                }
                const response=await fetcher(endpoint,{
                    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(20000),
                    body:JSON.stringify({action,token,data:draft?draft.data:data,...(draft?{clientRequestId:draft.clientRequestId}:{})})
                });
                const result=await response.json();
                if(owner!==options.getIdentityId?.() || !options.getToken())throw new Error('session_changed');
                if(!response.ok || result.success!==true){
                    const reason=String(result.reason||'pr_service_unavailable');
                    // A validation rejection is known to have rolled back, so correction is safe.
                    if(draft && response.status===400 && reason.startsWith('invalid_pr_'))storage.removeItem(key);
                    return{success:false,reason,message:message(reason),pending:!!draft};
                }
                if(draft){try{if(JSON.parse(storage.getItem(key)||'null')?.clientRequestId===draft.clientRequestId)storage.removeItem(key);}catch(_){/* Confirmed save remains confirmed; retained ID can replay safely. */}}
                return result;
            }catch(error){
                const reason=String(error?.message || 'pr_service_unavailable');
                return{success:false,reason,message:message(reason),pending:!!draft};
            }
        }
        return Object.freeze({call,pending,storageKey});
    }
    return Object.freeze({create,message,can});
}));
