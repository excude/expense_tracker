importScripts('./vendor/sql-wasm.js');
self.onmessage = async ({data}) => {
 let db;
 try {
  const SQL=await initSqlJs({locateFile:file=>new URL('./vendor/'+file,self.location.href).href}); db=new SQL.Database(new Uint8Array(data));
  const query=sql=>{const statement=db.prepare(sql), rows=[];try{while(statement.step())rows.push(statement.getAsObject());return rows;}finally{statement.free();}};
  const tags=query('SELECT * FROM TABLE_CARDTAGS');
  const names=new Map(tags.map(c=>[c._id,(c.nickname||c.card_name||'카드')+(c.card_no?' · '+String(c.card_no).slice(-4):'')]));
  const records=query('SELECT * FROM TABLE_RECEIPT WHERE type IN (1,2) AND hide=0 ORDER BY ymd DESC,time DESC,_id DESC').map(r=>({id:r._id,cardId:r.ref_id,card:names.get(r.ref_id)||r.nick||r.cname||'카드',date:String(r.ymd||''),time:String(r.time||''),amount:r.status==='취소'?-Math.abs(Number(r.paid)):Number(r.paid),store:r.storenew||r.store||'',status:r.status||'',installments:Number(r.div_month)||0}));
  if(records.some(r=>!Number.isFinite(r.amount)))throw Error('금액 형식이 올바르지 않습니다.');
  const groups=new Map(tags.map(c=>[c._id,String(c.card_name||'미분류')]));
  const cards=[...new Map(records.map(r=>[r.cardId,{id:r.cardId,name:r.card,category:groups.get(r.cardId)||'미분류'}])).values()];
  self.postMessage({records,cards,latestMonth:records[0]?.date.slice(0,7)||''});
 }catch(e){self.postMessage({error:'체리피커 백업을 읽을 수 없습니다. '+e.message});}finally{db?.close();}
};
