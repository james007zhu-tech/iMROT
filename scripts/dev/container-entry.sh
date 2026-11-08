#!/usr/bin/env bash
# Entry point of the dev container (docker-compose.dev.yml).
#
# Starts `next dev` and then watches .dev-ops/ for trigger files, so the app can be operated
# by writing files into the repo (no terminal on the host needed):
#   .dev-ops/restart   -> npm install, prisma generate, prisma db push, restart next dev
#   .dev-ops/seed      -> prisma/seed.ts
#   .dev-ops/trial     -> prisma/trial.ts (prints the trial passwords to .dev-ops/trial.out)
#   .dev-ops/fx        -> fetch Bank of China rates
#   .dev-ops/smoke     -> scripts/smoke.ts (output in .dev-ops/smoke.out)
#   .dev-ops/cmd       -> runs the single shell line inside the file (output in .dev-ops/cmd.out)
# Each trigger is deleted after it ran; .dev-ops/log holds the running log.
set -uo pipefail
cd /app
OPS=.dev-ops
mkdir -p "$OPS"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$OPS/log"; }

setup() {
  log "npm install"
  npm install --no-audit --no-fund >>"$OPS/log" 2>&1 || log "npm install FAILED"
  log "prisma generate"
  npx prisma generate >>"$OPS/log" 2>&1 || log "prisma generate FAILED"
  log "prisma db push"
  local out rc
  out=$(npx prisma db push --skip-generate 2>&1); rc=$?
  echo "$out" >>"$OPS/log"
  # Prisma refuses to add a unique constraint to a table that already has rows unless --accept-data-loss is given.
  # A new unique constraint cannot lose data (it fails if duplicates exist), so retry only when that is the sole warning.
  if [ $rc -ne 0 ] && echo "$out" | grep -q "A unique constraint covering" && ! echo "$out" | grep -qiE "drop|be lost|delete|cast|required column"; then
    log "prisma db push: only new unique constraints flagged, retrying with --accept-data-loss"
    npx prisma db push --skip-generate --accept-data-loss >>"$OPS/log" 2>&1 || log "prisma db push FAILED"
  elif [ $rc -ne 0 ]; then
    log "prisma db push FAILED"
  fi
}

start_app() {
  log "starting next dev"
  # Values from .env were fixed when the container was created (env_file), so a key added to .env later never
  # arrived. Drop them for next dev, which then reads the current .env on every restart; DATABASE_URL stays
  # because compose points it at the db container.
  local unset_args=()
  for k in $(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env 2>/dev/null | tr -d '='); do
    [ "$k" != DATABASE_URL ] && unset_args+=(-u "$k")
  done
  env "${unset_args[@]}" npx next dev -H 0.0.0.0 -p "${PORT:-3000}" >>"$OPS/app.log" 2>&1 &
  APP_PID=$!
}

stop_app() {
  if [ -n "${APP_PID:-}" ] && kill -0 "$APP_PID" 2>/dev/null; then
    log "stopping next dev ($APP_PID)"
    kill "$APP_PID" 2>/dev/null; wait "$APP_PID" 2>/dev/null
  fi
  pkill -f "next dev" 2>/dev/null || true
}

trap 'stop_app; exit 0' TERM INT

setup
# seed once on an empty database
if [ "$(npx tsx -e 'import {prisma} from "./src/lib/db"; prisma.legalEntity.count().then(n=>{console.log(n);process.exit(0)})' 2>/dev/null | tail -1)" = "0" ]; then
  log "empty database: seeding"
  npx tsx prisma/seed.ts >>"$OPS/log" 2>&1 || log "seed FAILED"
fi
start_app

while true; do
  sleep 5
  if [ -f "$OPS/restart" ]; then
    rm -f "$OPS/restart"; stop_app; setup; start_app; log "restart done"
  fi
  if [ -f "$OPS/seed" ]; then
    rm -f "$OPS/seed"; log "seed"; npx tsx prisma/seed.ts >"$OPS/seed.out" 2>&1; log "seed done"
  fi
  if [ -f "$OPS/trial" ]; then
    rm -f "$OPS/trial"; log "trial seed"; npx tsx prisma/trial.ts >"$OPS/trial.out" 2>&1; chmod 600 "$OPS/trial.out"; log "trial seed done"
  fi
  if [ -f "$OPS/fx" ]; then
    rm -f "$OPS/fx"; log "fx fetch"; npx tsx src/jobs/fetch-boc-rates.ts >"$OPS/fx.out" 2>&1; log "fx done"
  fi
  if [ -f "$OPS/smoke" ]; then
    rm -f "$OPS/smoke"; log "smoke"; npx tsx scripts/smoke.ts >"$OPS/smoke.out" 2>&1 && log "smoke PASSED" || log "smoke FAILED"
  fi
  if [ -f "$OPS/cmd" ]; then
    CMD="$(head -1 "$OPS/cmd")"; rm -f "$OPS/cmd"; log "cmd: $CMD"
    bash -c "$CMD" >"$OPS/cmd.out" 2>&1; echo "exit=$?" >>"$OPS/cmd.out"; log "cmd done"
  fi
  if [ -n "${APP_PID:-}" ] && ! kill -0 "$APP_PID" 2>/dev/null; then
    log "next dev exited; restarting"; start_app
  fi
done
