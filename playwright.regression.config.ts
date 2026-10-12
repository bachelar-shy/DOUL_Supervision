import {defineConfig} from "@playwright/test";
import base from "./playwright.config";

// Own disposable services so local regression never attaches to somebody else's preview.
const origin="http://127.0.0.1:5221";
process.env.DOUL_TEST_BROWSER_ORIGIN=origin;
export default defineConfig({
  ...base,
  use:{...base.use,baseURL:origin},
  webServer:[
    {
      command:`.venv/bin/python -m services.api --demo --database .local/regression-${process.pid}.sqlite3 --port 8799`,
      url:"http://127.0.0.1:8799/health",reuseExistingServer:false,
      env:{DOUL_ENVIRONMENT:"development",DOUL_API_ALLOWED_ORIGINS:origin+",http://127.0.0.1:5181"},
    },
    {
      command:"npm run web -- --host 127.0.0.1 --port 5221 --strictPort",
      url:origin,reuseExistingServer:false,
      env:{VITE_DOUL_UI_SCOPE:"full",VITE_DOUL_AUTH_MODE:"",DOUL_TEST_API_TARGET:"http://127.0.0.1:8799"},
    },
  ],
});
