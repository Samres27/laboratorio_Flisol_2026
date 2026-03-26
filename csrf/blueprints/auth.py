from flask import (
    Blueprint, render_template, request,
    redirect, url_for, session, flash
)
from database import get_db, hash_password

auth_bp = Blueprint("auth", __name__)


def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("auth.login"))
        return f(*args, **kwargs)
    return decorated

def require_role(*roles):
    from functools import wraps
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if "user_id" not in session:
                return redirect(url_for("auth.login"))
            if session.get("role") not in roles:
                return render_template("403.html"), 403
            return f(*args, **kwargs)
        return decorated
    return decorator

def require_role_vuln(*roles):
    from functools import wraps
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if (not request.cookies.get('func_vuln')):
                if "user_id" not in session:
                    return redirect(url_for("auth.login"))
                if session.get("role") not in roles:
                    return render_template("403.html"), 403
                return f(*args, **kwargs)
        return decorated
    return decorator


@auth_bp.route("/")
def index():
    return redirect(url_for("posts.public_feed"))


# VULNERABLE: formulario de login sin protección CSRF
@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        db = get_db()
        user = db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user and user["password"] == hash_password(password):
            if user["banned"]:
                flash("Your account has been suspended.", "error")
                return redirect(url_for("auth.login"))
            session.clear()
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["role"] = user["role"]

            if user["role"] == "admin":
                return redirect(url_for("admin.dashboard"))

            import hashlib, os
            token = hashlib.sha256(os.urandom(16)).hexdigest()
            db.execute(
                """INSERT INTO delete_tokens (user_id, token, updated_at)
                   VALUES (?, ?, datetime('now'))
                   ON CONFLICT(user_id) DO UPDATE
                   SET token=excluded.token, updated_at=excluded.updated_at""",
                (user["id"], token),
            )
            db.commit()
            session["_delete_token"] = token  # el after_request lo lee para emitir la cookie

            return redirect(url_for("posts.my_posts"))
        flash("Incorrect credentials.", "error")
    return render_template("auth/login.html")


# VULNERABLE: registro sin protección CSRF
@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        db = get_db()
        existing = db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            flash("The username already exists.", "error")
            return redirect(url_for("auth.register"))
        if len(username) < 3 or len(password) < 4:
            flash("Minimum username 3 characters, minimum password 4.", "error")
            return redirect(url_for("auth.register"))
        db.execute(
            "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
            (username, hash_password(password), "writer"),
        )
        db.commit()
        flash("Account created. Log in.", "success")
        return redirect(url_for("auth.login"))
    return render_template("auth/register.html")


@auth_bp.route("/logout")
def logout():
    return redirect(url_for("auth.login"))
