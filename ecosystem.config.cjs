module.exports = {
  apps: [
    { name: "the-cliff-news-next", script: "npm", args: "run start", cwd: __dirname, env: { NODE_ENV: "production" } },
    { name: "the-cliff-news-auto-publisher", script: "scripts/auto-publisher.js", cwd: __dirname, env: { NODE_ENV: "production" } },
  ],
};
