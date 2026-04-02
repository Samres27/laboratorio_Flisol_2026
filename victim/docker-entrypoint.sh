#!/bin/sh
set -e
cd /app
echo "=== Iniciando creacion de Flags ==="
node init_db.js


echo "=== Esperado 60 seg para iniciarl mails ==="
sleep 60
echo "=== Flags creadas iniciando servidor CTF ==="
npm start