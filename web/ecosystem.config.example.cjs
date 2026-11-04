// PM2 settings for VibeLearner. On the server: cp ecosystem.config.example.cjs ecosystem.config.cjs, then fill in
// the env block. ecosystem.config.cjs is gitignored because it holds API keys; deploy.sh starts the app from it.
module.exports = {
    apps: [
        {
            name: "VibeLearner",            // must match APP_NAME in deploy.sh
            cwd: __dirname,
            script: "npm",
            args: "run start",
            exec_mode: "fork",
            instances: 1,                   // keep at 1: sessions live in this process's memory
            autorestart: true,              // Auto restart on failure
            min_uptime: "10s",              // App must stay up this long or PM2 treats it as unstable
            restart_delay: 5000,            // Wait 5s between restart attempts
            exp_backoff_restart_delay: 200, // Exponential backoff for repeated crashes
            max_restarts: 20,               // Prevent tight infinite crash loops
            watch: false,
            max_memory_restart: "1G",       // a restart ends every open session, so leave plenty of room
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            error_file: "logs/error.log",
            out_file: "logs/app.log",
            merge_logs: true,
            env: {
                NODE_ENV: "production",
                HOST: "127.0.0.1",          // only reachable through Apache, not directly on the port
                PORT: 3100,                 // must match ProxyPass in the Apache conf; check it's free first: ss -tlnp | grep :3100

                // Password people type to reach the site; share it with participants. deploy.sh won't deploy without it.
                SITE_PASSWORD: "",

                // Model: UBC's EduAI. Until EDUAI_API_KEY is filled in, the site works but the tutor answers
                // "EduAI API key missing." Empty values are ignored.
                VL_PROVIDER: "eduai",       // or ollama | openai | gemini, with that provider's key below
                VL_MODEL: "",               // the model name EduAI gives you, if any
                EDUAI_API_KEY: "",
                OPENAI_API_KEY: "",
                OPENAI_BASE_URL: "",
                GEMINI_API_KEY: "",

                // Participants' programs run on Judge0 in Docker (judge0/setup.sh prints the token), never on this
                // server itself. deploy.sh won't deploy without both.
                JUDGE0_URL: "http://127.0.0.1:2358",
                JUDGE0_AUTH_TOKEN: "",

                // Everything else (learning.level for the study condition, EduAI's courseCode, ...) goes in
                // vibelearner.config.json, which is re-read at every session start, so no restart is needed.
            },
        },
    ],
};
