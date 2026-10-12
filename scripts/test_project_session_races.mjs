import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

const code=ts.transpileModule(readFileSync(new URL("../packages/client/src/index.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {ApiClient}=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
const session=(token,project="original")=>({accessToken:token,projectId:project,actor:{partyId:"fixture-party",roleAssignmentId:"fixture-role",actorGroup:"ADM",name:"Fixture"},mode:"PASSWORD"});
const ok=(body)=>new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});
const denied=()=>new Response(JSON.stringify({code:"UNAUTHENTICATED",message:"Expired",failedGuards:[]}),{status:401,headers:{"Content-Type":"application/json"}});
function pending(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const originalFetch=globalThis.fetch;
try {
  for(const early of [true,false]) {
    const client=new ApiClient();client.session=session("old");let expired=0;client.onUnauthorized=()=>{expired++;};
    const old=pending(),select=pending();globalThis.fetch=(url)=>url.endsWith("/auth/project-session")?select.promise:old.promise;
    const reading=client.request("/projects/original/workspace").catch(e=>e);
    const switching=client.selectProject("sample");
    if(early){old.resolve(denied());await reading;assert.equal(expired,0);}
    select.resolve(ok(session("new","sample")));await switching;
    if(!early){old.resolve(denied());await reading;}
    assert.equal(client.session.accessToken,"new");assert.equal(expired,0);
    globalThis.fetch=async()=>denied();await client.request("/current").catch(e=>e);
    assert.equal(client.session,null);assert.equal(expired,1);
  }
  {
    const client=new ApiClient();client.session=session("old");let expired=0;client.onUnauthorized=()=>expired++;
    globalThis.fetch=async()=>denied();await client.selectProject("sample").catch(e=>e);
    assert.equal(client.session,null);assert.equal(expired,1);
  }
  {
    const client=new ApiClient();client.session=session("old");const logout=pending();
    globalThis.fetch=(url)=>url.endsWith("/auth/logout")?logout.promise:Promise.resolve(ok(session("new")));
    const ending=client.logout();await client.loginPassword("fixture","test-only-password");
    logout.resolve(ok({status:"ok"}));await ending;assert.equal(client.session.accessToken,"new");
  }
  console.log("Project session race checks: 4 scenarios passed");
} finally {globalThis.fetch=originalFetch;}
