#!/usr/bin/env bash
# Ship the website to https://spilvest.is
# Run from the repo root on your own machine:  deploy/deploy.sh
# Zero dependencies, so this is just: copy files, restart.
set -euo pipefail
cd "$(dirname "$0")/.."
rsync -az --delete \
  --exclude .git --exclude data --exclude originals --exclude node_modules --exclude .env \
  ./ stjornbord:/srv/spilafelag-vefur/
ssh stjornbord 'chown -R root:root /srv/spilafelag-vefur && systemctl restart spilafelag-vefur && sleep 1 && systemctl is-active spilafelag-vefur'
echo "→ https://spilvest.is/"
