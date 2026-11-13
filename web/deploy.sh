#!/bin/bash

# What:
#	Pulls the latest commit of the checked-out branch, installs, builds and (re)starts VibeLearner with PM2
#	(using ecosystem.config.cjs). Adapted from the lab's Remix deploy template; this app has no database,
#	so the Prisma and Docker steps are gone. It also leaves Apache alone: a deploy doesn't change Apache's
#	config, and S378's Apache serves other lab sites that a restart would interrupt (or take down, if someone
#	else's config is broken). After editing the Apache conf, reload it yourself (DEPLOY.md, step 7).
# Before the first run (details in DEPLOY.md):
#	1. The repo is cloned on the server (e.g. /srv/www/vibelearner) and this file is web/deploy.sh inside it.
#	2. ecosystem.config.cjs exists next to this file (copy ecosystem.config.example.cjs; it's gitignored).
#	3. Node 22.22+ and pm2 are installed, and APP_GROUP below exists with you in it.
# Usage:
#	./deploy.sh [--force]
#	If --force is passed, deployment continues even with no new commit.

# Variables
APP_DIR="$(cd "$(dirname "$0")" && pwd)"		# the web app folder (this script lives in web/)
REPO_DIR="$(git -C "$APP_DIR" rev-parse --show-toplevel)"	# whole checkout: the build also reads ../src
APP_NAME="VibeLearner"			# must match "name" in ecosystem.config.cjs
APP_GROUP="vibelearner"			# group that shares ownership of the files (use the same one on dev and prod)
GIT_BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"	# the branch the server was cloned with (git clone -b <name>)
LAST_COMMIT_FILE="$APP_DIR/.last_commit"
LOCKFILE="/tmp/vibelearner-deploy.lock"	# per app, so it can't collide with another site's deploy on the same server

# Function to clean up the lock file on exit
cleanup() {
    rm -f "$LOCKFILE"
}
trap cleanup EXIT INT TERM

# Check for the --force flag
FORCE_DEPLOY=false
if [ "$1" == "--force" ]; then
    FORCE_DEPLOY=true
    echo "Force deploy enabled: will rebuild and deploy even if no new commit."
fi

# Lock file mechanism: Check if the lock file exists and the process is still running
if [ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null; then
    echo "Deploy script is already running. Exiting."
    exit 1
fi
echo $$ > "$LOCKFILE"	# Create a lock file with the current process ID

#----------------#

echo "Starting deployment process..."

cd "$APP_DIR" || { echo "Failed to change directory to $APP_DIR"; exit 1; }

# Fail before touching anything if the server isn't ready.
if [ ! -f "ecosystem.config.cjs" ]; then
    echo "Missing ecosystem.config.cjs (kept out of git for secrets)."
    echo "Create it from ecosystem.config.example.cjs and fill in environment values."
    exit 1
fi
# The admin pages need their password and programs need Judge0 before the site goes up; the model's API key can come later.
node -e '
const env = require("./ecosystem.config.cjs").apps?.[0]?.env ?? {};
const missing = [["ADMIN_PASSWORD", "VL_ADMIN_PASSWORD"], ["JUDGE0_URL", "VL_JUDGE0_URL"], ["JUDGE0_AUTH_TOKEN", "VL_JUDGE0_TOKEN"]].filter((names) => !names.some((k) => env[k])).map((names) => names[0]);
if (missing.length) { console.error("Fill in " + missing.join(", ") + " in ecosystem.config.cjs first (see DEPLOY.md)."); process.exit(1); }
' || exit 1
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 22) ? 0 : 1)' 2>/dev/null; then
    echo "VibeLearner needs Node 22.22 or newer; this server has $(node -v 2>/dev/null || echo 'no node'). See Troubleshooting in DEPLOY.md."
    exit 1
fi
command -v pm2 >/dev/null || { echo "pm2 is not installed: sudo npm i -g pm2"; exit 1; }

# Ask whether to pull latest code from GitHub.
PULL_FROM_GITHUB=true
if [ -t 0 ]; then
    read -r -p "Pull latest code from GitHub? [Y/n]: " PULL_CHOICE
    case "$PULL_CHOICE" in
        n|N|no|NO)
            PULL_FROM_GITHUB=false
            ;;
        *)
            PULL_FROM_GITHUB=true
            ;;
    esac
fi

LATEST_COMMIT=""
if [ "$PULL_FROM_GITHUB" = true ]; then
    # The chmod below would otherwise show every file as modified.
    git config core.fileMode false

    # Ensure a clean working state (ignored files - data/, ecosystem.config.cjs, vibelearner.config.json - are kept)
    git reset --hard
    git clean -fd
    git checkout "$GIT_BRANCH"

    # Fetch the latest changes
    git fetch origin || { echo "Git fetch failed. Exiting."; exit 1; }

    # Get the latest commit hash on the target branch
    LATEST_COMMIT=$(git rev-parse origin/"$GIT_BRANCH")

    # Compare with the last deployed commit if not forcing deploy
    if [ "$FORCE_DEPLOY" = false ] && [ -f "$LAST_COMMIT_FILE" ]; then
        LAST_COMMIT=$(cat "$LAST_COMMIT_FILE")
        if [ "$LATEST_COMMIT" == "$LAST_COMMIT" ]; then
            echo "No new changes. Exiting."
            exit 0
        fi
    fi

    # Move to the fetched commit (no second fetch, unlike git pull)
    git reset --hard "origin/$GIT_BRANCH" || { echo "Updating to origin/$GIT_BRANCH failed. Exiting."; exit 1; }
else
    echo "Skipping GitHub pull. Continuing with local working copy."
fi

# reset ownership and permissions
sudo chown -R "$(id -un):$APP_GROUP" "$REPO_DIR"
chmod -R 755 "$REPO_DIR"
# API keys and participant data: no access for other accounts on the server.
mkdir -p logs data
chmod -R o-rwx data logs ecosystem.config.cjs vibelearner.config.json judge0/judge0.conf 2>/dev/null || true

# Install dependencies, build, and restart the app with PM2
echo "Installing dependencies..."
npm ci || { echo "npm ci failed. Exiting."; exit 1; }
echo "Building application..."
npm run build || { echo "Build failed. Exiting."; exit 1; }

echo "Re/starting application with PM2 (this ends any open participant sessions)..."
# Use a clean PM2 re-create sequence to avoid stale process-id restart errors.
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env || { echo "PM2 start failed. Exiting."; exit 1; }

echo "Saving PM2 process list..."
pm2 save || { echo "PM2 save failed. Exiting."; exit 1; }

echo "Current PM2 status:"
pm2 status
pm2 describe "$APP_NAME"

# Save the latest commit hash only when pulling from GitHub
if [ "$PULL_FROM_GITHUB" = true ]; then
    echo "$LATEST_COMMIT" > "$LAST_COMMIT_FILE"
fi

echo "Checking the app..."
PORT=$(node -e 'process.stdout.write(String(require("./ecosystem.config.cjs").apps?.[0]?.env?.PORT ?? ""))')
CODE=""
for _ in $(seq 1 20); do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/study")
    [ "$CODE" = "200" ] && break
    sleep 1
done
if [ "$CODE" = "200" ]; then
    echo "VibeLearner answers on port $PORT. The researcher page's \"Running Python\" check runs a program on Judge0."
else
    echo "WARNING: VibeLearner doesn't answer on port $PORT yet. Check: pm2 logs $APP_NAME"
fi

echo "Deployment complete: $(date)"
