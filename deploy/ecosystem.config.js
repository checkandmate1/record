// pm2 process definitions for both environments on the Linode box.
//   pm2 startOrReload deploy/ecosystem.config.js --only record          (prod)
//   pm2 startOrReload deploy/ecosystem.config.js --only record-staging  (staging)
// `next start` loads <cwd>/.env itself, so per-environment secrets live in each checkout's .env.
// Node 22 via nvm is required (pm2 itself is installed under that node).
const NODE = "/root/.nvm/versions/node/v22.22.1/bin/node";

function app(name, cwd, port) {
  return {
    name,
    cwd,
    script: "node_modules/next/dist/bin/next",
    args: `start -p ${port}`,
    interpreter: NODE,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_memory_restart: "450M", // box has ~1 GB RAM total; keep one runaway from taking both apps down
    env: { NODE_ENV: "production", PORT: String(port) },
    error_file: `/root/.pm2/logs/${name}-error.log`,
    out_file: `/root/.pm2/logs/${name}-out.log`,
    time: true,
  };
}

module.exports = {
  apps: [
    app("record", "/var/www/record", 3001),
    app("record-staging", "/var/www/record-staging", 3002),
  ],
};
