#!/bin/bash
set -e

echo "=== Iniciando Gunicorn (Flask) en puerto 8000 ==="
cd /app
gunicorn --keep-alive 10 \
    -k gevent \
    -w 4 \
    -b 0.0.0.0:8000 \
    app:app
