import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';

test('root is the sole intake and the removed passwordless page/API return 404', {timeout:30000}, async()=>{
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{PATH:process.env.PATH,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  try {
    let ready=false;
    for(let i=0;i<100;i++) {
      try { if((await fetch(`http://127.0.0.1:${port}/`)).status===200){ready=true;break;} } catch {}
      assert.equal(child.exitCode,null,logs);await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(ready,logs);
    for(const [pathname,expectedLabels] of [['/',['Participant ID','Session number','Password']]]) {
      const html=await (await fetch(`http://127.0.0.1:${port}${pathname}`)).text();
      const form=html.match(/<form\b[^>]*>[\s\S]*?<\/form>/)?.[0];assert.ok(form);
      const labels=[...form.matchAll(/<label\b[^>]*>\s*<span>([^<]+)<\/span>/g)].map(m=>m[1]);
      assert.deepEqual(labels,expectedLabels);
      assert.match(form,/<button[^>]*type="submit"[^>]*>Start<\/button>/);
      assert.doesNotMatch(form,/AI condition/);
      assert.match(form,/<input[^>]*type="password"[^>]*required/);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/baseline`)).status,404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/baseline-access`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({participant_id:'P21'})})).status,404);
  } finally { const exited=once(child,'exit');child.kill('SIGTERM');await exited; }
});
