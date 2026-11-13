#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting deployment workflow..."

# 1. Stop existing process if running
if [ -f "./stop.sh" ]; then
  ./stop.sh
else
  echo "⚠️ stop.sh not found, checking port 3000 directly..."
  PORT=3000
  PID=$(lsof -ti :$PORT)
  if [ ! -z "$PID" ]; then
    kill -15 $PID 2>/dev/null || true
    sleep 2
  fi
fi

# 2. Rebuild code (Install dependencies, generate Prisma client, and build Next.js)
echo "📦 Installing dependencies..."
npm install

echo "⚙️ Generating Prisma Client..."
npx prisma generate

echo "🔨 Building project..."
npm run build

# 3. Start the project (using production mode 'npm start' or pm2/nohup)
echo "🌟 Starting the project..."
# Uncomment whichever method you prefer:

# Option A: Run in background using nohup (saves output to logs)
nohup npm start > app.log 2>&1 &
echo "✅ Project started in the background! Logs are writing to app.log (PID: $!)"

# Option B: Run via PM2 (Recommended for production servers if installed)
# pm2 start npm --name "my-app" -- start