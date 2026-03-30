import os
import hashlib
import logging
logger = logging.getLogger(__name__)
from flask import (
    Blueprint, render_template, request,
    redirect, url_for, session, flash, abort, make_response
)
from database import get_db
from blueprints.auth import require_role

posts_bp = Blueprint("posts", __name__)


# ── HELPER: token CSRF estático ──────────────────────────────────

def _get_static_csrf_token():
    """
    Genera o recupera el token. Siempre sincroniza sesión <-> DB.
    Si hay token en DB pero no en sesión, lo restaura.
    Si hay token en sesión pero no en DB, lo persiste.
    Nunca rota.
    """
    user_id = session.get("user_id")

    # Intentar recuperar token existente de DB
    db_token = None
    if user_id:
        row = get_db().execute(
            "SELECT csrf_token FROM user_tokens WHERE user_id=?", (user_id,)
        ).fetchone()
        db_token = row["csrf_token"] if row else None

    # Si DB tiene token, usarlo siempre (fuente de verdad)
    if db_token:
        session["csrf_token"] = db_token
        return db_token

    # Generar nuevo token
    token = session.get("csrf_token") or hashlib.sha256(os.urandom(32)).hexdigest()
    session["csrf_token"] = token

    # Persistir en DB
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
    """
    Compara el token del formulario contra DB y sesión.
    Acepta si coincide con cualquiera de los dos — el fallback a DB
    cubre el caso en que la sesión se perdió (debug reload, etc).
    """
    logger.info("llege aqui, pero parece que el form: %s", request.form)
    form_token = request.form.get("csrf_token", "")
    logger.info("form_token: %s", form_token)
    if not form_token:
        abort(403)

    # Primero comparar con sesión
    session_token = session.get("csrf_token", "")
    logger.info("session_token: %s", session_token)
    if session_token and form_token == session_token:
        return  # OK

    # Fallback: comparar con token persistido en DB
    if session.get("user_id"):
        row = get_db().execute(
            "SELECT csrf_token FROM user_tokens WHERE user_id=?",
            (session["user_id"],)
        ).fetchone()
        if row and form_token == row["csrf_token"]:
            session["csrf_token"] = row["csrf_token"]  # restaurar sesión
            return  # OK

    abort(403)


def _check_referer():
    """
    Valida Referer por substring — bypasseable con subdominio o sin cabecera.
    """
    referer = request.headers.get("Referer", "")
    if not referer:
        return  # acepta silenciosamente — bypass #2
    if "localhost:5000" not in referer:
        abort(403)


# ── COOKIE delete_token ──────────────────────────────────────────
#
# VULNERABILIDAD 2: la cookie se emite con SameSite=Lax pero el
# endpoint de delete acepta GET además de POST.
# Con SameSite=Lax el navegador SÍ envía la cookie en navegación
# top-level GET cross-origin (click en link, redirect).
# El atacante usa un <a href> o window.location en lugar de un form POST.
#
# NOTA: SameSite=None requiere Secure=True en navegadores modernos (HTTP lo rechaza).
# SameSite=Lax es la configuración "por defecto segura" que Chrome aplica
# automáticamente — pero sigue siendo vulnerable a CSRF via GET.

def _set_delete_cookie(response):
    """
    Genera un token, lo guarda en delete_tokens vinculado al usuario
    y lo emite como cookie SameSite=Lax.

    VULNERABLE: SameSite=Lax + endpoint GET permite CSRF via navegación
    top-level (window.location, <a href>). El navegador envía la cookie
    porque es un GET cross-origin de nivel superior.

    El token SÍ está vinculado al usuario — la vulnerabilidad es CSRF,
    no que cualquier valor arbitrario funcione.
    """
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
        samesite="Lax",   # VULNERABLE: se envía en GET top-level cross-origin
        httponly=False,
        secure=False,
        max_age=3600,
    )


