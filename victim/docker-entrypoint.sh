#!/bin/sh
set -e
cd /app
echo "=== Iniciando creacion de Flags ==="
node init_db.js


echo "=== Esperado 40 seg para iniciarl mails ==="
sleep 40
echo "=== Flags creadas iniciando servidor CTF ==="
npm start