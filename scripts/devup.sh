#!/bin/bash
# Ensures the Next.js dev server on :3000 is up (starts it if needed).
cd /home/z/my-project
if curl -s -o /dev/null --max-time 3 http://localhost:3000/api/overview; then
  exit 0
fi
setsid nohup bun run dev </dev/null >/dev/null 2>&1 &
for i in $(seq 1 60); do
  sleep 2
  if curl -s -o /dev/null --max-time 3 http://localhost:3000/api/overview; then
    exit 0
  fi
done
echo "dev server failed to start" >&2
exit 1
