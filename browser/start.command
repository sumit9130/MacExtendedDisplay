#!/bin/bash
# Double-click this file to start MacDisplay.
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Install it from https://www.python.org/downloads/ and try again."
  read -n 1 -s -r -p "Press any key to close"; exit 1
fi

python3 -c "import psutil" 2>/dev/null || {
  echo "Installing psutil (one time)..."
  python3 -m pip install --user psutil || python3 -m pip install --user --break-system-packages psutil
}

# keep the Mac awake while the dashboard runs
caffeinate -d -i &
CAFF=$!
trap "kill $CAFF 2>/dev/null" EXIT

python3 server.py
