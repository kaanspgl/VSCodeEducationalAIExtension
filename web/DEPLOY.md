# Deploying on S378 (dev.sandbox.ok.ubc.ca)

This is the lab's "Deploying Remix app on Linux server" guide filled in for VibeLearner. Apache already serves dev.sandbox.ok.ubc.ca over HTTPS and forwards it to port 2025, so the app just has to run there; PM2 keeps it running. Participants read the consent form first, then sign in with the code and PIN on their card; the research team uses /admin. Participants' programs run in Judge0 sandboxes in Docker (port 2358), never on the server itself. The model is UBC's EduAI. VibeLearner has no database, so the guide's Prisma and mail steps don't apply.

You need sudo on S378. Run everything below on the server, logged in with your CWL account.

## 1. Check the server

```bash
ssh <cwl>@s378.ok.ubc.ca
cat /etc/os-release              # ID=rhel/centos/fedora: Apache is "httpd". ID=debian/ubuntu: "apache2" (user www-data)
node -v                          # needs v22.22 or newer (see Troubleshooting to upgrade)
sudo docker compose version      # Judge0 needs Docker with Compose v2
sudo ss -tlnp | grep -E ':(2025|2358) '   # no output means both ports are free
sudo apachectl -S | grep -i sandbox   # the site's Apache conf file (on S378: /etc/httpd/conf.d/dev.sandbox.ok.ubc.ca.conf)
```

If `docker compose` isn't there, Docker Engine with the Compose plugin has to be installed first (ask whoever runs S378; RHEL's own Podman isn't a replacement here). If something already listens on 2025, find out whose it is before going on: that's the port the site's Apache conf forwards to (step 7).

## 2. Group and folder

The app goes in its own folder, outside the sandbox site's DocumentRoot: `data/` holds participant logs and `ecosystem.config.cjs` holds the passwords and keys (and `data/participants.json` the codes, with PINs only as hashes), and outside the DocumentRoot Apache can never serve them as plain files. The old sandbox contents can stay or be deleted.

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
cp vibelearner.config.example.json vibelearner.config.json   # optional: model and learning settings
chmod +x deploy.sh judge0/setup.sh
nano ecosystem.config.cjs
```

In `ecosystem.config.cjs`:

* `ADMIN_PASSWORD`: the research team's password for https://dev.sandbox.ok.ubc.ca/admin, where you make participant codes, print their cards and see the results. Pick a long one and don't give it to participants. Changing it signs the team out. Without it the admin pages stay closed.
* `EDUAI_API_KEY`: leave it empty until you have it. The site works without it, but the tutor answers "EduAI API key missing." If EduAI gives you a model name or course code, put them in `VL_MODEL` and in `vibelearner.config.json` (`"courseCode"`).
* `JUDGE0_AUTH_TOKEN`: comes from step 4.
* `PORT` stays 2025, the port S378's Apache conf forwards dev.sandbox to. Change it only on another server.

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
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:2025/login   # 200 means the app is up
```

The script refuses to start until `ADMIN_PASSWORD`, `JUDGE0_URL` and `JUDGE0_AUTH_TOKEN` are filled in, and checks Node. Then it pulls the branch, runs `npm ci` and `npm run build`, (re)starts the app under PM2, saves the process list, and runs a quick Judge0 check (a warning, not a stop, if Judge0 is down). It doesn't touch Apache: a deploy doesn't change Apache's config, and S378's Apache also serves about ten other lab sites that a restart would interrupt.

## 7. Apache

On S378 there's nothing to edit. The site's conf, `/etc/httpd/conf.d/dev.sandbox.ok.ubc.ca.conf`, already forwards everything to `http://localhost:2025/`, where the app runs. Its first line says `# Ansible managed`, so hand edits could be overwritten; leave it as it is. Check the site through Apache from the server:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dev.sandbox.ok.ubc.ca/login   # 200 means Apache reaches the app
```

On another server, put this in the site's `<VirtualHost *:443>` block (or at the top level if there's none), with the app's PORT:

```apache
<Location />
    ProxyPass http://localhost:2025/
    ProxyPassReverse http://localhost:2025/
