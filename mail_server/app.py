import os
import imaplib
import smtplib
import email as emaillib
import subprocess
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
from passlib.hash import sha512_crypt
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, flash, session
from passlib.hash import sha512_crypt

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

MAILSERVER_CONFIG = os.environ.get("MAILSERVER_CONFIG", "./docker-data/dms/config")
ADMIN_USER        = os.environ.get("ADMIN_USER", "admin@vulnlab.bo")
ADMIN_PASS        = os.environ.get("ADMIN_PASS", "admin123")
IMAP_HOST         = os.environ.get("IMAP_HOST", "mailserver")
IMAP_PORT         = int(os.environ.get("IMAP_PORT", "143"))
SMTP_HOST         = os.environ.get("SMTP_HOST", "mailserver")
SMTP_PORT         = int(os.environ.get("SMTP_PORT", "25"))

# ── account helpers ───────────────────────────────────────────────────────────

def postfix_accounts_path():
    return os.path.join(MAILSERVER_CONFIG, "postfix-accounts.cf")

def read_accounts():
    path = postfix_accounts_path()
    accounts = []
    if not os.path.exists(path):
        return accounts
    with open(path) as f:
        for line in f:
            line = line.strip()
            if "|" in line:
                accounts.append(line.split("|")[0])
    return accounts

def add_account(email: str, password: str):
    try:
        # result = subprocess.run(["doveadm", "pw", "-s", "SHA512-CRYPT", "-p", password],
        #                         capture_output=True, text=True)
        # pw_hash = result.stdout.strip() if result.returncode == 0 else f"{{PLAIN}}{password}"
        pw_hash = "{SHA512-CRYPT}" + sha512_crypt.using(rounds=5000).hash(password)
    except Exception:
        pw_hash = f"{{PLAIN}}{password}" 
    try:
        path = postfix_accounts_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if email in read_accounts():
            return False, "El correo ya existe."
        with open(path, "a") as f:
            f.write(f"{email}|{pw_hash}\n")
        return True, "Cuenta creada exitosamente."
    except Exception as e:
        return False, f"Error: {e}"

def delete_account(email: str):
    path = postfix_accounts_path()
    if not os.path.exists(path):
        return False, "Archivo no encontrado."
    lines, found = [], False
    with open(path) as f:
        for line in f:
            if line.strip().startswith(email + "|"):
                found = True
            else:
                lines.append(line)
    if not found:
        return False, "Cuenta no encontrada."
    with open(path, "w") as f:
        f.writelines(lines)
    return True, f"Cuenta {email} eliminada."

# ── IMAP helpers ──────────────────────────────────────────────────────────────

def imap_connect(user, password):
    """Returns an authenticated imaplib.IMAP4 connection or raises."""
    M = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
    M.login(user, password)
    return M

def decode_str(value):
    if value is None:
        return ""
    parts = decode_header(value)
    result = ""
    for part, enc in parts:
        if isinstance(part, bytes):
            result += part.decode(enc or "utf-8", errors="replace")
        else:
            result += part
    return result

def fetch_inbox(user, password, limit=30):
    """Fetch up to `limit` messages from INBOX. Returns list of dicts."""
    messages = []
    try:
        M = imap_connect(user, password)
        M.select("INBOX")
        _, data = M.search(None, "ALL")
        ids = data[0].split()
        # Most recent first
        ids = ids[::-1][:limit]
        for num in ids:
            _, msg_data = M.fetch(num, "(RFC822.HEADER FLAGS)")
            raw = msg_data[0][1]
            msg = emaillib.message_from_bytes(raw)
            flags_raw = msg_data[1] if len(msg_data) > 1 else b""
            flags_line = msg_data[0][0].decode() if msg_data[0] else ""
            seen = "\\Seen" in flags_line
            messages.append({
                "id":      num.decode(),
                "from":    decode_str(msg.get("From", "")),
                "subject": decode_str(msg.get("Subject", "(sin asunto)")),
                "date":    decode_str(msg.get("Date", "")),
                "seen":    seen,
            })
        M.logout()
    except Exception as e:
        messages = [{"error": str(e)}]
    return messages

def fetch_message(user, password, msg_id):
    try:
        M = imap_connect(user, password)
        M.select("INBOX")
        M.store(msg_id.encode(), "+FLAGS", "\\Seen")
        _, msg_data = M.fetch(msg_id.encode(), "(RFC822)")
        raw = msg_data[0][1]
        msg = emaillib.message_from_bytes(raw)

        body_html = ""
        body_text = ""

        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                cd = str(part.get("Content-Disposition", ""))
                if "attachment" in cd:
                    continue
                if ct == "text/html" and not body_html:
                    body_html = part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", errors="replace")
                elif ct == "text/plain" and not body_text:
                    body_text = part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", errors="replace")
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body_text = payload.decode(
                    msg.get_content_charset() or "utf-8", errors="replace")

        M.logout()
        return {
            "id":      msg_id,
            "from":    decode_str(msg.get("From", "")),
            "to":      decode_str(msg.get("To", "")),
            "subject": decode_str(msg.get("Subject", "(sin asunto)")),
            "date":    decode_str(msg.get("Date", "")),
            "body":    body_html or body_text,
            "is_html": bool(body_html),
        }
    except Exception as e:
        return {"error": str(e)}


