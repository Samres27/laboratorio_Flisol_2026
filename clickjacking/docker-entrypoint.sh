#!/bin/sh
set -e

echo "=== Iniciando Gunicorn (Flask) en puerto 443 (HTTPS) ==="
cd /app
gunicorn \
    -k gevent \
    -w 1 \
    -b 0.0.0.0:443 \
    --certfile /app/cert.pem \
    --keyfile  /app/key.pem \
    app:app \
    --log-level info \
    --access-logfile - \
    --error-logfile - \
    --capture-output \
    --enable-stdio-inheritance