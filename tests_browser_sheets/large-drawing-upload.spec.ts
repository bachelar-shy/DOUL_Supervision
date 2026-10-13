import {expect, test} from "@playwright/test";

test("22 MiB drawing uses existing chunk-upload Evidence path and links one original", async ({page}) => {
  await page.goto("/#/drawings");
  const actual = await page.evaluate(async () => {
    const {uploadDrawingSet} = await import("/src/data/drawing-sheet-client.ts");
    const events: Array<Record<string, unknown>> = [];
    const api = {
      session: {actor: {partyId:"actor-1"}},
      path: (suffix: string) => "/projects/sample" + suffix,
      upload: async (bytes: Uint8Array, options: Record<string, unknown>,
                     progress?: (offset:number,total:number)=>void) => {
        events.push({action:"upload", size:bytes.length,
          hash:String(options.hash).length, captureId:options.captureId,
          mime:options.mime, sourcePartyId:options.sourcePartyId});
        progress?.(bytes.length,bytes.length);
        return {id:"registered-pdf",version:2};
      },
      request: async (url: string, options: {body?:string;headers?:Record<string,string>}) => {
        events.push({action:"import",url,requestKey:options.headers?.["Idempotency-Key"],
          body:JSON.parse(options.body || "{}")});
        return {set:{id:"sheet-set-1",pageCount:3}};
      },
    };
    const file = new File([new Blob(["%PDF-1.4\n"]),
      new Uint8Array(22 * 1024 * 1024)], "large-drawing.pdf", {type:"application/pdf"});
    let lastProgress = 0;
    const result = await uploadDrawingSet(api as never, file, "same-original-key",
      {discipline:"architecture",packageId:"pkg",locationId:"loc"},
      (offset,total) => {lastProgress = Math.round(offset * 100 / total);});
    return {events,result,lastProgress};
  });
  expect(actual.events).toEqual([
    {action:"upload",size:22*1024*1024+9,hash:64,
      captureId:"same-original-key",mime:"application/pdf",sourcePartyId:"actor-1"},
    {action:"import",url:"/projects/sample/drawing-sets/from-evidence",
      requestKey:"same-original-key-drawing-index",
      body:{evidenceRef:{objectType:"Evidence",objectId:"registered-pdf",version:2}}},
  ]);
  expect(actual.result.set.id).toBe("sheet-set-1");
  expect(actual.lastProgress).toBe(100);
});
