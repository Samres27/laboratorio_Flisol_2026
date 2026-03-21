import os
from flask import Blueprint, Response
from database import get_db

log_bp = Blueprint("log", __name__)

PID = os.getpid()


@log_bp.route("/log")
def server_log():
    db = get_db()

    # Tokens reales indexados por username
    tokens = {}
    for row in db.execute("SELECT u.username, t.csrf_token, t.updated_at FROM user_tokens t JOIN users u ON u.id = t.user_id"):
        tokens[row["username"]] = (row["csrf_token"], row["updated_at"])

    rows = db.execute(
        "SELECT ts, method, path, status, username, ip, pid FROM access_log ORDER BY id ASC"
    ).fetchall()

    lines = []
    for r in rows:
        user_part = f" user={r['username']}" if r["username"] else ""
        lines.append(
            f"{r['ts']} [INFO ] pid={r['pid']} werkzeug     "
            f"{r['ip']} - \"{r['method']} {r['path']} HTTP/1.1\" {r['status']} -{user_part}"
        )

        # Inyectar lineas DEBUG del token despues de cada GET /post/create autenticado
        if r["method"] == "GET" and r["path"] == "/post/create" and r["username"]:
            username = r["username"]
            if username in tokens:
                token, tok_ts = tokens[username]
                lines.append(
                    f"{tok_ts} [DEBUG] pid={PID} session      "
                    f"csrf_token generated: user_id=- username={username} token={token}"
                )
                lines.append(
                    f"{tok_ts} [DEBUG] pid={PID} session      "
                    f"token persisted to user_tokens (no expiry, no rotation)"
                )

    if not lines:
        lines.append("(no log entries yet)")

    return Response("\n".join(lines) + "\n", mimetype="text/plain; charset=utf-8")