def delete_message(user, password, msg_id):
    try:
        M = imap_connect(user, password)
        M.select("INBOX")
        M.store(msg_id.encode(), "+FLAGS", "\\Deleted")
        M.expunge()
        M.logout()
        return True, "Mensaje eliminado."
    except Exception as e:
        return False, str(e)

# ── SMTP helpers ──────────────────────────────────────────────────────────────

def send_mail(from_addr, password, to_addr, subject, body):
    try:
        msg = MIMEMultipart()
        msg["From"]    = from_addr
        msg["To"]      = to_addr
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain", "utf-8"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.ehlo()
            #s.starttls()
            #s.login(from_addr, password)
            s.sendmail(from_addr, [to_addr], msg.as_string())
        return True, "Correo enviado."
    except Exception as e:
        return False, f"Error SMTP: {e}"

# ── auth ──────────────────────────────────────────────────────────────────────

def user_login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("user_email"):
            return redirect(url_for("user_login"))
        return f(*args, **kwargs)
    return decorated

def admin_login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("is_admin"):
            return redirect(url_for("admin_login"))
        return f(*args, **kwargs)
    return decorated

# ── routes: public ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if session.get("user_email"):
        return redirect(url_for("inbox"))
    return redirect(url_for("user_login"))

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        email   = request.form.get("email", "").strip().lower()
        pw      = request.form.get("password", "")
        confirm = request.form.get("confirm", "")
        if not email or not pw:
            flash("Todos los campos son obligatorios.", "error")
        elif pw != confirm:
            flash("Las contraseñas no coinciden.", "error")
        elif len(pw) < 8:
            flash("Mínimo 8 caracteres.", "error")
        else:
            ok, msg = add_account(email, pw)
            flash(msg, "success" if ok else "error")
            if ok:
                return redirect(url_for("user_login"))
    return render_template("register.html")

@app.route("/login", methods=["GET", "POST"])
def user_login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        pw    = request.form.get("password", "")
        try:
            M = imap_connect(email, pw)
            M.logout()
            session["user_email"]    = email
            session["user_password"] = pw
            return redirect(url_for("inbox"))
        except Exception:
            flash("Credenciales incorrectas o servidor no disponible.", "error")
    return render_template("login.html")

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("user_login"))

# ── routes: webmail ───────────────────────────────────────────────────────────

@app.route("/inbox")
@user_login_required
def inbox():
    messages = fetch_inbox(session["user_email"], session["user_password"])
    return render_template("inbox.html", messages=messages)

@app.route("/message/<msg_id>")
@user_login_required
def view_message(msg_id):
    msg = fetch_message(session["user_email"], session["user_password"], msg_id)
    return render_template("message.html", msg=msg)

@app.route("/message/<msg_id>/delete", methods=["POST"])
@user_login_required
def delete_msg(msg_id):
    ok, m = delete_message(session["user_email"], session["user_password"], msg_id)
    flash(m, "success" if ok else "error")
    return redirect(url_for("inbox"))

@app.route("/compose", methods=["GET", "POST"])
@user_login_required
def compose():
    to      = request.args.get("to", "")
    subject = request.args.get("subject", "")
    if request.method == "POST":
        to      = request.form.get("to", "").strip()
        subject = request.form.get("subject", "").strip()
        body    = request.form.get("body", "")
        if not to or not subject:
            flash("Destinatario y asunto son obligatorios.", "error")
        else:
            ok, msg = send_mail(
                session["user_email"], session["user_password"],
                to, subject, body
            )
            flash(msg, "success" if ok else "error")
            if ok:
                return redirect(url_for("inbox"))
    return render_template("compose.html", to=to, subject=subject)

# ── routes: admin ─────────────────────────────────────────────────────────────

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        u = request.form.get("username", "").strip()
        p = request.form.get("password", "")
        if u == ADMIN_USER and p == ADMIN_PASS:
            session["is_admin"] = True
            return redirect(url_for("admin"))
        flash("Credenciales incorrectas.", "error")
    return render_template("admin_login.html")

@app.route("/admin/logout")
def admin_logout():
    session.pop("is_admin", None)
    return redirect(url_for("admin_login"))

@app.route("/admin")
@admin_login_required
def admin():
    accounts = read_accounts()
    return render_template("admin.html", accounts=accounts)

@app.route("/admin/delete/<path:email_addr>", methods=["POST"])
@admin_login_required
def admin_delete(email_addr):
    ok, msg = delete_account(email_addr)
    flash(msg, "success" if ok else "error")
    return redirect(url_for("admin"))


with app.app_context():
    ok, msg = add_account('soundnestadmin@vulnlab.bo', 'TUkC.94kLptaa%n02aa')
    print(f"[init] Cuenta sistema: {msg}")
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
