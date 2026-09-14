import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Socket } from 'node:net';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

test('Checkpoint B: real restricted pg driver + same-origin formal HTTP flow', { timeout: 180000 }, async () => {
  const db = process.env.CHECKPOINT_B_TEST_DATABASE;
  assert.ok(/^deskilling_b_[0-9a-f]{16}$/.test(db ?? ''), 'Requires registered isolated B test database');
  const parsed = new URL(process.env.DATABASE_URL);
  assert.ok(parsed.pathname === '/' + db && parsed.username === 'deskilling_app', 'Wrong integration DB or role');
  for (const key of Object.keys(process.env)) if (key.includes('SUPABASE')) delete process.env[key];
  process.env.STUDY_SHARED_PASSWORD = randomBytes(24).toString('hex');
  process.env.FORMAL_VIDEO_SIGNING_SECRET = randomBytes(32).toString('hex');
  delete process.env.ASSESSMENT_DEPLOYMENT_MODE;
  const guard = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await guard.connect();
  const identity = (await guard.query('SELECT current_database() AS db, current_user AS role')).rows[0];
  assert.deepEqual(identity, { db, role: 'deskilling_app' });
  await guard.end();

  function inspect(sql) {
    // Observer is separate from the application connection, always pinned to this test copy.
    assert.ok(/^deskilling_b_[0-9a-f]{16}$/.test(db));
    return execFileSync('runuser', ['-u','postgres','--','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d',db,'-c',sql], { cwd: '/tmp', encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c timezone=UTC' } }).trim();
  }
  const read = sql => JSON.parse(inspect(sql));
  const schedule = () => read("SELECT json_agg(json_build_object('s',session_number,'opens',opens_at) ORDER BY session_number) FROM public.participant_session_schedule WHERE participant_id='P60'");
  const counts = () => read("SELECT json_build_object('queue',(SELECT count(*) FROM public.assessment_queue),'responses',(SELECT count(*) FROM public.responses),'events',(SELECT count(*) FROM public.lesion_detection_events))");
  assert.deepEqual(counts(), { queue: 0, responses: 0, events: 0 });
  assert.ok(schedule().every(r => r.opens === null));

  const violations = [];
  const originalConnect = Socket.prototype.connect;
  Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0]) ? args[0] : args;
    const host = typeof options[0] === 'object' ? options[0]?.host : options[1];
    if (typeof host === 'string' && !['127.0.0.1','::1','localhost'].includes(host)) {
      violations.push('non-loopback socket'); throw new Error('Outbound network denied in integration process');
    }
    return originalConnect.apply(this, args);
  };
  const handlers = {
    '/api/online-password': (await import('../app/api/online-password/route.ts')).POST,
    '/api/assessment-session': (await import('../app/api/assessment-session/route.ts')).POST,
    '/api/assessment-submit': (await import('../app/api/assessment-submit/route.ts')).POST,
    '/api/formal-video-url': (await import('../app/api/formal-video-url/route.ts')).POST
  };
  const client = await import('../lib/assessmentClient.ts');
  let cookie = '';
  let origin;
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const handler = handlers[req.url];
      assert.ok(handler, 'Unexpected route');
      const response = await handler(new Request(origin + req.url, { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch { res.writeHead(500); res.end('Integration request failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), origin);
    if (url.origin !== origin) { violations.push('non-loopback fetch'); throw new Error('External fetch denied'); }
    requests.push(url.pathname);
    const headers = new Headers(init.headers);
    if (!headers.has('cookie') && cookie) headers.set('cookie', cookie);
    const response = await originalFetch(url, { ...init, headers });
    const issued = response.headers.get('set-cookie');
    if (issued) cookie = issued.split(';')[0];
    return response;
  };
  const passed = [];
  async function step(name, action) { await action(); passed.push(name); console.log('PASS: ' + name); }
  const body = { participant_id: 'P60', session_number: 1 };
  const post = (path, value, headers) => fetch(path, { method: 'POST', headers: { 'content-type':'application/json', ...headers }, body: JSON.stringify(value) });
  let first, positive, negative, initialSchedule, queueOrder;
  try {
    await step('wrong password and master leave schedule unchanged', async () => {
      const before = schedule();
      assert.equal((await post('/api/online-password', { ...body, password: 'wrong' })).status, 401);
      assert.deepEqual(schedule(), before);
      const master = await post('/api/online-password', { ...body, session_number: 3, password: process.env.STUDY_SHARED_PASSWORD });
      assert.equal(master.status, 200); assert.equal((await master.json()).master, true);
      assert.deepEqual(schedule(), before); assert.deepEqual(counts(), { queue: 0, responses: 0, events: 0 });
    });
    await step('ordinary S1 sets Day 0 once and exact 14/28-day schedule', async () => {
      assert.equal((await post('/api/online-password', { ...body, password: 'deskillingP60' })).status, 200);
      initialSchedule = schedule(); assert.ok(initialSchedule.every(r => r.opens !== null));
      assert.equal(Date.parse(initialSchedule[1].opens)-Date.parse(initialSchedule[0].opens),14*86400000);
      assert.equal(Date.parse(initialSchedule[2].opens)-Date.parse(initialSchedule[0].opens),28*86400000);
      assert.equal((await post('/api/online-password', { ...body, password: 'deskillingP60' })).status, 200);
      assert.deepEqual(schedule(), initialSchedule);
    });
    await step('future S2/S3 denied and master bypass does not change Day 0', async () => {
      for (const session_number of [2,3]) {
        assert.equal((await post('/api/online-password', { ...body, session_number, password: 'deskillingP60' })).status, 403);
        assert.equal((await post('/api/online-password', { ...body, session_number, password: process.env.STUDY_SHARED_PASSWORD })).status, 200);
      }
      assert.deepEqual(schedule(), initialSchedule);
      assert.equal((await post('/api/online-password', { ...body, password: 'deskillingP60' })).status, 200);
    });
    await step('missing/wrong participant/session cookies rejected before DB writes', async () => {
      for (const path of ['/api/assessment-session','/api/assessment-submit','/api/formal-video-url']) {
        const payload = { ...body, video_order: 1 };
        assert.equal((await post(path, payload, { cookie: '' })).status,403);
        assert.equal((await post(path, { ...payload, participant_id:'P59' })).status,403);
        assert.equal((await post(path, { ...payload, session_number:2 })).status,403);
      }
      assert.deepEqual(counts(), { queue: 0, responses: 0, events: 0 });
    });
    await step('same-origin start persists 40 rows and reuses exact random order', async () => {
      assert.equal(client.isAssessmentConfigured(true), true);
      first = await client.loadAssessmentSession('P60',1,true);
      assert.equal(first.videoQueue.length,40); assert.equal(first.startIndex,0);
      assert.equal(first.studyMode,'formal'); queueOrder=first.videoQueue;
      assert.deepEqual((await client.loadAssessmentSession('P60',1,true)).videoQueue, queueOrder);
      assert.deepEqual(counts(), { queue:40, responses:0, events:0 });
    });
    await step('only current video authorized; unchanged HMAC relative URL', async () => {
      const video = await client.loadCurrentVideoSource('P60',1,queueOrder[0],'formal',true);
      assert.match(video.signedUrl,/^\/api\/formal-video\?/);
      assert.equal((await post('/api/formal-video-url',{ ...body,video_order:2 })).status,403);
    });
    await step('positive mark atomically saved with exact precision and latency calculation', async () => {
      positive = { ...body, video_id:queueOrder[0].videoId, video_order:1, final_answer:true,
        response_time_ms:1234, no_response_latency_ms:null, video_completed:true,
        clicks:[{ click_index:1, video_time_at_click:0.001, response_time_ms:1234 }] };
      await client.submitVideoResponse(positive,true);
      assert.deepEqual(counts(),{ queue:40,responses:1,events:1 });
      const row=read("SELECT row_to_json(r) FROM public.responses r WHERE video_order=1");
      assert.equal(row.answer,true); assert.equal(row.response_time_ms,1234);
      assert.equal(row.video_time_at_click,0.001); assert.equal(row.no_response_latency_ms,null);
      const valid=inspect("SELECT count(*) FROM public.lesion_detection_events e JOIN public.responses r USING(participant_id,session_number,video_id,video_order) JOIN public.videos v USING(video_id) WHERE e.video_order=1 AND e.click_index=1 AND e.final_valid AND NOT e.overridden AND e.video_time_at_click=0.001 AND e.response_time_ms=1234 AND e.detection_latency_ms IS NOT DISTINCT FROM (CASE WHEN v.lesion_onset_sec IS NULL THEN NULL ELSE round(((0.001::double precision-v.lesion_onset_sec)*1000)::numeric)::bigint END) AND r.detection_latency_ms IS NOT DISTINCT FROM e.detection_latency_ms");
      assert.equal(valid,'1');
    });
    await step('no-lesion saves false/NULL detection time/empty events and exact bigint', async () => {
      negative={ ...body,video_id:queueOrder[1].videoId,video_order:2,final_answer:false,response_time_ms:Number.MAX_SAFE_INTEGER,
        no_response_latency_ms:0,video_completed:true,clicks:[] };
      await client.submitVideoResponse(negative,true);
      assert.deepEqual(counts(),{queue:40,responses:2,events:1});
      const row=read("SELECT json_build_object('answer',answer,'time',video_time_at_click,'latency',detection_latency_ms,'ms',response_time_ms::text,'no_ms',no_response_latency_ms) FROM public.responses WHERE video_order=2");
      assert.deepEqual(row,{answer:false,time:null,latency:null,ms:String(Number.MAX_SAFE_INTEGER),no_ms:0});
    });
    await step('exact retries idempotent; differing retry and future order rejected', async () => {
      await client.submitVideoResponse(positive,true); await client.submitVideoResponse(negative,true);
      const changed={...positive,response_time_ms:1235,clicks:[{...positive.clicks[0],response_time_ms:1235}]};
      assert.equal((await post('/api/assessment-submit',changed)).status,400);
      assert.equal((await post('/api/assessment-submit',{...negative,video_id:queueOrder[3].videoId,video_order:4})).status,400);
      assert.deepEqual(counts(),{queue:40,responses:2,events:1});
    });
    await step('injected response failure rolls back events and preserves next order', async () => {
      inspect("CREATE FUNCTION public.checkpoint_b_fail_response() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated injected response failure'; END $$; CREATE TRIGGER checkpoint_b_fail_response BEFORE INSERT ON public.responses FOR EACH ROW EXECUTE FUNCTION public.checkpoint_b_fail_response();");
      try {
        const failure=await post('/api/assessment-submit',{...positive,video_id:queueOrder[2].videoId,video_order:3});
        assert.equal(failure.status,400); assert.notEqual((await failure.json()).saved,true);
        assert.deepEqual(counts(),{queue:40,responses:2,events:1});
        assert.equal((await client.loadAssessmentSession('P60',1,true)).startIndex,2);
      } finally { inspect('DROP TRIGGER checkpoint_b_fail_response ON public.responses; DROP FUNCTION public.checkpoint_b_fail_response();'); }
    });
    await step('fresh Node process resumes same persisted queue at Video 3', async () => {
      const script=`globalThis.fetch=async()=>{throw Error('Supabase/network forbidden')}; const {POST}=await import('./app/api/assessment-session/route.ts'); const r=await POST(new Request('http://127.0.0.1/api/assessment-session',{method:'POST',headers:{cookie:process.env.TEST_COOKIE,'content-type':'application/json'},body:JSON.stringify({participant_id:'P60',session_number:1})})); if(r.status!==200) throw Error('resume failed'); console.log(JSON.stringify(await r.json()));`;
      const result=JSON.parse(execFileSync(process.execPath,['--conditions=react-server','--input-type=module','-e',script],{encoding:'utf8',timeout:45000,env:{...process.env,TEST_COOKIE:cookie}}));
      assert.equal(result.data[0].next_video_order,3);
      assert.deepEqual(result.data.map(r=>({videoId:r.video_id,videoOrder:r.video_order})),queueOrder);
    });
    await step('complete 40 using API; completion locks future playback/submission', async () => {
      for(let index=2;index<40;index++) await client.submitVideoResponse({...negative,video_id:queueOrder[index].videoId,video_order:index+1,response_time_ms:2000},true);
      const complete=await client.loadAssessmentSession('P60',1,true);
      assert.equal(complete.isComplete,true); assert.equal(complete.startIndex,40);
      assert.deepEqual(complete.videoQueue,queueOrder);
      assert.equal((await post('/api/formal-video-url',{...body,video_order:40})).status,403);
      assert.equal((await post('/api/assessment-submit',{...positive,response_time_ms:1235,clicks:[{...positive.clicks[0],response_time_ms:1235}]})).status,400);
      await client.submitVideoResponse(positive,true);
      assert.deepEqual(counts(),{queue:40,responses:40,events:1});
      assert.equal(inspect('SELECT count(DISTINCT video_order) FROM public.responses'),'40');
    });
    await step('no Supabase configuration or outbound requests occurred', async () => {
      assert.deepEqual(Object.keys(process.env).filter(k=>k.includes('SUPABASE')),[]);
      assert.deepEqual(violations,[]); assert.ok(requests.length>40);
      assert.deepEqual(schedule(),initialSchedule);
    });
    if(process.env.CHECKPOINT_B_REPORT_PATH) writeFileSync(process.env.CHECKPOINT_B_REPORT_PATH,JSON.stringify({status:'PASS',test_database:db,app_role:identity.role,checks:passed,counts:counts(),supabase_calls:0,requests:requests.length},null,2)+'\n',{flag:'wx',mode:0o600});
  } finally {
    globalThis.fetch=originalFetch; Socket.prototype.connect=originalConnect;
    await new Promise(resolve=>server.close(resolve));
  }
});
