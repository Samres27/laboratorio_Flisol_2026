import os
import datetime
from flask import Flask, request, session
from database import init_db, get_db
from blueprints.auth import auth_bp
from blueprints.admin import admin_bp
from blueprints.posts import posts_bp
from blueprints.log import log_bp

PID = os.getpid()


def _now_ts():
    t = datetime.datetime.now()
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}"


def create_app():
    app = Flask(__name__)
    app.config.from_object("config")

    with app.app_context():
        init_db(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(posts_bp)
    app.register_blueprint(log_bp)

    @app.after_request
    def write_access_log(response):
        if request.path == "/log":
            return response
        try:
            db = get_db()
            db.execute(
                "INSERT INTO access_log (ts, method, path, status, username, ip, pid) VALUES (?,?,?,?,?,?,?)",
                (
                    _now_ts(),
                    request.method,
                    request.path,
                    response.status_code,
                    session.get("username"),
                    request.remote_addr or "127.0.0.1",
                    PID,
                ),
            )
            db.commit()
        except Exception:
            pass
        return response

    return app



app = create_app()
