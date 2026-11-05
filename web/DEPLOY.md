# Deploying on S378 (dev.sandbox.ok.ubc.ca)

This is the lab's "Deploying Remix app on Linux server" guide filled in for VibeLearner. Apache already serves dev.sandbox.ok.ubc.ca over HTTPS; you point it at the app, which PM2 keeps running on port 3100. The site asks for a password first. Participants' programs run in Judge0 sandboxes in Docker (port 2358), never on the server itself. The model is UBC's EduAI. VibeLearner has no database, so the guide's Prisma and mail steps don't apply.

You need sudo on S378. Run everything below on the server, logged in with your CWL account.

## 1. Check the server

```bash
ssh <cwl>@s378.ok.ubc.ca
cat /etc/os-release              # ID=rhel/centos/fedora: Apache is "httpd". ID=debian/ubuntu: "apache2" (user www-data)
node -v                          # needs v22.22 or newer (see Troubleshooting to upgrade)
sudo docker compose version      # Judge0 needs Docker with Compose v2
ss -tlnp | grep -E ':(3100|2358) '   # no output means both ports are free
sudo apachectl -S | grep -i sandbox   # the site's Apache conf file (on S378: /etc/httpd/conf.d/dev.sandbox.ok.ubc.ca.conf)
```

If `docker compose` isn't there, Docker Engine with the Compose plugin has to be installed first (ask whoever runs S378; RHEL's own Podman isn't a replacement here). If 3100 is taken, pick another port and use it in steps 3 and 7.

## 2. Group and folder

The app goes in its own folder, outside the sandbox site's DocumentRoot: `data/` holds participant logs and `ecosystem.config.cjs` holds the passwords and keys, and outside the DocumentRoot Apache can never serve them as plain files. The old sandbox contents can stay or be deleted.

```bash
getent group vibelearner || sudo groupadd vibelearner
sudo usermod -aG vibelearner "$USER"
sudo usermod -aG vibelearner apache       # www-data on Debian/Ubuntu
sudo usermod -aG vibelearner root
sudo mkdir -p /srv/www/vibelearner
sudo chown "$USER":vibelearner /srv/www/vibelearner
exit                                      # log back in so the new group applies; `groups` should list vibelearner
```

The group name is `APP_GROUP` in `deploy.sh`. If you pick another name, change it there and push before cloning.

## 3. Clone and configure

The repo is public, so no token is needed. The web app is on the `web-platform` branch; `deploy.sh` always deploys whichever branch is checked out.

```bash
cd /srv/www/vibelearner
git clone -b web-platform https://github.com/kaanspgl/VSCodeEducationalAIExtension.git .
cd web
cp ecosystem.config.example.cjs ecosystem.config.cjs
cp vibelearner.config.example.json vibelearner.config.json   # optional: study condition (learning.level) and other settings
chmod +x deploy.sh judge0/setup.sh
nano ecosystem.config.cjs
```

In `ecosystem.config.cjs`:

* `SITE_PASSWORD`: the password people type to reach the site. Pick a long one and give it to participants with the study instructions. Changing it later signs everyone out.
* `EDUAI_API_KEY`: leave it empty until you have it. The site works without it, but the tutor answers "EduAI API key missing." If EduAI gives you a model name or course code, put them in `VL_MODEL` and in `vibelearner.config.json` (`"courseCode"`).
* `JUDGE0_AUTH_TOKEN`: comes from step 4.
* `PORT`, only if 3100 was taken.

Values set in `ecosystem.config.cjs` win over the same settings in `vibelearner.config.json`.

## 4. Judge0 in Docker

Judge0 runs each program in a throwaway sandbox with no network, an 8-second limit and only that participant's project files. Everything it needs is in `web/judge0/`:

```bash
cd /srv/www/vibelearner/web/judge0
sudo systemctl enable --now docker
sudo ./setup.sh
```

