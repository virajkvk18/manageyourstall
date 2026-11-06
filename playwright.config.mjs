import {defineConfig} from '@playwright/test';

// Browser acceptance tests for ManageYourStall. Uses the locally installed Chrome.
// A dev server already running on 127.0.0.1:4173 is reused; otherwise `npm start` is launched.
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  timeout: 45000,
  expect: {timeout: 7000},
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    channel: 'chrome',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  webServer: {command: 'npm start', url: 'http://127.0.0.1:4173', reuseExistingServer: true},
  projects: [
    {name: 'desktop', use: {viewport: {width: 1440, height: 1000}}},
    {name: 'tablet', use: {viewport: {width: 820, height: 1180}}},
    {name: 'mobile', use: {viewport: {width: 390, height: 844}, hasTouch: true}},
    {name: 'narrow', use: {viewport: {width: 320, height: 740}, hasTouch: true}},
  ],
});
