import {expect,type Locator} from "@playwright/test";

/** Use the visible field evidence picker; explicit unlisted IDs use its advanced input. */
export async function selectCommandEvidence(dialog:Locator,ids:string[]) {
  const picker=dialog.locator(".command-evidence-picker");
  await expect(picker).toBeVisible();
  for(const input of await picker.locator('input[type="checkbox"]').all())await input.uncheck();
  const manual:string[]=[];
  for(const id of ids){
    let selected=false;
    // Match exact server IDs without interpolating them into CSS selectors.
    for(const option of await picker.locator('input[type="checkbox"]').all()){
      if(await option.getAttribute("value")===id){await option.check();selected=true;break;}
    }
    if(!selected)manual.push(id);
  }
  if(manual.length){
    const details=picker.locator("details");
    if(await details.getAttribute("open")===null)await details.locator("summary").click();
    await details.getByRole("textbox").fill(manual.join(","));
  }
}
