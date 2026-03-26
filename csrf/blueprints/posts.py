import os
import hashlib
from flask import (
    Blueprint, render_template, request,
    redirect, url_for, session, flash, abort, make_response
)
from database import get_db
from blueprints.auth import require_role, require_role_vuln
import logging 

posts_bp = Blueprint("posts", __name__)


# ── HELPER: token CSRF estático ──────────────────────────────────

def _get_static_csrf_token():
   
    user_id = session.get("user_id")

    db_token = None
    if user_id:
        row = get_db().execute(
            "SELECT csrf_token FROM user_tokens WHERE user_id=?", (user_id,)
        ).fetchone()
        db_token = row["csrf_token"] if row else None

    if db_token:
        session["csrf_token"] = db_token
        return db_token

    token = session.get("csrf_token") or hashlib.sha256(os.urandom(32)).hexdigest()
    session["csrf_token"] = token

    if user_id:
        get_db().execute(
            """INSERT INTO user_tokens (user_id, csrf_token, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(user_id) DO UPDATE
               SET csrf_token=excluded.csrf_token,
                   updated_at=excluded.updated_at""",
            (user_id, token),
        )
        get_db().commit()

    return token


def _check_static_csrf_token():
    
    form_token = request.form.get("csrf_token", "")
    if not form_token:
        abort(403)
    session_token = session.get("csrf_token", "")
    if session_token and form_token == session_token:
        return  
    
    if session.get("user_id"):
        row = get_db().execute(
            "SELECT csrf_token FROM user_tokens WHERE user_id=?",
            (session["user_id"],)
        ).fetchone()
        if row and form_token == row["csrf_token"]:
            session["csrf_token"] = row["csrf_token"]  
            return  # OK

    abort(403)


def _check_referer():
    referer = request.headers.get("Referer", "")
    if ("localhost" not in referer):# or en el dominio del contenedor docker
        abort(403)
    


# ── COOKIE delete_token ──────────────────────────────────────────
#
# VULNERABILIDAD 2: la cookie se emite con SameSite=Lax pero el
# endpoint de delete acepta GET además de POST.


def _set_delete_cookie(response):
    user_id = session.get("user_id")
    token = hashlib.sha256(os.urandom(16)).hexdigest()

    if user_id:
        db = get_db()
        db.execute(
            """INSERT INTO delete_tokens (user_id, token, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(user_id) DO UPDATE
               SET token=excluded.token, updated_at=excluded.updated_at""",
            (user_id, token),
        )
        db.commit()

    response.set_cookie(
        "delete_token",
        value=token,
        samesite="Lax",  
        httponly=False,
        secure=False,
        max_age=3600,
    )


@posts_bp.after_request
def attach_delete_cookie(response):
    if session.get("role") != "writer":
        return response

    preset = session.pop("_delete_token", None)
    if preset:
        response.set_cookie(
            "delete_token",
            value=preset,
            samesite="Lax",
            httponly=False,
            secure=False,
            max_age=3600,
        )
    elif "delete_token" not in request.cookies:
        _set_delete_cookie(response)

    return response


# ── RUTAS PÚBLICAS ───────────────────────────────────────────────

@posts_bp.route("/feed")
def public_feed():
    db = get_db()
    posts = db.execute(
        """SELECT p.*, u.username FROM posts p
           JOIN users u ON u.id = p.author_id
           WHERE p.published=1 ORDER BY p.created_at DESC"""
    ).fetchall()
    return render_template("posts/feed.html", posts=posts)


@posts_bp.route("/post/<int:post_id>")
def view_post(post_id):
    db = get_db()
    post = db.execute(
        """SELECT p.*, u.username FROM posts p
           JOIN users u ON u.id = p.author_id
           WHERE p.id=?""", (post_id,)
    ).fetchone()
    if not post:
        abort(404)
    if not post["published"] and session.get("user_id") != post["author_id"]:
        abort(403)
    return render_template("posts/detail.html", post=post)

@posts_bp.before_request
def log_cookies():
    print(session)
    print("Request cookies:", request.cookies)

@posts_bp.route("/my-posts")
@require_role("writer")
def my_posts():
    db = get_db()
    posts = db.execute(
        "SELECT * FROM posts WHERE author_id=? ORDER BY created_at DESC",
        (session["user_id"],)
    ).fetchall()
    return render_template("posts/my_posts.html", posts=posts)


