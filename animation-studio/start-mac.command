#!/bin/bash
# Dwuklik na Macu: instaluje, co trzeba (tylko za pierwszym razem) i uruchamia aplikację.
cd "$(dirname "$0")" || exit 1
if ! command -v brew >/dev/null 2>&1; then
  echo "Brakuje Homebrew. Instaluję (poprosi o hasło do Maca)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || exit 1
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
fi
command -v node >/dev/null 2>&1 || brew install node
command -v python3 >/dev/null 2>&1 || brew install python@3.12
[ -d node_modules ] || npm install || exit 1
[ -d .venv ] || npm run setup || exit 1
[ -d "/Applications/Google Chrome.app" ] || [ -d "/Applications/Chromium.app" ] || [ -d "/Applications/Microsoft Edge.app" ] || brew install --cask google-chrome
echo "Start aplikacji. Zamknij to okno, żeby ją wyłączyć."
npm run app
