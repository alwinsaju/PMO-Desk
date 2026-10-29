#!/bin/bash
# usage: run.sh scenario.mjs [args]   (host run; CDP port 9333)
export QA_CDP_PORT=${QA_CDP_PORT:-9333}
export QA_RESULTS="C:/Projects/AI OS/docs/qa/evidence/host-run-1"
export QA_SHOTS="$QA_RESULTS/shots"
node "$@"
