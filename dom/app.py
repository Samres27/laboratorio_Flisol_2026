from flask import Flask, render_template, redirect, url_for, request, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = 'clave-secreta-super-segura-2024'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///courses.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SESSION_COOKIE_SAMESITE'] = 'None'
app.config['SESSION_COOKIE_SECURE']   = True

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = 'You must log in to access.'

# ── Modelos ──────────────────────────────────────────────────────────────────

registrations = db.Table('registrations',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id')),
    db.Column('course_id',   db.Integer, db.ForeignKey('course.id'))
)

class User(UserMixin, db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    name     = db.Column(db.String(100), nullable=False)
    email      = db.Column(db.String(150), unique=True, nullable=False)
    password   = db.Column(db.String(200), nullable=False)
    is_admin   = db.Column(db.Boolean, default=False)
    created_in  = db.Column(db.DateTime, default=datetime.utcnow)
    courses     = db.relationship('Course', secondary=registrations, backref='students')

class Course(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    title      = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    instructor  = db.Column(db.String(150), nullable=False)
    duration    = db.Column(db.String(80), nullable=False)
    level       = db.Column(db.String(50), nullable=False)
    created_in   = db.Column(db.DateTime, default=datetime.utcnow)

class LandingPage(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    title       = db.Column(db.String(200), nullable=False)
    subtitle    = db.Column(db.String(300), nullable=False)
    description  = db.Column(db.Text, nullable=False)
    benefits   = db.Column(db.Text, nullable=False)   # uno por línea
    public      = db.Column(db.String(300), nullable=False)
    price       = db.Column(db.String(80), nullable=False)
    text_cta    = db.Column(db.String(100), nullable=False, default='I want to enroll')
    cta_url      = db.Column(db.String(300), nullable=False, default='#')
    active       = db.Column(db.Boolean, default=True)
    created_in    = db.Column(db.DateTime, default=datetime.utcnow)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# ── Rutas públicas ────────────────────────────────────────────────────────────

@app.route('/testimonies')
def testimonies():
    return render_template('testimonies.html')

@app.route('/')
def index():
    courses = Course.query.order_by(Course.created_in.desc()).all()
    return render_template('index.html', courses=courses)

@app.route('/offers')
def landing_pages():
    pages = LandingPage.query.filter_by(active=True).order_by(LandingPage.created_in.desc()).all()
    return render_template('offers.html', pages=pages)

@app.route('/offer/<int:id>')
def ver_landing(id):
    page = LandingPage.query.get_or_404(id)
    return render_template('offers_detail.html', page=page)

# ── Rutas de autenticación ────────────────────────────────────────────────────

@app.route('/record', methods=['GET', 'POST'])
def record():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        name    = request.form.get('name', '').strip()
        email     = request.form.get('email', '').strip()
        password  = request.form.get('password', '')
        confirm = request.form.get('confirm', '')
        if not name or not email or not password:
            flash('All fields are required.', 'error')
        elif password != confirm:
            flash('Passwords do not match.', 'error')
        elif len(password) < 6:
            flash('Password must be at least 6 characters.', 'error')
        elif User.query.filter_by(email=email).first():
            flash('That email is already registered.', 'error')
        else:
            user = User(name=name, email=email, password=generate_password_hash(password))
            db.session.add(user)
            db.session.commit()
            flash('Account created successfully. Please log in!', 'success')
            return redirect(url_for('login'))
    return render_template('record.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        email    = request.form.get('email', '').strip()
        password = request.form.get('password', '')
        user  = User.query.filter_by(email=email).first()
        if user and check_password_hash(user.password, password):
            login_user(user)
            flash(f'Welcome, {user.name}!', 'success')
            return redirect(request.args.get('next') or url_for('index'))
        flash('Incorrect email or password.', 'error')
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Logged out.', 'info')
    return redirect(url_for('index'))

# ── Rutas de courses ───────────────────────────────────────────────────────────

@app.route('/course/<int:id>')
def view_course(id):
    course = Course.query.get_or_404(id)
    registered = current_user.is_authenticated and course in current_user.courses
    return render_template('course.html', course=course, registered=registered)

@app.route('/register/<int:id>')
@login_required
def register(id):
    course = Course.query.get_or_404(id)
    if course not in current_user.courses:
        current_user.courses.append(course)
        db.session.commit()
        flash(f'You have enrolled in "{course.title}".', 'success')
    else:
        flash('You are already enrolled in this course.', 'info')
    return redirect(url_for('view_course', id=id))

@app.route('/unsubscribe/<int:id>',methods=['POST'])
@login_required
def unsubscribe(id):
    course = Course.query.get_or_404(id)
    if course in current_user.courses:
        current_user.courses.remove(course)
        db.session.commit()
        flash(f'You have unenrolled from "{course.title}".', 'info')
    return redirect(url_for('view_course', id=id))

@app.route('/my-courses')
@login_required
def my_courses():
    return render_template('my_courses.html', courses=current_user.courses)

# ── Admin helpers ─────────────────────────────────────────────────────────────

def requiere_admin(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            flash('Access denied. Administrators only.', 'error')
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated

# ── Rutas de administrador — courses ──────────────────────────────────────────

@app.route('/admin')
@login_required
@requiere_admin
def admin_panel():
    courses   = Course.query.order_by(Course.created_in.desc()).all()
    users = User.query.order_by(User.created_in.desc()).all()
    landings = LandingPage.query.order_by(LandingPage.created_in.desc()).all()
    return render_template('admin_panel.html', courses=courses, users=users, landings=landings)

@app.route('/admin/course/new', methods=['GET', 'POST'])
@login_required
@requiere_admin
def new_course():
    if request.method == 'POST':
        title      = request.form.get('title', '').strip()
        description = request.form.get('description', '').strip()
        instructor  = request.form.get('instructor', '').strip()
        duration    = request.form.get('duration', '').strip()
        level       = request.form.get('level', '').strip()
        if not all([title, description, instructor, duration, level]):
            flash('All fields are required.', 'error')
        else:
            db.session.add(Course(title=title, description=description,
                                 instructor=instructor, duration=duration, level=level))
            db.session.commit()
            flash(f'Course "{title}" created.', 'success')
            return redirect(url_for('admin_panel'))
    return render_template('course_form.html', course=None, accion='Create')

@app.route('/admin/course/edit/<int:id>', methods=['GET', 'POST'])
@login_required
@requiere_admin
def editar_curso(id):
    course = Course.query.get_or_404(id)
    if request.method == 'POST':
        course.title      = request.form.get('title', '').strip()
        course.description = request.form.get('description', '').strip()
        course.instructor  = request.form.get('instructor', '').strip()
        course.duration    = request.form.get('duration', '').strip()
        course.level       = request.form.get('level', '').strip()
        if not all([course.title, course.description, course.instructor, course.duration, course.level]):
            flash('All fields are required.', 'error')
        else:
            db.session.commit()
            flash('Course updated.', 'success')
            return redirect(url_for('admin_panel'))
    return render_template('course_form.html', course=course, accion='Edit')

@app.route('/admin/course/delete/<int:id>', methods=['POST'])
@login_required
@requiere_admin
def delete_course(id):
    course = Course.query.get_or_404(id)
    db.session.delete(course)
    db.session.commit()
    flash(f'Course "{course.title}" deleted.', 'info')
    return redirect(url_for('admin_panel'))

@app.route('/admin/user/toggle-admin/<int:id>', methods=['POST'])
@login_required
@requiere_admin
def toggle_admin(id):
    user = User.query.get_or_404(id)
    if user.id == current_user.id:
        flash('You cannot change your own role.', 'error')
    else:
        user.is_admin = not user.is_admin
        db.session.commit()
        flash(f'{user.name} is now {"administrator" if user.is_admin else "user"}.', 'success')
    return redirect(url_for('admin_panel'))

# ── Rutas de administrador — ofertas ────────────────────────────────────

@app.route('/admin/offer/new', methods=['GET', 'POST'])
@login_required
@requiere_admin
def nueva_landing():
    if request.method == 'POST':
        title      = request.form.get('title', '').strip()
        subtitle   = request.form.get('subtitle', '').strip()
        description = request.form.get('description', '').strip()
        benefits  = request.form.get('benefits', '').strip()
        public     = request.form.get('public', '').strip()
        price      = request.form.get('price', '').strip()
        text_cta   = request.form.get('text_cta', 'I want to enroll').strip()
        cta_url     = request.form.get('cta_url', '#').strip()
        active      = request.form.get('active') == 'on'
        if not all([title, subtitle, description, benefits, public, price]):
            flash('Please complete all required fields.', 'error')
        else:
            lp = LandingPage(title=title, subtitle=subtitle, description=description,
                             benefits=benefits, public=public, price=price,
                             text_cta=text_cta, cta_url=cta_url, active=active)
            db.session.add(lp)
            db.session.commit()
            flash(f'Landing page "{title}" created.', 'success')
            return redirect(url_for('admin_panel'))
    return render_template('offers_form.html', lp=None, accion='Create')

@app.route('/admin/landing/edit/<int:id>', methods=['GET', 'POST'])
@login_required
@requiere_admin
def edit_landing(id):
    lp = LandingPage.query.get_or_404(id)
    if request.method == 'POST':
        lp.title      = request.form.get('title', '').strip()
        lp.subtitle   = request.form.get('subtitle', '').strip()
        lp.description = request.form.get('description', '').strip()
        lp.benefits  = request.form.get('benefits', '').strip()
        lp.public     = request.form.get('public', '').strip()
        lp.price      = request.form.get('price', '').strip()
        lp.text_cta   = request.form.get('text_cta', 'I want to enroll').strip()
        lp.cta_url     = request.form.get('cta_url', '#').strip()
        lp.active      = request.form.get('active') == 'on'
        if not all([lp.title, lp.subtitle, lp.description, lp.benefits, lp.public, lp.price]):
            flash('Please complete all required fields.', 'error')
        else:
            db.session.commit()
            flash('Landing page updated.', 'success')
            return redirect(url_for('admin_panel'))
    return render_template('offers_form.html', lp=lp, accion='Edit')

@app.route('/admin/landing/delete/<int:id>', methods=['POST'])
@login_required
@requiere_admin
def delete_landing(id):
    lp = LandingPage.query.get_or_404(id)
    db.session.delete(lp)
    db.session.commit()
    flash(f'Landing page "{lp.title}" deleted.', 'info')
    return redirect(url_for('admin_panel'))

@app.route('/admin/landing/toggle/<int:id>', methods=['POST'])
@login_required
@requiere_admin
def toggle_landing(id):
    lp = LandingPage.query.get_or_404(id)
    lp.active = not lp.active
    db.session.commit()
    flash(f'Landing page {"activated" if lp.active else "deactivated"}.', 'success')
    return redirect(url_for('admin_panel'))

# ── Inicialización ────────────────────────────────────────────────────────────

def create_initial_data():
    with app.app_context():
        db.create_all()
        if not User.query.filter_by(email='admin@courses.com').first():
            db.session.add(User(
                name='Administrator', email='admin@courses.com',
                password=generate_password_hash('admin123'), is_admin=True
            ))
        if Course.query.count() == 0:
            db.session.add_all([
                Course(title='Introduction to Python', description='Learn the fundamentals of Python from scratch: variables, control structures, functions, and error handling. Ideal for those who have never programmed before.', instructor='Ana García', duration='40 hours', level='Beginner'),
                Course(title='Web Design with HTML and CSS', description='Create modern, responsive web pages. Master semantic HTML5, CSS3, flexbox, grid, and best practices in modern front-end development.', instructor='Carlos Méndez', duration='35 hours', level='Beginner'),
                Course(title='Databases with SQL', description='Design and query relational databases. Learn SELECT, JOIN, subqueries, indexes, and query optimization with PostgreSQL and MySQL.', instructor='Laura Rojas', duration='30 hours', level='Intermediate'),
                Course(title='Modern JavaScript (ES6+)', description='Master the language of the web: promises, async/await, modules, destructuring, and the most used patterns in professional web development.', instructor='Diego Torres', duration='50 hours', level='Intermediate'),
            ])
        if LandingPage.query.count() == 0:
            db.session.add_all([
                LandingPage(
                    title='Master Python in 40 hours',
                    subtitle='The most complete course to learn programming from scratch, with real projects and personalized support.',
                    description='Have you always wanted to learn programming but didn\'t know where to start? This course takes you by the hand from the most basic concepts to building your first functional applications. No previous experience required.',
                    benefits='Learn at your own pace, no fixed schedule\nPractical projects from the first week\nLifetime access to updated material\nCertificate upon course completion\nDirect support from the instructor',
                    public='People with no programming experience\nProfessionals who want to automate tasks\nUniversity students looking to complement their education',
                    price='$49 USD — one-time payment',
                    text_cta='I want to learn Python',
                    cta_url='/course/1',
                    active=True
                ),
                LandingPage(
                    title='Modern JavaScript: from zero to professional',
                    subtitle='Master the language that powers the web. Learn ES6+, async/await, and the patterns used by professional development teams.',
                    description='JavaScript is the most in-demand language in the market. This course teaches you not only the syntax, but to think like a developer: structure code, solve real problems, and write maintainable applications.',
                    benefits='50 hours of practical, up-to-date content\nExercises with automatic grading\nFinal project with instructor review\nAccess to private student community\nDownloadable material included',
                    public='Developers with basic knowledge of HTML/CSS\nPeople who want to enter the tech job market\nFreelancers who want to expand their services',
                    price='$69 USD — one-time payment',
                    text_cta='Start now',
                    cta_url='/course/4',
                    active=True
                ),
            ])
        db.session.commit()

if __name__ == '__main__':
    create_initial_data()
    app.run(debug=True, port=5000)

with app.app_context():
    db.create_all()
    
    # Verificar si la tabla users está vacía
    if User.query.count() == 0:
        create_initial_data()