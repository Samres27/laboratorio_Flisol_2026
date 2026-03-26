#!/bin/sh
set -e

echo "=== Iniciando Gunicorn (Flask) en puerto 80 ==="
cd /app
# gunicorn --keep-alive 10 \
#     -k gevent \
#     -w 4 \
#     -b 0.0.0.0:80 \
#     app:app \
#     --log-level debug \
#     --access-logfile /dev/null \
#     --error-logfile - \
#     --capture-output \
#     --enable-stdio-inheritance
gunicorn \
    -k gevent \
    -w 1 \
    -b 0.0.0.0:80 \
    app:app \
    --log-level info \
    --access-logfile - \
    --error-logfile - \
    --capture-output \
    --enable-stdio-inheritance