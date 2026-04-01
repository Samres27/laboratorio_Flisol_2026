from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from flask_mail import Mail, Message
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
import sqlite3, os, uuid

app = Flask(__name__)
app.secret_key = 'soundnest-secret-key-change-in-production'
app.config['SESSION_COOKIE_SAMESITE'] = 'None'
app.config['SESSION_COOKIE_SECURE']   = True

# ── UPLOAD CONFIG ─────────────────────────────────────────────────────────────
UPLOAD_FOLDER = 'static/uploads'
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32 MB

# ── MAIL CONFIG ───────────────────────────────────────────────────────────────
# Configure these with your real SMTP credentials before running.
# For testing with Gmail:
#   1. Enable 2FA on your Google account
#   2. Go to myaccount.google.com → Security → App Passwords
#   3. Generate a password and paste it below
app.config['MAIL_SERVER']         = 'mailserver'          
app.config['MAIL_PORT']           = 587                   
app.config['MAIL_USE_TLS']        = False
app.config['MAIL_USE_SSL']        = False
app.config['MAIL_USERNAME']       = 'soundnestadmin@vulnlab.bo'   
app.config['MAIL_PASSWORD']       = 'TUkC.94kLptaa%n02aa'           
app.config['MAIL_DEFAULT_SENDER'] = ('mail soundnest', 'soundnestadmin@vulnlab.bo')

mail       = Mail(app)
serializer = URLSafeTimedSerializer(app.secret_key)

# ── DB ────────────────────────────────────────────────────────────────────────
def get_db():
    db = sqlite3.connect('music.db')
    db.row_factory = sqlite3.Row
    return db