The first run creates `judge0.conf` with fresh random passwords (it's gitignored and only readable by its owner), downloads the images (several GB, once), starts Judge0 on `127.0.0.1:2358` only, and prints a line like `JUDGE0_AUTH_TOKEN: "…"`. Put that token in `ecosystem.config.cjs`, then check Judge0 from the app's side:

```bash
cd /srv/www/vibelearner/web
nano ecosystem.config.cjs        # JUDGE0_AUTH_TOKEN
npm run check:runner
```

`check:runner` lists the Python and JavaScript versions it found, then runs five checks: a Python and a JavaScript program that import a helper file and read input, a crash, a network attempt that must fail, and an endless loop that must be stopped (that one takes about 8 seconds). It ends with "Judge0 is ready." Don't continue until it does.

Judge0 restarts by itself with Docker after a reboot, and keeps running across app deploys. It runs its sandbox without cgroups (see `judge0.conf.template`), so it works on current Linux without changing the server's boot settings.

Judge0 keeps every submission (participants' code, input and output) in its own database on S378. Include that in the study's data handling, alongside `data/`.

## 5. PM2 (once)

```bash
pm2 -v || sudo npm i -g pm2
pm2 startup               # then run the sudo command it prints, so the app comes back after a reboot
```

## 6. Deploy

```bash
cd /srv/www/vibelearner/web
./deploy.sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/login   # 200 means the app is up
```

The script refuses to start until `SITE_PASSWORD`, `JUDGE0_URL` and `JUDGE0_AUTH_TOKEN` are filled in, and checks Node. Then it pulls the branch, runs `npm ci` and `npm run build`, (re)starts the app under PM2, saves the process list, and runs a quick Judge0 check (a warning, not a stop, if Judge0 is down). It doesn't touch Apache: a deploy doesn't change Apache's config, and S378's Apache also serves about ten other lab sites that a restart would interrupt.

## 7. Point Apache at the app

Edit the conf file found in step 1 (on S378: `sudo nano /etc/httpd/conf.d/dev.sandbox.ok.ubc.ca.conf`). If it starts with `# Ansible managed`, ask whoever manages the server before editing. Put this inside the `<VirtualHost *:443>` block, or at the top level if the file has no `<VirtualHost>` block:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
<Location />
    ProxyPass http://127.0.0.1:3100/
    ProxyPassReverse http://127.0.0.1:3100/
</Location>
```

`X-Forwarded-Proto` tells the app the browser is on HTTPS, so the password cookie is never sent over plain HTTP. Use `127.0.0.1`, not `localhost`: the app only listens on IPv4 loopback, and `localhost` can resolve to `::1` first. On Debian/Ubuntu, run `sudo a2enmod proxy proxy_http headers` first.

```bash
sudo apachectl configtest && sudo systemctl reload httpd    # apache2 on Debian/Ubuntu
```

Reload, don't restart: the same Apache serves the other lab sites on S378. A reload picks up the change without dropping their connections, and the `&&` runs it only if the test says "Syntax OK", so a typo can't take every site down.

Then open https://dev.sandbox.ok.ubc.ca: it asks for the site password, then shows the start screen. Ask for a small program and press ▶ Run (until the EduAI key is in, the tutor can't write code, but ▶ Run works on any .py or .js file you open).

## Later deploys

Push to `web-platform`, then:

```bash
cd /srv/www/vibelearner/web && ./deploy.sh      # --force rebuilds even with no new commit
```

A deploy restarts the app, and sessions live in its memory, so it ends any open session (files and logs stay). Don't deploy while participants are working. After adding the EduAI key to `ecosystem.config.cjs`, run `./deploy.sh --force` so the app picks it up.

## Troubleshooting

* **"Service Unavailable"**: run `pm2 status` and `pm2 logs VibeLearner`, and check that PORT is the same in `ecosystem.config.cjs` and the Apache conf. If `curl http://127.0.0.1:3100/login` gives 200 but the site still shows 503 on a RHEL server, SELinux may be stopping Apache from connecting to the port: `getsebool httpd_can_network_connect`, and if it's off, `sudo setsebool -P httpd_can_network_connect 1`.
* **"The code runner isn't responding"** in the app, or `check:runner` can't list languages: in `web/judge0`, run `sudo docker compose ps` (four services, all up) and `sudo docker compose logs --tail 50 server workers`. `pm2 logs VibeLearner` shows the exact request that failed. `sudo ./setup.sh` again starts whatever isn't running.
* **"The code runner refused the request"**: `JUDGE0_AUTH_TOKEN` doesn't match `AUTHN_TOKEN` in `web/judge0/judge0.conf`.
* **Wrong site password even though it's right**: after changing `SITE_PASSWORD`, run `./deploy.sh --force` (PM2 reads the file only when the app starts). Ten wrong tries lock that browser out for a minute.
* **Node too old**: `sudo npm install n -g`, then `sudo -E env "PATH=$PATH" n lts`, `hash -r`, `node -v`.
* **Permission denied in npm ci or the build**: log out and back in after the group change, and check `groups`.

## Before real participants

* **EduAI key.** Put it in `ecosystem.config.cjs` and run `./deploy.sh --force`.
* **Old language versions in Judge0.** Judge0 CE 1.13.1, the latest release, has Python 3.8 and Node.js 12. Code that uses newer features crashes there even though it works on a current install: in Python, `match`, `list[int]`-style type hints and `str.removeprefix`; in JavaScript, `?.`, `??`, `.at()` and `replaceAll`. The model may well write code like that.
* **Shared computers.** A browser keeps its session for 30 days and there's no "end session" button, so the next person on the same computer continues the previous session, including its participant code. Use a private window per participant, or clear the site's cookies between participants.
