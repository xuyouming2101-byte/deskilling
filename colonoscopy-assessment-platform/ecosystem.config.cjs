module.exports = {
  apps: [
    {
      name: "colonoscopy-assessment",
      cwd: __dirname,
      script: "./node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 3000",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