</Location>
```

Then `sudo apachectl configtest && sudo systemctl reload httpd` (`apache2` on Debian/Ubuntu, after `sudo a2enmod proxy proxy_http`). Reload, don't restart, on a server shared with other sites: a reload doesn't drop their connections, and the `&&` runs it only if the test says "Syntax OK". Also add the site's host name to `allowedActionOrigins` in `react-router.config.ts` and deploy: behind Apache the app sees its own address rather than the browser's, and React Router turns away the sign-in forms from any host not listed there.

The sign-in cookies are marked HTTPS-only whenever the form was posted from an HTTPS page, so Apache doesn't need to pass anything extra.

Then open https://dev.sandbox.ok.ubc.ca/admin, sign in with `ADMIN_PASSWORD` and make a test code. Open https://dev.sandbox.ok.ubc.ca in a private window: it shows the consent form, then asks for the code and PIN. Ask for a small program and press ▶ Run (until the EduAI key is in, the tutor can't write code, but ▶ Run works on any .py or .js file you open). Test codes show up in the results like any other, so before the study starts, stop the app and delete `data/` (it's made again, empty, on the next start).

## Later deploys

Push to `web-platform`, then:

```bash
cd /srv/www/vibelearner/web && ./deploy.sh      # --force rebuilds even with no new commit
```

A deploy restarts the app, and sessions live in its memory, so it ends any open session (files and logs stay). Don't deploy while participants are working. After adding the EduAI key to `ecosystem.config.cjs`, run `./deploy.sh --force` so the app picks it up.

## Troubleshooting

* **"Service Unavailable"**: run `pm2 status` and `pm2 logs VibeLearner`, and check that PORT is the same in `ecosystem.config.cjs` and the Apache conf. If `curl http://127.0.0.1:2025/login` gives 200 but the site still shows 503, `sudo tail -20 /etc/httpd/logs/error_log` says why. On RHEL, SELinux may be stopping Apache from connecting to the port: check `getsebool httpd_can_network_connect`. If it's off, ask the server's admin to turn it on (it applies to every site on the server).
* **"Bad Request" after signing in**: the host in the browser's address bar isn't in `allowedActionOrigins` in `react-router.config.ts`. Add it, push, and deploy.
* **"The code runner isn't responding"** in the app, or `check:runner` can't list languages: in `web/judge0`, run `sudo docker compose ps` (four services, all up) and `sudo docker compose logs --tail 50 server workers`. `pm2 logs VibeLearner` shows the exact request that failed. `sudo ./setup.sh` again starts whatever isn't running.
* **"The code runner refused the request"**: `JUDGE0_AUTH_TOKEN` doesn't match `AUTHN_TOKEN` in `web/judge0/judge0.conf`.
* **Wrong admin password even though it's right**: after changing `ADMIN_PASSWORD`, run `./deploy.sh --force` (PM2 reads the file only when the app starts). Ten wrong tries lock that browser out for a minute; the same goes for participants' PINs.
* **A participant lost their card or pressed Finish by mistake**: on /admin, "New PIN" prints a new PIN for that code (the old one stops working), and "Move" puts them back on a part.
* **Node too old**: `sudo npm install n -g`, then `sudo -E env "PATH=$PATH" n lts`, `hash -r`, `node -v`.
* **Permission denied in npm ci or the build**: log out and back in after the group change, and check `groups`.

## Before real participants

* **EduAI key.** Put it in `ecosystem.config.cjs` and run `./deploy.sh --force`.
* **Old language versions in Judge0.** Judge0 CE 1.13.1, the latest release, has Python 3.8 and Node.js 12. Code that uses newer features crashes there even though it works on a current install: in Python, `match`, `list[int]`-style type hints and `str.removeprefix`; in JavaScript, `?.`, `??`, `.at()` and `replaceAll`. The model may well write code like that.
* **Shared computers.** A browser keeps its session for 30 days and there's no "end session" button, so the next person on the same computer continues the previous session, including its participant code. Use a private window per participant, or clear the site's cookies between participants.
