import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { initializeProject, configureStorage } from "../src/project.js";
import { createTourReview, openTourReview, applyReviewAction, tourReport, reviewView } from "../src/review/workflow.js";
import { startTourReview } from "../src/review/server.js";
import { startPreview } from "../src/preview.js";

const brief = { audience: "New team members", outcome: "Complete the sample tasks", privacy: "Synthetic data only; inspect every capture before sharing", testDataEffects: "Only this local synthetic application is changed. No real records are created." };
function journey(baseUrl, id = "first-tour") {
  return { schemaVersion: 1, id, title: "Your first successful tour", target: { baseUrl, goal: brief.outcome }, outputs: ["screenshots"], modules: [
    ["dashboard", "Find the right request", "/dashboard.html", "Review the request", "Request opened"],
    ["form", "Complete the request", "/form.html", "Continue to confirmation", "Request confirmed"],
    ["content", "Find a helpful guide", "/content.html", "Read the guide", "Guide opened"]
  ].map(([id,title,route,instruction,result]) => ({ id,title,route,dependencies:{ views:[id] },assets:{}, setup:[{id:"open",action:"goto",description:"Open the test screen",path:route}],steps:[{id:"act",action:"click",description:instruction,selector:"testid=action",expect:{selector:"css=#result",text:result,stableForMs:60},pauseAfterMs:100}] })) };
}
const styles = '<style>body{font:18px/1.5 system-ui;background:#f3f5f7;color:#20242a;margin:36px}main{max-width:1100px}button,input{font:inherit;padding:12px}button{background:#fff;border:1px solid #777;border-radius:5px}article,form{padding:24px;background:white;border:1px solid #ccc}#result{margin-top:24px}.board{display:flex;gap:20px}.board article{width:280px}nav{margin-bottom:24px}</style>';
async function fixture(mode = "screenshots", count = 3) {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-review-"));
  const sourceDir = path.join(root, "fixture"); await mkdir(sourceDir);
  const pages = {
    dashboard: '<nav>Workspace / Requests</nav><h1>Requests overview</h1><div class="board"><article><h2>New</h2><p>Sample request #104</p><button data-testid="action" onclick="document.querySelector(\'#result\').textContent=\'Request opened\'">Review request</button></article><article><h2>In progress</h2><p>Sample request #102</p></article><article><h2>Complete</h2><p>Sample request #099</p></article></div>',
    form: '<h1>Request details</h1><form><label>Request title <input value="Synthetic request" readonly></label><p>Step 2 of 3 · Review the details</p><button type="button" data-testid="action" onclick="document.querySelector(\'#result\').textContent=\'Request confirmed\'">Continue</button></form>',
    content: '<nav>Help center / Getting started</nav><h1>Learn the essentials</h1><article><h2>Getting your first request right</h2><p>Choose the right category, add the details, and confirm submission.</p><button data-testid="action" onclick="document.querySelector(\'#result\').textContent=\'Guide opened\'">Read guide</button></article>'
  };
  for (const [name,body] of Object.entries(pages)) await writeFile(path.join(sourceDir,name+".html"), '<!doctype html><html lang="en"><head><title>Sample application</title>'+styles+'</head><body><main>'+body+'<div id="result">Ready</div></main></body></html>');
  await writeFile(path.join(sourceDir,"index.html"),"Fixture");
  const source = await startPreview(sourceDir);
  await initializeProject(root);
  await configureStorage(root,{output:".autotour/output",documentationOutput:"delivery",artifacts:"local",documentation:"local",gitignore:"keep"});
  const plan = journey(source.url); plan.modules = plan.modules.slice(0,count);
  await createTourReview({root,journey:plan,brief,mode});
  const review = await openTourReview({root,id:plan.id});
  const act = (type, extra = {}, deps) => applyReviewAction(review,{type,version:review.state.version,...extra},deps);
  return {root,source,review,act};
}
const attest = { reviewer:"Fixture reviewer", checks:{readable:true,accurate:true,private:true,playback:true} };

