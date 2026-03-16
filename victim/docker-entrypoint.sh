#!/bin/sh
set -e
cd /app
echo "=== Iniciando creacion de Flags ==="
node init_db.js
echo "=== Flags creadas iniciando servidor CTF ==="
npm start