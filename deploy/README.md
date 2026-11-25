# Test copy on stjornbord.emlinn.is

While the board tests the site, it runs beside the dashboard on the same
server, at **https://stjornbord.emlinn.is/heimasida/**, and only people logged
into the dashboard can open it (nginx `auth_request` → dashboard `/api/auth/me`).
The dashboard has a "Heimasíða" link to it. Temporary: when the site gets its
own domain, drop `BASE_PATH` and give it its own nginx server block.

| What | Where on the server |
|---|---|
| code | `/srv/spilafelag-vefur` (root-owned, read-only to the service) |
| service | `spilafelag-vefur.service`, user `spilafelag-vefur`, 127.0.0.1:3200 |
| settings | `/etc/spilafelag-vefur/env` (see `env.example`) |
| database | `/var/lib/spilafelag-vefur/vefur.db` — its own, separate from the dashboard's |
| nginx | `/etc/nginx/snippets/heimasida.conf`, included in the HTTPS block of `sites-available/stjornbord.emlinn.is` |

**Update:** `deploy/deploy.sh` from the repo root.

**Approve an applicant** (on the server):

    ssh stjornbord
    cd /srv/spilafelag-vefur && sudo -u spilafelag-vefur env DB_PATH=/var/lib/spilafelag-vefur/vefur.db node scripts/felagar.js listi
    sudo -u spilafelag-vefur env DB_PATH=/var/lib/spilafelag-vefur/vefur.db node scripts/felagar.js samthykkja someone@example.is

**Logs:** `journalctl -u spilafelag-vefur -f`
