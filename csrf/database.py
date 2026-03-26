import sqlite3
import hashlib
import os
import datetime
from flask import g, current_app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(app):
    app.teardown_appcontext(close_db)
    with app.app_context():
        db = get_db()
        with app.open_resource("schema.sql") as f:
            db.executescript(f.read().decode("utf8"))
        db.commit()
        _seed_admin(db)


def _seed_admin(db):
    exists = db.execute("SELECT id FROM users WHERE username='admin'").fetchone()
    if not exists:
        pw = hash_password("admin123")
        db.execute(
            "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
            ("admin", pw, "admin"),
        )
        db.commit()
        _seed_fake_logs(db)


def _seed_fake_logs(db):
    """
    Siembra usuarios ficticios y su actividad historica en access_log.
    Se ejecuta una sola vez al crear la base de datos.
    """
    pid = os.getpid()
    now = datetime.datetime.now()

    def ts(delta_m, delta_s=0):
        t = now - datetime.timedelta(minutes=delta_m, seconds=delta_s)
        return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}"

    # Crear escritores ficticios
    fake_writers = [
        ("mrodriguez", "pollo1234"),
        ("lperez",     "casa1234"),
        ("agarcia",    "prado1234"),
    ]
    for username, password in fake_writers:
        exists = db.execute(
            "SELECT id FROM users WHERE username=?", (username,)
        ).fetchone()
        if not exists:
            db.execute(
                "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
                (username, hash_password(password), "writer"),
            )
    db.commit()

    entries = [
        # arranque
        
        # agarcia — primer intento fallido
        (ts(90),      "GET",  "/login",           200, None,          "10.0.0.19",     pid),
        (ts(89, 50),  "POST", "/login",           302, None,          "10.0.0.19",     pid),
        (ts(89, 48),  "GET",  "/login",           200, None,          "10.0.0.19",     pid),
        (ts(89, 20),  "POST", "/login",           302, "mrodriguez",     "10.0.0.19",     pid),
        (ts(89, 18),  "GET",  "/my-posts",        200, "mrodriguez",     "10.0.0.19",     pid),
        (ts(88, 30),  "GET",  "/post/create",     200, "mrodriguez",     "10.0.0.19",     pid),
        (ts(88),      "POST", "/post/create",     302, "mrodriguez",     "10.0.0.19",     pid),
        (ts(87),      "GET",  "/logout",          302, "mrodriguez",     "10.0.0.19",     pid),
        # visitas anonimas al feed
        (ts(60),      "GET",  "/feed",            200, None,          "192.168.1.88",  pid),
        (ts(45),      "GET",  "/feed",            200, None,          "10.0.0.31",     pid),
        (ts(30),      "GET",  "/feed",            200, None,          "192.168.1.42",  pid),
    ]

    db.executemany(
        """INSERT INTO access_log (ts, method, path, status, username, ip, pid)
           VALUES (?,?,?,?,?,?,?)""",
        entries,
    )
    db.commit()

    fake_tokens = [
        ("mrodriguez", hashlib.sha256(b"seed-mrodriguez").hexdigest()),
    ]
    for username, token in fake_tokens:
        user = db.execute(
            "SELECT id FROM users WHERE username=?", (username,)
        ).fetchone()
        if user:
            db.execute(
                """INSERT INTO user_tokens (user_id, csrf_token, updated_at)
                   VALUES (?, ?, datetime('now'))
                   ON CONFLICT(user_id) DO UPDATE
                   SET csrf_token=excluded.csrf_token,
                       updated_at=excluded.updated_at""",
                (user["id"], token),
            )
    db.commit()


# VULNERABLE: SHA-256 sin salt
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()
