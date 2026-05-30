// Cloudflare Workers Cron Trigger for TDL wait-time collector
//
// Setup:
//   1. dash.cloudflare.com → Workers & Pages → Create → Hello World template
//   2. Paste this file's contents into the editor and Deploy
//   3. Settings → Variables and Secrets → Add (Secret):
//        Name : GITHUB_TOKEN
//        Value: a GitHub fine-grained PAT with
//               "Actions: read & write" permission on
//               ZambiniBrothers/tdl-wait-tracker
//   4. Triggers → Cron Triggers → Add → "*/15 * * * *"
//
// After deploying, every 15 minutes Cloudflare will POST to the GitHub
// workflow_dispatch endpoint, which triggers the existing
// "Collect TDL wait times" workflow immediately (no schedule-queue delay).

const REPO_OWNER = 'ZambiniBrothers';
const REPO_NAME = 'tdl-wait-tracker';
const WORKFLOW_FILE = 'collect.yml';
const BRANCH = 'main';

export default {
  async scheduled(event, env, ctx) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'tdl-cron-trigger'
      },
      body: JSON.stringify({ ref: BRANCH })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status}: ${body}`);
    }
  },

  // Optional: hitting the worker URL in a browser shows a quick health check
  async fetch(request, env) {
    return new Response('TDL cron trigger worker. Scheduled events fire every 15 min.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
};
