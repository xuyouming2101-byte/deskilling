import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

test('AI-ON isolated database: password roster through P100, S1 routing and OFF-only later sessions', { timeout: 300000 }, async () => {
  const db = process.env.AION_TEST_DATABASE;
  assert.match(db ?? '', /^deskilling_aion_[0-9a-f]{16}$/);
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.pathname, '/' + db);
  assert.equal(url.username, 'deskilling_app');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  assert.deepEqual((await client.query('SELECT current_database() db, current_user role')).rows[0], { db, role: 'deskilling_app' });
  await client.end();
  for (const key of Object.keys(process.env)) if (key.includes('SUPABASE')) delete process.env[key];
  delete process.env.ASSESSMENT_DEPLOYMENT_MODE;
  process.env.STUDY_SHARED_PASSWORD = randomBytes(24).toString('hex');
  process.env.FORMAL_VIDEO_SIGNING_SECRET = randomBytes(32).toString('hex');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail('No external service allowed');
  const originalConnect = Socket.prototype.connect;
  Socket.prototype.connect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const host = typeof normalized[0] === 'object' ? normalized[0]?.host : normalized[1];
    if (typeof host === 'string') assert.ok(['127.0.0.1','::1','localhost'].includes(host), 'Only loopback PostgreSQL allowed');
    return originalConnect.apply(this, args);
  };
  function inspect(sql) {
    assert.match(db, /^deskilling_aion_[0-9a-f]{16}$/);
    return execFileSync('runuser',['-u','postgres','--','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d',db,'-c',sql], { encoding:'utf8', cwd:'/tmp' }).trim();
  }
  const read = sql => JSON.parse(inspect(sql));
  const schedule = id => read(`SELECT json_agg(json_build_object('s',session_number,'opens',opens_at) ORDER BY session_number) FROM public.participant_session_schedule WHERE participant_id='${id}'`);
  const cohorts = [['P20','off'],['P21','on'],['P40','on'],['P41','off'],['P60','off'],['P61','on'],['P99','on'],['P100','on']];
  const ids = cohorts.map(([id])=>id);
  const excluded = ids.map(id=>`'${id}'`).join(',');
  const researchHash = () => inspect(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM (SELECT 'q' k,to_jsonb(q) r FROM public.assessment_queue q WHERE participant_id NOT IN (${excluded}) UNION ALL SELECT 'r',to_jsonb(r) FROM public.responses r WHERE participant_id NOT IN (${excluded}) UNION ALL SELECT 'e',to_jsonb(e) FROM public.lesion_detection_events e WHERE participant_id NOT IN (${excluded}) UNION ALL SELECT 's',to_jsonb(s) FROM public.participant_session_schedule s WHERE participant_id NOT IN (${excluded})) t`);
  const originalResearch = researchHash();
  const originalQueues = {};
  const originalSchedules = {};
  for (const id of ids) {
    originalQueues[id] = read(`SELECT coalesce(json_agg(json_build_object('video_id',video_id,'video_order',video_order) ORDER BY video_order),'[]') FROM public.assessment_queue WHERE participant_id='${id}' AND session_number=1`);
    originalSchedules[id] = schedule(id);
    if (['P61','P99','P100'].includes(id)) {
      assert.equal(originalQueues[id].length,0);
      assert.ok(originalSchedules[id].every(r=>r.opens === null));
    } else assert.ok([0,40].includes(originalQueues[id].length));
  }
  const password = (await import('../app/api/online-password/route.ts')).POST;
  const start = (await import('../app/api/assessment-session/route.ts')).POST;
  const submit = (await import('../app/api/assessment-submit/route.ts')).POST;
  const authorize = (await import('../app/api/formal-video-url/route.ts')).POST;
  const video = (await import('../app/api/formal-video/route.ts')).GET;
  let cookie='';
  const call = (handler, body, sessionCookie = cookie) => handler(new Request('http://127.0.0.1/api/test', { method:'POST', headers:{'content-type':'application/json',cookie:sessionCookie}, body:JSON.stringify(body) }));
  async function login(id) {
    const response = await call(password,{participant_id:id,session_number:1,password:'deskilling'+id});
    assert.equal(response.status,200); cookie=response.headers.get('set-cookie').split(';')[0];
  }
  const passed=[];
  async function step(name,fn) { await fn(); passed.push(name); console.log('PASS: '+name); }
  try {
    await step('all cohort boundaries reject missing/wrong passwords without changing Day 0',async()=>{
      for (const id of ids) {
        for (const session_number of [1,2,3]) for(const supplied of [undefined,'','wrong']) {
          assert.equal((await call(password,{participant_id:id,session_number,password:supplied})).status,401);
        }
        assert.deepEqual(schedule(id),originalSchedules[id]);
      }
      assert.equal((await call(password,{participant_id:'P101',session_number:1,password:'deskillingP101'})).status,401);
      const r=await call(password,{participant_id:'P61',session_number:1,password:process.env.STUDY_SHARED_PASSWORD});
      assert.equal(r.status,200);assert.equal((await r.json()).master,true);
      assert.ok(schedule('P61').every(r=>r.opens===null));
    });
    const queues={};
    await step('old cohort boundaries and P61/P99/P100: 40 persisted correctly routed videos each',async()=>{
      for (const [id,condition] of cohorts) {
        await login(id);
        const body={participant_id:id,session_number:1};
        const r=await call(start,body);assert.equal(r.status,200);
        const rows=(await r.json()).data;queues[id]=rows;
        assert.equal(rows.length,40);assert.equal(new Set(rows.map(v=>v.video_id)).size,40);
        assert.deepEqual(rows.map(v=>v.video_order),Array.from({length:40},(_,i)=>i+1));
        assert.ok(rows.every(v=>v.video_id.startsWith(condition==='on'?'AION_T1_':'T1_')));
        assert.deepEqual((await (await call(start,body)).json()).data,rows);
        if (originalQueues[id].length) assert.deepEqual(rows.map(({video_id,video_order})=>({video_id,video_order})),originalQueues[id]);
        if (originalSchedules[id][0].opens!==null) assert.deepEqual(schedule(id),originalSchedules[id]);
        assert.equal(inspect(`SELECT count(*) FROM public.assessment_queue q JOIN public.videos v USING(video_id) WHERE q.participant_id='${id}' AND v.ai_condition='${condition}'`),'40');
        const dates=schedule(id);await login(id);assert.deepEqual(schedule(id),dates);
        assert.equal(Date.parse(dates[1].opens)-Date.parse(dates[0].opens),14*86400000);
        assert.equal(Date.parse(dates[2].opens)-Date.parse(dates[0].opens),28*86400000);
        for (const session_number of [2,3]) assert.equal((await call(password,{participant_id:id,session_number,password:'deskilling'+id})).status,403);
      }
    });
    await login('P61');
    const body={participant_id:'P61',session_number:1};
    await step('Day 0 is stable on retry; Session2/3 retain password and day 14/28 boundaries',async()=>{
      const before=schedule('P61');await login('P61');assert.deepEqual(schedule('P61'),before);
      assert.equal(Date.parse(before[1].opens)-Date.parse(before[0].opens),14*86400000);
      assert.equal(Date.parse(before[2].opens)-Date.parse(before[0].opens),28*86400000);
      for(const session_number of [2,3]) {
        assert.equal((await call(password,{...body,session_number,password:'deskillingP61'})).status,403);
        assert.equal((await call(start,{...body,session_number})).status,403);
      }
      assert.deepEqual(schedule('P61'),before);
    });
    await step('bound cookie and current order authorize AI-ON HMAC/X-Accel path only',async()=>{
      assert.equal((await call(start,body,'')).status,403);
      assert.equal((await call(start,{...body,participant_id:'P20'})).status,403);
      assert.equal((await call(authorize,{...body,video_order:2})).status,403);
      const r=await call(authorize,{...body,video_order:1});assert.equal(r.status,200);
      const signed=(await r.json()).signed_url;
      const url=new URL(signed,'http://127.0.0.1');assert.match(url.searchParams.get('path'),/^Test1\/AION\/videos\/[0-9]{2}_ai\.mp4$/);
      const streamed=await video(new Request(url));assert.equal(streamed.status,200);
      assert.equal(streamed.headers.get('x-accel-redirect'),'/_formal_video/'+url.searchParams.get('path'));
      url.searchParams.set('path','Test1/AION/videos/41_ai.mp4');assert.equal((await video(new Request(url))).status,403);
    });
    const yes={...body,video_id:queues.P61[0].video_id,video_order:1,final_answer:true,response_time_ms:1234,no_response_latency_ms:null,video_completed:true,clicks:[{click_index:1,video_time_at_click:12.345,response_time_ms:1234},{click_index:2,video_time_at_click:1.234,response_time_ms:1500}]};
    const no={...body,video_id:queues.P61[1].video_id,video_order:2,final_answer:false,response_time_ms:3000,no_response_latency_ms:40,video_completed:true,clicks:[]};
    await step('atomic marks/negative submission, exact retry, differing retry rejection and resume',async()=>{
      for(const payload of [yes,no,yes,no]) {const r=await call(submit,payload);assert.equal(r.status,200);assert.equal((await r.json()).saved,true);}
      assert.equal((await call(submit,{...no,response_time_ms:3001})).status,400);
      assert.equal(inspect("SELECT count(*) FROM public.responses WHERE participant_id='P61'"),'2');
      const marks=read("SELECT json_agg(json_build_object('time',video_time_at_click,'valid',final_valid,'overridden',overridden,'latency',detection_latency_ms) ORDER BY click_index) FROM public.lesion_detection_events WHERE participant_id='P61'");
      assert.deepEqual(marks,[{time:12.345,valid:true,overridden:false,latency:null},{time:1.234,valid:true,overridden:false,latency:null}]);
      assert.equal(inspect("SELECT count(*) FROM public.responses WHERE participant_id='P61' AND video_order=2 AND NOT answer AND video_time_at_click IS NULL AND detection_latency_ms IS NULL AND no_response_latency_ms=40"),'1');
      const resumed=(await (await call(start,body)).json()).data;assert.equal(resumed[0].next_video_order,3);
      assert.deepEqual(resumed.map(r=>r.video_id),queues.P61.map(r=>r.video_id));
    });
    await step('failed response transaction leaves no marks and no progress',async()=>{
      inspect("CREATE FUNCTION public.aion_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER aion_test_fail BEFORE INSERT ON public.responses FOR EACH ROW EXECUTE FUNCTION public.aion_test_fail();");
      const failed=await call(submit,{...yes,video_id:queues.P61[2].video_id,video_order:3});
      assert.equal(failed.status,400);assert.notEqual((await failed.json()).saved,true);
      assert.equal(inspect("SELECT count(*) FROM public.lesion_detection_events WHERE participant_id='P61'"),'2');
      assert.equal((await (await call(start,body)).json()).data[0].next_video_order,3);
      inspect('DROP TRIGGER aion_test_fail ON public.responses; DROP FUNCTION public.aion_test_fail();');
    });
    await step('completion locks playback while identical retry remains idempotent',async()=>{
      for(let i=2;i<40;i++) assert.equal((await call(submit,{...no,video_id:queues.P61[i].video_id,video_order:i+1})).status,200);
      assert.equal((await (await call(start,body)).json()).data[0].next_video_order,41);
      assert.equal((await call(authorize,{...body,video_order:40})).status,403);
      await login('P61');assert.equal((await (await call(start,body)).json()).data[0].next_video_order,41);
    });
    await step('every P01-P100 Session2/3 excludes ON distractors and keeps exactly 40 OFF videos',async()=>{
      inspect("INSERT INTO public.videos(video_id,file_path,bucket,has_lesion,type,ai_condition,session_pool,is_test) SELECT 'AION_TEST_S'||s||'_'||n,'Test'||s||'/videos/T'||s||'_'||lpad(n::text,3,'0')||'.mp4','FORMAL_ECS',false,'no_lesion',CASE WHEN n<=40 THEN 'off' ELSE 'on' END,s,false FROM generate_series(2,3) s CROSS JOIN generate_series(1,80) n;");
      const probe=new pg.Client({connectionString:url.toString()});await probe.connect();
      try {
        for(let n=1;n<=100;n++) for(const session of [2,3]) {
          await probe.query('BEGIN');
          const id=`P${String(n).padStart(2,'0')}`;
          const rows=(await probe.query('SELECT * FROM public.start_or_resume_assessment($1::text,$2::integer)',[id,session])).rows;
          assert.equal(rows.length,40);
          assert.ok(rows.every(r=>Number(r.video_id.split('_').at(-1))<=40));
          assert.deepEqual((await probe.query('SELECT * FROM public.start_or_resume_assessment($1::text,$2::integer)',[id,session])).rows,rows);
          await probe.query('ROLLBACK');
        }
      } finally {await probe.end();}
      const before=schedule('P61');
      for(const session_number of [2,3]) {
        const r=await call(password,{...body,session_number,password:process.env.STUDY_SHARED_PASSWORD});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
        const rows=(await (await call(start,{...body,session_number})).json()).data;
        assert.equal(rows.length,40);assert.ok(rows.every(r=>r.video_id.startsWith('AION_TEST_S'+session_number+'_')));
        assert.ok(rows.every(r=>Number(r.video_id.split('_').at(-1))<=40));
        assert.deepEqual((await (await call(start,{...body,session_number})).json()).data,rows);
      }
      assert.deepEqual(schedule('P61'),before);
    });
    await step('existing research including P58/P59 unchanged; raw gold standard inaccessible',async()=>{
      assert.equal(researchHash(),originalResearch);
      assert.equal(inspect("SELECT has_table_privilege('deskilling_app','public.video_lesions','SELECT,INSERT,UPDATE,DELETE')"),'f');
    });
    console.log(JSON.stringify({ result:'PASS',test_database:db,role:'deskilling_app',checks:passed.length,supabase_calls:0 }));
  } finally { globalThis.fetch=originalFetch;Socket.prototype.connect=originalConnect; }
});