def init_db():
    with get_db() as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                username       TEXT UNIQUE NOT NULL,
                email          TEXT UNIQUE NOT NULL,
                password       TEXT NOT NULL,
                recovery_email TEXT
            );
            CREATE TABLE IF NOT EXISTS songs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                artist      TEXT NOT NULL,
                filename    TEXT NOT NULL,
                user_id     INTEGER NOT NULL,
                is_private  INTEGER DEFAULT 0,
                uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        ''')
        # Migración: agregar columna si no existe (para DBs existentes)
        try:
            db.execute('ALTER TABLE songs ADD COLUMN is_private INTEGER DEFAULT 0')
            db.commit()
        except Exception:
            pass  # La columna ya existe

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ── INDEX ─────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    print(app.config['MAIL_USERNAME'])
    if app.config['MAIL_USERNAME']=="" or app.config['MAIL_PASSWORD'] == "":
        print("mail no found")
        return render_template('init_mail.html')
    else:
        db = get_db()
        user_id = session.get('user_id')
        songs = db.execute('''
            SELECT songs.*, users.username FROM songs
            JOIN users ON songs.user_id = users.id
            WHERE songs.is_private = 0 OR songs.user_id = ?
            ORDER BY uploaded_at DESC
        ''', (user_id,)).fetchall()
        return render_template('index.html', songs=songs)

# ── REGISTER ──────────────────────────────────────────────────────────────────
@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username'].strip()
        email    = request.form['email'].strip()
        password = request.form['password']
        recovery = request.form.get('recovery_email', '').strip()
        if not username or not email or not password:
            flash('All fields are required.', 'error')
            return render_template('register.html')
        db = get_db()
        if db.execute('SELECT id FROM users WHERE username=? OR email=?', (username, email)).fetchone():
            flash('Username or email already exists.', 'error')
            return render_template('register.html')
        db.execute(
            'INSERT INTO users (username, email, password, recovery_email) VALUES (?,?,?,?)',
            (username, email, generate_password_hash(password), recovery or email)
        )
        db.commit()
        flash('Account created! Please log in.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')

# ── LOGIN ─────────────────────────────────────────────────────────────────────
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username'].strip()
        password = request.form['password']
        db   = get_db()
        user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        if user is None:
            flash("Invalid username",'error')
            return render_template('login.html')
        if user and check_password_hash(user['password'], password):
            session['user_id']  = user['id']
            session['username'] = user['username']
            flash('Welcome back!', 'success')
            return redirect(url_for('index'))
        flash('Invalid password.', 'error')
    return render_template('login.html')
@app.route('/init-mail', methods=['POST'])
def init_mail():
    if request.method == 'POST':
        username = request.form['mail_username'].strip()
        password = request.form['mail_password']
        app.config['MAIL_USERNAME'] == username
        app.config['MAIL_PASSWORD'] == password
        flash('Correct.', 'success')
        return redirect(url_for('index'))
    
@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# ── PROFILE ───────────────────────────────────────────────────────────────────
@app.route('/profile')
def profile():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db   = get_db()
    user = db.execute('SELECT * FROM users WHERE id=?', (session['user_id'],)).fetchone()
    if user is None:
        session.clear()
        flash('Session expired. Please log in again.', 'error')
        return redirect(url_for('login'))
    songs = db.execute('SELECT * FROM songs WHERE user_id=? ORDER BY uploaded_at DESC', (session['user_id'],)).fetchall()
    return render_template('profile.html', user=user, songs=songs)

# ── UPDATE RECOVERY EMAIL ─────────────────────────────────────────────────────
@app.route('/update-recovery-email', methods=['POST'])
def update_recovery_email():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not authenticated'}), 401
    new_email = request.json.get('recovery_email', '').strip()
    if not new_email or '@' not in new_email:
        return jsonify({'success': False, 'message': 'Invalid email address'}), 400
    db = get_db()
    db.execute('UPDATE users SET recovery_email=? WHERE id=?', (new_email, session['user_id']))
    db.commit()
    return jsonify({'success': True, 'message': 'Recovery email updated successfully.'})

# ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        db   = get_db()
        user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()

        # Always show the same message to avoid username enumeration
        generic_msg = 'If that account exists, a reset link has been sent to its recovery email.'

        if user:
            recovery_email = user['recovery_email'] or user['email']
            token     = serializer.dumps(user['id'], salt='password-reset')
            reset_url = url_for('reset_password', token=token, _external=True)
            try:
                msg = Message(
                    subject='SoundNest Reset your password',
                    sender=app.config['MAIL_DEFAULT_SENDER'],   # <-- faltaba esto
                    recipients=[recovery_email]
                )
                msg.html = render_template('email_reset.html',
                                           username=user['username'],
                                           reset_url=reset_url)
                app.logger.info(f"HTML length: {len(msg.html)}, reset_url: {reset_url}")
                mail.send(msg)
            except Exception as e:
                app.logger.error(f'Mail error: {e}')
                flash('Could not send email. Please check your SMTP settings in app.py.', 'error')
                return render_template('forgot_password.html')

        flash(generic_msg, 'success')
        return redirect(url_for('login'))
    return render_template('forgot_password.html')

# ── RESET PASSWORD (token link) ───────────────────────────────────────────────
@app.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    try:
        user_id = serializer.loads(token, salt='password-reset', max_age=3600)  # 1 hour
    except SignatureExpired:
        flash('This reset link has expired. Please request a new one.', 'error')
        return redirect(url_for('forgot_password'))
    except BadSignature:
        flash('Invalid reset link.', 'error')
        return redirect(url_for('forgot_password'))

    if request.method == 'POST':
        new_password = request.form.get('password', '')
        confirm      = request.form.get('confirm', '')
        if len(new_password) < 6:
            flash('Password must be at least 6 characters.', 'error')
            return render_template('reset_password.html', token=token)
        if new_password != confirm:
            flash('Passwords do not match.', 'error')
            return render_template('reset_password.html', token=token)
        db = get_db()
        db.execute('UPDATE users SET password=? WHERE id=?',
                   (generate_password_hash(new_password), user_id))
        db.commit()
        flash('Password updated successfully! Please log in.', 'success')
        return redirect(url_for('login'))

    return render_template('reset_password.html', token=token)

# ── DELETE ACCOUNT ────────────────────────────────────────────────────────────
@app.route('/delete-account', methods=['POST'])
def delete_account():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not authenticated'}), 401
    
    db   = get_db()
    user = db.execute('SELECT * FROM users WHERE id=?', (session['user_id'],)).fetchone()
    songs = db.execute('SELECT filename FROM songs WHERE user_id=?', (session['user_id'],)).fetchall()
    for s in songs:
        path = os.path.join(app.config['UPLOAD_FOLDER'], s['filename'])
        if os.path.exists(path):
            os.remove(path)
    db.execute('DELETE FROM songs WHERE user_id=?', (session['user_id'],))
    db.execute('DELETE FROM users WHERE id=?',      (session['user_id'],))
    db.commit()
    session.clear()
    return jsonify({'success': True, 'message': 'Account deleted.'})

# ── UPLOAD SONG ───────────────────────────────────────────────────────────────
@app.route('/upload', methods=['GET', 'POST'])
def upload():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    db   = get_db()
    user = db.execute('SELECT id FROM users WHERE id=?', (session['user_id'],)).fetchone()
    if user is None:
        session.clear()
        flash('Session expired. Please log in again.', 'error')
        return redirect(url_for('login'))
    if request.method == 'POST':
        title      = request.form.get('title', '').strip()
        artist     = request.form.get('artist', '').strip()
        file       = request.files.get('audio')
        is_private = 1 if request.form.get('is_private') else 0
        if not title or not artist or not file:
            flash('Please fill in all fields.', 'error')
            return render_template('upload.html')
        if not allowed_file(file.filename):
            flash('Unsupported format. Use MP3, WAV, OGG or FLAC.', 'error')
            return render_template('upload.html')
        ext      = file.filename.rsplit('.', 1)[1].lower()
        filename = f"{uuid.uuid4().hex}.{ext}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        db = get_db()
        db.execute('INSERT INTO songs (title, artist, filename, user_id, is_private) VALUES (?,?,?,?,?)',
                   (title, artist, filename, session['user_id'], is_private))
        db.commit()
        flash('Song uploaded successfully!', 'success')
        return redirect(url_for('index'))
    return render_template('upload.html')

# ── DELETE SONG ───────────────────────────────────────────────────────────────
@app.route('/delete-song/<int:song_id>', methods=['POST'])
def delete_song(song_id):
    if 'user_id' not in session:
        return jsonify({'success': False}), 401
    db   = get_db()
    song = db.execute('SELECT * FROM songs WHERE id=? AND user_id=?', (song_id, session['user_id'])).fetchone()
    if not song:
        return jsonify({'success': False, 'message': 'Not found'}), 404
    path = os.path.join(app.config['UPLOAD_FOLDER'], song['filename'])
    if os.path.exists(path):
        os.remove(path)
    db.execute('DELETE FROM songs WHERE id=?', (song_id,))
    db.commit()
    return jsonify({'success': True})

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
init_db()

if __name__ == '__main__':
    app.run(debug=True)
