#!/bin/bash

# Configuration: Update PORT if your app runs on a different port (default: 3000)
PORT=3000

echo "🔍 Checking for running processes on port $PORT..."

# Find PID running on the port
PID=$(lsof -ti :$PORT)

if [ -z "$PID" ]; then
  # Fallback: check by node process running Next.js
  PID=$(pgrep -f "next-server")
fi

if [ -z "$PID" ]; then
  echo "✅ No running process found."
else
  echo "🛑 Stopping process (PID: $PID)..."
  kill -15 $PID 2>/dev/null
  
  # Wait up to 5 seconds for graceful shutdown, then force kill if necessary
  for i in {1..5}; do
    if ! kill -0 $PID 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if kill -0 $PID 2>/dev/null; then
    echo "⚠️ Process didn't stop gracefully, forcing termination..."
    kill -9 $PID 2>/dev/null
  fi

  echo "✅ Application stopped successfully."
fi