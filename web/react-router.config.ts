import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Host names people use to reach the site, without https://. Behind Apache the app sees its own address
  // (http://localhost:<PORT>), not the one in the browser, and React Router refuses a form post (the admin page's
  // sign-in and every button on it) whose Origin doesn't match unless the browser's host is listed here.
  // It's read when the app is built, so a change is live after the next ./deploy.sh.
  allowedActionOrigins: ["dev.sandbox.ok.ubc.ca"],
} satisfies Config;
