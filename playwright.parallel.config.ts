import { defineConfig } from "@playwright/test";
export default defineConfig({testDir:"./tests_browser",testMatch:"parallel.spec.ts",workers:1,timeout:30000,use:{baseURL:"http://127.0.0.1:5191",browserName:"chromium"},reporter:"list"});