# ── VULNERABILIDAD 1: Token CSRF estático ───────────────────────

@posts_bp.route("/post/create", methods=["GET", "POST"])
@require_role_vuln("writer")
def create_post():
    csrf_token = _get_static_csrf_token()

    if request.method == "POST":
        _check_static_csrf_token()

        title     = request.form.get("title", "").strip()
        body      = request.form.get("body", "").strip()
        
        published = 1 if int(request.form.get("published")) else 0

        if not title or not body:
            flash("Título y contenido son obligatorios.", "error")
            return redirect(url_for("posts.create_post"))

        db = get_db()
        db.execute(
            "INSERT INTO posts (title, body, author_id, published) VALUES (?,?,?,?)",
            (title, body, session["user_id"], published),
        )
        db.commit()
        flash("Post created.", "success")
        return redirect(url_for("posts.my_posts"))

    return render_template("posts/create.html", csrf_token=csrf_token)


# ── VULNERABILIDAD 2: Cookie SameSite=Lax + endpoint acepta GET ─

@posts_bp.route("/post/delete/<int:post_id>", methods=["GET", "POST"])
@require_role("writer")
def delete_post(post_id):
    print("llamada al post 1")
    
    cookie_token = request.cookies.get("delete_token", "")
    if not cookie_token:
        print("Token de eliminación ausente.", "error")
        return redirect(url_for("posts.my_posts"))

    db = get_db()
    row = db.execute(
        "SELECT token FROM delete_tokens WHERE user_id=?",
        (session["user_id"],)
    ).fetchone()
    logging.info("cookie_token: %s", cookie_token)
    logging.info("db_token:     %s", row["token"] if row else "NO EXISTE")
    if not row or cookie_token != row["token"]:
        print("Token de eliminación inválido.", "error")
        return redirect(url_for("posts.my_posts"))

    print("llamada al post 2")
    post = db.execute("SELECT author_id FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post or post["author_id"] != session["user_id"]:
        abort(403)

    db.execute("DELETE FROM posts WHERE id=?", (post_id,))
    db.commit()
    print("Post eliminado.", "success")

    response = make_response(redirect(url_for("posts.my_posts")))
    _set_delete_cookie(response)
    return response


# ── VULNERABILIDAD 3: Referer substring ─────────────────────────

@posts_bp.route("/post/share/<int:post_id>", methods=["GET"])
@require_role("writer")
def share_post(post_id):
    
    db = get_db()
    post = db.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post:
        abort(404)
        
    if not post or post["author_id"] != session["user_id"]:
        abort(403)
    db.execute("UPDATE posts SET published=1 WHERE id=?", (post_id,))
    db.commit()
    flash("Post compartido y published.", "success")
    return redirect(url_for("posts.my_posts"))


# ── RESTO DE RUTAS ───────────────────────────────────────────────

@posts_bp.route("/post/edit/<int:post_id>", methods=["GET", "POST"])
@require_role("writer")
def edit_post(post_id):
    db = get_db()
    post = db.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post:
        abort(404)
    if post["author_id"] != session["user_id"]:
        abort(403)
    if request.method == "POST":
        title     = request.form.get("title", "").strip()
        body      = request.form.get("body", "").strip()
        published = 1 if request.form.get("published") else 0
        db.execute(
            "UPDATE posts SET title=?, body=?, published=?, updated_at=datetime('now') WHERE id=?",
            (title, body, published, post_id),
        )
        db.commit()
        flash("Post actualizado.", "success")
        return redirect(url_for("posts.my_posts"))
    return render_template("posts/edit.html", post=post)


@posts_bp.route("/post/toggle/<int:post_id>", methods=["POST","GET"])
@require_role("writer")
def toggle_publish(post_id):
    db = get_db()
    _check_referer()
    post = db.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post:
        abort(404)
    if post["author_id"] != session["user_id"]:
        abort(403)
    db.execute(
        "UPDATE posts SET published=? WHERE id=?",
        (0 if post["published"] else 1, post_id)
    )
    db.commit()
    return redirect(url_for("posts.my_posts"))