@posts_bp.after_request
def attach_delete_cookie(response):
    """
    Emite la cookie delete_token en cada respuesta a escritores.
    Si el login pregeneró un token (_delete_token en sesión), lo usa
    y siempre sobreescribe la cookie — así el login siempre sincroniza
    la cookie con el token actual en DB.
    """
    if session.get("role") != "writer":
        return response

    preset = session.pop("_delete_token", None)
    if preset:
        # Viene del login — sobreescribir siempre, aunque ya exista la cookie
        response.set_cookie(
            "delete_token",
            value=preset,
            samesite="Lax",
            httponly=False,
            secure=False,
            max_age=3600,
        )
    elif "delete_token" not in request.cookies:
        # Primera visita sin cookie — generar uno nuevo
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
@require_role("writer")
def create_post():
    csrf_token = _get_static_csrf_token()

    if request.method == "POST":
        _check_static_csrf_token()

        title     = request.form.get("title", "").strip()
        body      = request.form.get("body", "").strip()
        print(int(request.form.get("published")),request.form.get("published"))
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
        flash("Post creado.", "success")
        return redirect(url_for("posts.my_posts"))

    return render_template("posts/create.html", csrf_token=csrf_token)


# ── VULNERABILIDAD 2: Cookie SameSite=Lax + endpoint acepta GET ─
#
# SameSite=Lax bloquea cookies en POST cross-origin pero NO en GET.
# Al aceptar GET aquí, el atacante puede forzar la eliminación con:
#   <a href="http://localhost:5000/post/delete/1">click</a>
#   o window.location = "http://localhost:5000/post/delete/1"
# El navegador adjunta la cookie porque es navegación top-level GET.

@posts_bp.route("/post/delete/<int:post_id>", methods=["GET", "POST"])
@require_role("writer")
def delete_post(post_id):
    """
    VULNERABLE A CSRF via GET:
      El atacante fuerza al escritor a visitar esta URL con window.location.
      El navegador adjunta delete_token (SameSite=Lax + GET top-level).
      El servidor verifica el token — es válido — y elimina el post.

    La verificación es correcta: compara cookie contra DB y usuario.
    La vulnerabilidad es que SameSite=Lax no bloquea GET cross-origin.
    """
    cookie_token = request.cookies.get("delete_token", "")
    if not cookie_token:
        flash("Token de eliminación ausente.", "error")
        return redirect(url_for("posts.my_posts"))

    # Verificar token contra DB vinculado al usuario en sesión
    db = get_db()
    row = db.execute(
        "SELECT token FROM delete_tokens WHERE user_id=?",
        (session["user_id"],)
    ).fetchone()

    # VULNERABLE: la validación es correcta pero SameSite=Lax + GET
    # permite que un atacante fuerce esta request desde otro origen.
    if not row or cookie_token != row["token"]:
        flash("Token de eliminación inválido.", "error")
        return redirect(url_for("posts.my_posts"))

    db.execute("DELETE FROM posts WHERE id=?", (post_id,))
    db.commit()
    flash("Post eliminado.", "success")

    response = make_response(redirect(url_for("posts.my_posts")))
    _set_delete_cookie(response)
    return response


# ── VULNERABILIDAD 3: Referer substring ─────────────────────────

@posts_bp.route("/post/share/<int:post_id>", methods=["POST"])
@require_role("writer")
def share_post(post_id):
    _check_referer()
    db = get_db()
    post = db.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post:
        abort(404)
    db.execute("UPDATE posts SET published=1 WHERE id=?", (post_id,))
    db.commit()
    flash("Post compartido y publicado.", "success")
    return redirect(url_for("posts.my_posts"))


# ── RESTO DE RUTAS ───────────────────────────────────────────────

@posts_bp.route("/post/edit/<int:post_id>", methods=["GET", "POST"])
@require_role("writer")
def edit_post(post_id):
    db = get_db()
    post = db.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post:
        abort(404)
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


@posts_bp.route("/post/toggle/<int:post_id>", methods=["POST"])
@require_role("writer")
def toggle_publish(post_id):
    db = get_db()
    post = db.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post:
        abort(404)
    db.execute(
        "UPDATE posts SET published=? WHERE id=?",
        (0 if post["published"] else 1, post_id)
    )
    db.commit()
    return redirect(url_for("posts.my_posts"))
