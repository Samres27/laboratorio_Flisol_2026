from flask import (
    Blueprint, render_template, request,
    redirect, url_for, session, flash
)
from database import get_db
from blueprints.auth import require_role

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


@admin_bp.route("/")
@require_role("admin")
def dashboard():
    db = get_db()
    total_users  = db.execute("SELECT COUNT(*) FROM users WHERE role='writer'").fetchone()[0]
    total_posts  = db.execute("SELECT COUNT(*) FROM posts").fetchone()[0]
    recent_posts = db.execute(
        """SELECT p.*, u.username FROM posts p
           JOIN users u ON u.id = p.author_id
           ORDER BY p.created_at DESC LIMIT 5"""
    ).fetchall()
    return render_template("admin/dashboard.html",
                           total_users=total_users,
                           total_posts=total_posts,
                           recent_posts=recent_posts)


@admin_bp.route("/users")
@require_role("admin")
def users():
    db = get_db()
    writers = db.execute(
        "SELECT * FROM users WHERE role='writer' ORDER BY created_at DESC"
    ).fetchall()
    return render_template("admin/users.html", writers=writers)


# ============================================================
# VULNERABLE A CSRF — Sin token, sin verificación de origen
# Un atacante puede forzar al admin a ejecutar esta acción
# enviándole un formulario HTML desde otro dominio.
# ============================================================
@admin_bp.route("/ban-user", methods=["POST"])
@require_role("admin")
def ban_user():
    user_id = request.form.get("user_id")
    if not user_id:
        flash("user_id requerido.", "error")
        return redirect(url_for("admin.users"))
    db = get_db()
    db.execute("UPDATE users SET banned=1 WHERE id=? AND role='writer'", (user_id,))
    db.commit()
    flash("Usuario suspendido.", "success")
    return redirect(url_for("admin.users"))


# VULNERABLE A CSRF
@admin_bp.route("/unban-user", methods=["POST"])
@require_role("admin")
def unban_user():
    user_id = request.form.get("user_id")
    db = get_db()
    db.execute("UPDATE users SET banned=0 WHERE id=? AND role='writer'", (user_id,))
    db.commit()
    flash("Usuario reactivado.", "success")
    return redirect(url_for("admin.users"))


# VULNERABLE A CSRF
@admin_bp.route("/delete-user", methods=["POST"])
@require_role("admin")
def delete_user():
    user_id = request.form.get("user_id")
    db = get_db()
    db.execute("DELETE FROM users WHERE id=? AND role='writer'", (user_id,))
    db.commit()
    flash("Usuario eliminado.", "success")
    return redirect(url_for("admin.users"))


@admin_bp.route("/posts")
@require_role("admin")
def all_posts():
    db = get_db()
    posts = db.execute(
        """SELECT p.*, u.username FROM posts p
           JOIN users u ON u.id = p.author_id
           ORDER BY p.created_at DESC"""
    ).fetchall()
    return render_template("admin/posts.html", posts=posts)