test("plans, captures, approvals and delivery are revision-bound; failures preserve prior media", {timeout:60000}, async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.act("capture",{consent:true}),/Approve the current plan/);
    await f.act("approve-plan",{reviewer:"Fixture reviewer",consent:true});
    await f.act("capture",{consent:true});
    for (const sceneId of ["dashboard","form","content"]) await f.act("approve-scene",{sceneId,...attest});
    assert.equal((await tourReport(f.review)).ready,true);
    const previous = f.review.state.capture;
    const unchangedHash = f.review.state.scenes.content.assetHash;
    await f.act("wording",{sceneId:"form",stepId:"act",instruction:"Confirm the sample request",narration:"The confirmation is displayed."});
    assert.equal((await tourReport(f.review)).ready,false);
    await assert.rejects(f.act("approve-scene",{sceneId:"form",...attest}),/Capture the current revision/);
    await assert.rejects(f.act("recapture",{sceneId:"form",consent:true},{regenerate:async()=>{throw new Error("secret-auth-value");}}),/previous capture is preserved/);
    assert.equal(f.review.state.capture,previous);
    assert.ok(!JSON.stringify(f.review.state.failure).includes("secret-auth-value"));
    await f.act("recapture",{sceneId:"form",consent:true});
    assert.notEqual(f.review.state.capture,previous);
    assert.equal(f.review.state.scenes.content.assetHash,unchangedHash);
    assert.equal(f.review.state.scenes.content.approval,null);
    assert.ok(f.review.state.scenes.dashboard.approval);
    await f.act("approve-scene",{sceneId:"form",...attest});
    await f.act("exclude",{sceneId:"content",excluded:true});
    await f.act("deliver",{consent:true});
    const destination = f.review.state.delivery.path;
    assert.ok((await readFile(path.join(destination,"index.html"),"utf8")).includes("Confirm the sample request"));
    assert.deepEqual((await readdir(path.join(destination,"modules"))).sort(),["dashboard","form"]);
    assert.ok(await readFile(path.join(f.review.directory,previous,"walkthrough.json")));
    const manifest = JSON.parse(await readFile(path.join(f.review.directory,f.review.state.capture,"walkthrough.json"),"utf8"));
    const file = path.join(f.review.directory,f.review.state.capture,manifest.modules[0].assets.screenshots[0]);
    await writeFile(file,"tampered");
    assert.equal((await tourReport(f.review)).ready,false);
    await assert.rejects(f.act("deliver",{consent:true}),/Delivery is blocked/);
    await assert.rejects(applyReviewAction(f.review,{type:"exclude",version:0,sceneId:"form",excluded:true}),/stale/);
    await assert.rejects(f.act("trial",{completed:null,unexpectedWrites:false,disclosure:false}),/explicit true\/false/);
    await f.act("trial",{participant:"viewer-a",applicationType:"form",completed:true,unexpectedWrites:false,disclosure:false});
    assert.equal(f.review.state.metrics.trials.length,1);
    await assert.rejects(readFile(path.join(f.root,".gitignore")),{code:"ENOENT"});
  } finally {await f.source.close();}
});

test("review server protects writes, locks concurrent sessions, and rejects changed destinations", async () => {
  const f = await fixture(); let session;
  try {
    session = await startTourReview({root:f.root,id:"first-tour"});
    const raw = await (await fetch(session.url)).text();
    const token = /data-token="([a-f0-9]+)"/.exec(raw)[1];
    const endpoint = session.url+"api/action";
    for (const headers of [{},{"Content-Type":"application/json","Origin":"https://outside.example","X-Autotour-Token":token}]) assert.equal((await fetch(endpoint,{method:"POST",headers,body:"{}"})).status,403);
    await assert.rejects(startTourReview({root:f.root,id:"first-tour"}),/already open/);
    assert.equal((await fetch(session.url+"media/captures/..%2freview.json")).status,404);
    await configureStorage(f.root,{output:".autotour/output",documentationOutput:"another-delivery",artifacts:"local",documentation:"local",gitignore:"keep"});
    const response = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Origin":session.url.slice(0,-1),"X-Autotour-Token":token},body:JSON.stringify({type:"approve-plan",version:1,reviewer:"Test",consent:true})});
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/Storage configuration changed/);
  } finally {await session?.close();await f.source.close();}
});

