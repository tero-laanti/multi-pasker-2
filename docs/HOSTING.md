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

## A name of your own, over HTTPS (optional)

Players can open a name such as `https://play-mp2.laanti.fi` instead of the address. Once it is
set up, `npm start` also:

- points the name at the host's address on the network through Route 53;
- gets a free Let's Encrypt certificate for the name and renews it, using a DNS challenge, so
  nothing on the internet needs to reach the host;
- serves the game at `https://<name>` beside the address, and checks that the name reaches the
  host with a trusted certificate. Once the check passes, the phones' QR codes use the name too.

It needs a domain whose DNS is in Route 53. It is HTTPS because Chrome asks before opening a
plain-http page on a public name. It doesn't ask for the address, or for HTTPS. Without the setup
nothing changes.

### 1. An access key for the zone

The key may change only the two records the server needs, `play-mp2.laanti.fi` (A) and
`_acme-challenge.play-mp2.laanti.fi` (TXT), in one hosted zone.

1. In the AWS console, open **Route 53 → Hosted zones →** the domain (`laanti.fi`) and copy its
   **Hosted zone ID** (it starts with `Z`).
2. Print the policy with the zone ID and the name filled in:
   `npm run https:policy -- --zone YOUR_ZONE_ID --domain play-mp2.laanti.fi`
   (after the setup, `npm run https:policy` alone).
3. Open **IAM → Policies → Create policy**, choose **JSON**, paste the policy and name it `mp2-host`.
   `GetChange` can't be limited to one zone; it only reads whether a change has reached every Route 53 server.
4. Open **IAM → Users → Create user**, name it `mp2-host`, leave console access off, and attach
   the `mp2-host` policy directly.
5. On the new user, open **Security credentials → Create access key**, choose **Application
   running outside AWS**, and keep the access key ID and secret for the setup.

### 2. Setup

```bash
npm run https:setup
```

It asks for the name (`play-mp2.laanti.fi` unless you type another), the zone ID, the access key
ID and the secret (hidden as you type), and stores them in the state folder below. Run it again to
change them. With the key left empty, the server uses the AWS SDK's own credentials (environment
variables or `~/.aws`).

### 3. Start

`npm start` as usual. With a certificate in hand it prints:

```
 Players: open  https://play-mp2.laanti.fi/  in Chrome or Edge
 If it does not open:  http://192.168.1.23:8088/
```

and then `[https]` lines: the name pointed at the host (up to a minute), the certificate, and
`Check passed`. On the first start getting the certificate takes about a minute, and players use
the address until then. The first start also registers with Let's Encrypt, which accepts its
[subscriber agreement](https://letsencrypt.org/repository/). Allow incoming connections for `node`
if the firewall asks. Port 443 needs no administrator rights on macOS or Windows; elsewhere use
`--https-port 8443`, and players add `:8443` to the name. If port 80 is free, `http://<name>`
redirects to `https://<name>`.

| Option | Use |
| --- | --- |
| `--no-https` | Serve only the address, even when set up. |
| `--staging` | Practise with Let's Encrypt's staging service. Browsers don't trust its certificates. |
| `--https-port 8443` | Serve HTTPS on another port. |
| `--https` | Use the name with `npm run dev` too (off there by default). |
| `--local-https` | Test HTTPS on this computer only, at `https://localhost:8443/`, with a self-signed certificate and no AWS or Let's Encrypt. |

### At the venue

- Start the server at home in the week before the party. The certificate lasts for weeks, so the
  server starts at the venue even without internet. Only the name's address can't change there,
  so players use the address instead.
- A name looked up before it first pointed anywhere stays unknown on that network for up to 15
  minutes (DNS remembers the miss). The check keeps trying, and phones switch to the name once it
  passes. The record stays after the server stops, so this happens only on the first start.
- Some routers refuse public names that point to local addresses (DNS rebinding protection). The
  check reports it. Allow the name in the router's DNS rebinding settings, or players use the address.
- To the browser the name and the address are different sites, so player names, settings and the
  finished training are saved separately for each.

### The state folder

The settings with the Route 53 secret, the Let's Encrypt account key and the certificates are in
`~/Library/Application Support/MultiPasker2` on a Mac, `%AppData%\MultiPasker2` on Windows and
`~/.config/multi-pasker-2` elsewhere (`PASKER_STATE` sets another folder). Only your user can read
it, so keep it on your own computers. To host from another computer, copy the folder to the same
place on it: the setup and the certificate come along.

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
