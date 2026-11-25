# Production: spilvest.is

The site runs on the same DigitalOcean server as the board dashboard
(`ssh stjornbord`, 157.230.179.164). DNS is at ISNIC: A records for
`spilvest.is`, `www` and `stjorn` all point at that server.

| Address | What |
|---|---|
| https://spilvest.is | this website (public) |
| https://www.spilvest.is | redirects to spilvest.is |
| https://stjorn.spilvest.is | the board dashboard — decides who is a member |
| stjornbord.emlinn.is | old dashboard address; redirects to stjorn.spilvest.is (`/heimasida/…` → spilvest.is) |

| What | Where on the server |
|---|---|
| code | `/srv/spilafelag-vefur` (root-owned, read-only to the service) |
| service | `spilafelag-vefur.service`, user `spilafelag-vefur`, 127.0.0.1:3200 |
| settings | `/etc/spilafelag-vefur/env` (see `env.example`) |
| database | `/var/lib/spilafelag-vefur/vefur.db` — logins only; applications live in the dashboard |
| nginx | `/etc/nginx/sites-available/spilvest.is` (= `nginx-spilvest.conf` + certbot's TLS lines) |

**Update:** `deploy/deploy.sh` from the repo root.

**Membership** is approved in the dashboard (Umsóknir), not here. See
"Membership and the board dashboard" in the main README.

**Logs:** `journalctl -u spilafelag-vefur -f`
