# Hosting a LAN party

One computer runs the game for everyone; players need only a desktop browser and their own phone on the same network. How to play is in [PLAYING.md](PLAYING.md).

## Requirements

- **Host machine:** macOS or Windows with [Node.js](https://nodejs.org/) 22.12 or newer (24 LTS recommended).
- **Players:** a desktop browser, Chrome or Edge (Firefox best effort), and a phone (iPhone Safari or
  Android Chrome), all on the same network as the host. No app to install.
- Everything is bundled: nothing is loaded from the internet while playing.

## Install and start

```bash
npm install
```

```bash
npm start
```

`npm start` builds the client and starts the server on port 8088. It prints the address
players should open, for example:

```
 Players: open  http://192.168.1.23:8088/  in Chrome or Edge
```

On the host machine itself you can also use `http://localhost:8088/`.

### Choosing the address and port

The server picks the host's Wi-Fi/Ethernet address and ignores VPN, WSL, Docker, VirtualBox
and VMware adapters. If it picks the wrong one (it also lists the alternatives), override it:

```bash
npm start -- --host 192.168.1.23 --port 8088
```

or set the environment variables `PASKER_HOST` and `PASKER_PORT`.

## Troubleshooting

- **Other computers can't connect (Windows host):** Windows Firewall blocks Node.js on networks
  marked *Public*. Either mark the network *Private* (Settings → Network & internet → Wi-Fi →
  the network → Network profile type → Private) or allow Node.js through the firewall when Windows asks.
  On macOS, allow incoming connections for `node` if prompted.
- **Guest Wi-Fi:** many routers' guest networks isolate clients from each other, so nobody can
  reach the host. Use the main network, or a dedicated router/hotspot for the party.
- **Wrong address printed:** VPN clients (Tailscale, corporate VPNs) and virtual adapters can
  confuse the choice; use `--host` with the address shown in the Wi-Fi settings.
- **Phone can't open the link or keeps reconnecting:** the phone must be on the same Wi-Fi as the
  host (not mobile data, not a guest network). If the QR code is missing, the server could not
  find its LAN address; start it with `--host <address>`.
- **Phone screen dims or locks:** tap **Start** on the phone after (re)loading the page; it plays a
  tiny silent video that keeps the screen on. Low Power Mode on iPhone can still lock the screen.
- **Mouse doesn't lock / look feels accelerated:** click the game view. The first click after
  Esc needs about a second (browser rule). *Raw input* is on by default; if the browser doesn't
  support it the game falls back to normal pointer lock (F3 shows which).
- **No sound:** browsers start audio only after a click or key press; click the game once.
- **Low frame rate on a laptop:** Settings → Graphics quality → *Low*, and lower
  *Render resolution*. Plug the laptop in; Chrome's frame rate drops on battery. (The first
  start already picks the quality from the graphics chip: *Medium* for graphics built into the
  processor, *Low* for software rendering, *High* otherwise; a choice made in the settings stays.)

## The web version (mp2.laanti.fi)

The game is made for a LAN, but a browser-only taste of it can go on a website: `npm run build:web`
builds it into `dist-web/`, static files with no game server. Both versions come from the same
code, so develop as usual: `npm start` builds the LAN version, `npm run deploy:web` the web one.
What differs sits behind one switch, `WEB` in [src/client/web.ts](../src/client/web.ts). In the web version:

- **Bot match** replaces *Join game*: the game server runs inside the page (the same server code,
  started by `src/client/local/`) with 7 bots (`WEB_MATCH` in `config.ts`). A first bot match
  starts with the training, as on a LAN.
- The phone is the virtual one: the pairing panels offer only *Open a virtual phone*, which
  connects to the server in the page. Voice notes are spliced in the page from clips on the site.
- The main menu says the game is made for a LAN party and links to this repository.
- Tools that need the server machine are left out (saving tuning to `config.ts`, the phone
  simulator), and the evening scoreboard is kept in the browser.

Both versions' pages have a favicon and link-preview tags (a description, and the card
`og-image.jpg` with the title and a phone chat), so a shared link shows the game. They are in
`public/`, copied as they are to the build's root; the preview tags point at mp2.laanti.fi.

`npm run preview:web` serves the build at http://localhost:8100/, and `tools/e2e/web-flow.ts`
tests it in Chrome.

**Deploying** is a manual step from your own machine; nothing runs on push. The Terraform
configuration in `deploy/aws/` puts `dist-web/` in a private S3 bucket behind CloudFront at
https://mp2.laanti.fi, with its certificate and DNS records in the laanti.fi Route 53 zone. It
needs AWS credentials on the machine for the account that holds that zone: preferably a user of
its own with only [deploy/aws/iam-policy.json](../deploy/aws/iam-policy.json), which limits it to
the site's own buckets and to DNS records under mp2.laanti.fi.

The first time on a machine:

```bash
terraform -chdir=deploy/aws init
```

Then every deploy is one command. It runs the type check and the tests, builds the web version,
and shows Terraform's plan; nothing changes until you type `yes`:

```bash
npm run deploy:web
```

Only the files that changed are uploaded. Pages are checked on every load; sounds can take up to
an hour to update. Terraform records what it created in `deploy/aws/terraform.tfstate` on the
machine that deployed (not in git), so deploy from that machine.