test("review UI follows approved desktop/mobile layout and completes review-to-delivery", {timeout:60000}, async () => {
  const f = await fixture("screenshots",1); let session; let browser;
  try {
    session = await startTourReview({root:f.root,id:"first-tour"});
    browser = await chromium.launch();
    const page = await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    const evidence = path.resolve(".agenthouse/evidence/first-tour-review");await mkdir(evidence,{recursive:true});
    await page.goto(session.url);
    await page.getByLabel("Reviewer name").fill("Fixture reviewer");
    await page.getByLabel("I approve the saved plan",{exact:false}).check();
    await page.screenshot({path:path.join(evidence,"brief.png"),fullPage:true});
    await page.getByRole("button",{name:"Approve plan",exact:true}).click();
    await page.getByRole("button",{name:"Plan approved",exact:true}).waitFor();
    await page.getByLabel("I approve the saved plan",{exact:false}).check();
    await page.getByRole("button",{name:"Start capture",exact:true}).click();
    await page.getByRole("heading",{name:"Wording",exact:true}).waitFor();
    await page.locator(".media img").waitFor();
    assert.equal(await page.locator(".media img").evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await page.screenshot({path:path.join(evidence,"review-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(evidence,"review-mobile.png"),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole("button",{name:"View at 1:1",exact:true}).click();
    assert.equal(await page.getByRole("button",{name:"View at 1:1",exact:true}).getAttribute("aria-pressed"),"true");
    await page.getByRole("button",{name:"Recapture scene…",exact:true}).click();
    await page.screenshot({path:path.join(evidence,"recapture-mobile.png"),fullPage:true});
    assert.equal(await page.getByRole("button",{name:"Recapture this scene",exact:true}).isDisabled(),true);
    await page.getByRole("button",{name:"Back to review",exact:true}).click();
    for (const id of ["readable","accurate","private","playback"]) await page.locator("#"+id).check();
    await page.getByRole("button",{name:"Approve scene",exact:true}).click();
    await page.locator(".scene small").filter({hasText:"Approved"}).waitFor();
    await page.getByRole("button",{name:"4 · Delivery",exact:true}).click();
    await page.getByText("All included scenes have current approval.",{exact:true}).waitFor();
    await page.setViewportSize({width:1440,height:1100});
    await page.screenshot({path:path.join(evidence,"delivery.png"),fullPage:true});
    await page.getByLabel("Prepare a new local delivery",{exact:false}).check();
    await page.getByRole("button",{name:"Prepare local delivery",exact:true}).click();
    await page.getByText("Prepared locally:",{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await session?.close();await f.source.close();}
});

test("DOM checkpoints play in isolated review iframe and retain protected origin boundary", {timeout:60000}, async () => {
  const f=await fixture("dom",1);let session;let browser;
  try {
    await f.act("approve-plan",{reviewer:"Fixture reviewer",consent:true});await f.act("capture",{consent:true});
    session=await startTourReview({root:f.root,id:"first-tour"});browser=await chromium.launch();
    const page=await browser.newPage();await page.goto(session.url);
    await page.getByRole("button",{name:"2 · Review scenes",exact:true}).click();
    const frame=page.frameLocator('iframe[title="Recorded scene preview"]');
    await frame.locator('body[data-autoplay="disabled"]').waitFor();
    await frame.getByRole("button",{name:"Play replay",exact:true}).click();
    await frame.locator("#status").filter({hasText:"Complete"}).waitFor();
    assert.equal(await page.locator('iframe[title="Recorded scene preview"]').getAttribute("sandbox"),"allow-scripts allow-same-origin");
    assert.equal(await frame.locator('body').evaluate(() => { try { return Boolean(parent.document.body); } catch { return false; } }), false);
  } finally {await browser?.close();await session?.close();await f.source.close();}
});

test("symlinked review destinations cannot redirect generated artifacts", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"autotour-links-"));await initializeProject(root);
  const outside=await mkdtemp(path.join(os.tmpdir(),"autotour-outside-"));
  await symlink(outside,path.join(root,"linked"),process.platform==="win32"?"junction":"dir");
  await configureStorage(root,{output:"linked",documentationOutput:"delivery",artifacts:"local",documentation:"local",gitignore:"keep"});
  await assert.rejects(createTourReview({root,journey:journey("http://127.0.0.1:1"),brief}),/Symlinked/);
  assert.deepEqual(await readdir(outside),[]);
});

test("video review prepares a playable local delivery", {timeout:60000}, async () => {
  const f = await fixture("video", 1); let browser; let delivery;
  try {
    await f.act("approve-plan", {reviewer:"Fixture reviewer",consent:true});
    await f.act("capture", {consent:true});
    await f.act("approve-scene", {sceneId:"dashboard",...attest});
    await f.act("deliver", {consent:true});
    delivery = await startPreview(f.review.state.delivery.path);
    browser = await chromium.launch(); const page = await browser.newPage();
    await page.goto(delivery.url);
    await page.locator("video").evaluate(async video => { await video.play(); });
    await page.waitForFunction(() => document.querySelector("video").currentTime > 0);
    assert.equal(await page.locator("video").evaluate(video => video.videoWidth > 0 && !video.error), true);
  } finally { await browser?.close(); await delivery?.close(); await f.source.close(); }
});
