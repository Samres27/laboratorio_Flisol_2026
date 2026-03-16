from flask import Flask, render_template, request, redirect, url_for, jsonify
from flask_sock import Sock
import json
import uuid
import sqlite3

app = Flask(__name__)
sock = Sock(app)

# ─────────────────────────────────────────
# Configuración de la base de datos SQLite
# ─────────────────────────────────────────
DATABASE = 'shop.db'

def init_db():
    """Crea las tablas si no existen."""
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL,
                author TEXT NOT NULL,
                rating INTEGER NOT NULL,
                comment TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

# Inicializar la base de datos al arrancar la aplicación
init_db()

def get_messages_for_session(session_id):
    with sqlite3.connect(DATABASE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            'SELECT sender, content FROM chat_messages WHERE session_id = ? ORDER BY timestamp',
            (session_id,)
        )
        return [dict(row) for row in cursor.fetchall()]

def add_message(session_id, sender, content):
    with sqlite3.connect(DATABASE) as conn:
        conn.execute(
            'INSERT INTO chat_messages (session_id, sender, content) VALUES (?, ?, ?)',
            (session_id, sender, content)
        )
        conn.commit()

def get_reviews_for_slug(slug):
    with sqlite3.connect(DATABASE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            'SELECT author, rating, comment FROM reviews WHERE slug = ? ORDER BY timestamp',
            (slug,)
        )
        return [dict(row) for row in cursor.fetchall()]

def add_reviewDB(slug, author, rating, comment):
    with sqlite3.connect(DATABASE) as conn:
        conn.execute(
            'INSERT INTO reviews (slug, author, rating, comment) VALUES (?, ?, ?, ?)',
            (slug, author, rating, comment)
        )
        conn.commit()

# ─────────────────────────────────────────
# Datos de productos (se mantienen en memoria)
# ─────────────────────────────────────────
PRODUCTS = [
    {"id": 1, "title": "Nike Air Max 90", "price": 120, "slug": "nike-air-max-90", "image": "/static/images/p1.webp", "category": "Shoes"},
    {"id": 2, "title": "Nike ZoomX Vaporfly", "price": 250, "slug": "nike-zoomx-vaporfly", "image": "/static/images/p2.webp", "category": "Shoes"},
    {"id": 3, "title": "Nike Dri-FIT T-Shirt", "price": 35, "slug": "nike-dri-fit-tshirt", "image": "/static/images/p3.webp", "category": "Clothing"},
    {"id": 4, "title": "Nike Pro Leggings", "price": 55, "slug": "nike-pro-leggings", "image": "/static/images/p4.webp", "category": "Clothing"},
    {"id": 5, "title": "Nike Brasilia Bag", "price": 45, "slug": "nike-brasilia-bag", "image": "/static/images/p5.webp", "category": "Accessories"},
    {"id": 6, "title": "Nike Mercurial Cleats", "price": 180, "slug": "nike-mercurial-cleats", "image": "/static/images/p6.webp", "category": "Shoes"},
]

# ─────────────────────────────────────────
# Bot responses (sin cambios)
# ─────────────────────────────────────────
BOT_RESPONSES = [
    {"keywords": ["hello", "hey", "greetings", "good"], "response": "Hello! Welcome to Django Shop. How can I help you today?"},
    {"keywords": ["price", "cost", "how much"], "response": "Our prices vary depending on the product. You can see all the prices in our shop."},
    {"keywords": ["shipping", "delivery"], "response": "We offer free shipping on orders over $100. Standard shipping takes 3-5 business days."},
    {"keywords": ["return", "refund", "exchange"], "response": "We accept returns within 30 days of purchase. The product must be in its original condition."},
    {"keywords": ["size", "sizes", "measurement"], "response": "We carry sizes S, M, L, and XL."},
    {"keywords": ["payment", "card", "stripe", "paypal"], "response": "We accept credit/debit card payments through Stripe and PayPal."},
    {"keywords": ["discount", "coupon", "offer", "promotion"], "response": "We have special offers! Check out our sale products section."},
    {"keywords": ["contact", "email", "phone"], "response": "You can contact us at support@djangoshop.com"},
    {"keywords": ["thank", "thanks", "perfect", "great"], "response": "You're welcome! If you have any other questions, feel free to ask."},
    {"keywords": ["bye", "goodbye", "see you"], "response": "See you later! Have a great day. Come back soon!"},
]
DEFAULT_RESPONSE = "I don't have a specific answer for that. Contact us at support@djangoshop.com"

def get_bot_response(message):
    msg_lower = message.lower()
    for item in BOT_RESPONSES:
        for keyword in item["keywords"]:
            if keyword in msg_lower:
                return item["response"]
    return DEFAULT_RESPONSE

# ─────────────────────────────────────────
# Rutas HTTP
# ─────────────────────────────────────────
@app.route('/', methods=['GET', 'POST'])
def home():
    request.environ['wsgi.input_terminated'] = True
    user_agent = request.headers.get('User-Agent', '')
    return render_template('index.html', products=PRODUCTS, user_agent=user_agent)

@app.route('/shop/')
def shop():
    return render_template('shop.html', products=PRODUCTS)

@app.route('/product/<slug>/')
def product_detail(slug):
    product = next((p for p in PRODUCTS if p['slug'] == slug), None)
    if not product:
        return redirect('/error?message=Product not found')
    reviews = get_reviews_for_slug(slug)
    return render_template('product_detail.html', product=product, reviews=reviews)

@app.route('/product/<slug>/review/', methods=['POST'])
def add_review(slug):
    product = next((p for p in PRODUCTS if p['slug'] == slug), None)
    if not product:
        return redirect('/error?message=Product not found')
    author = request.form.get('author', 'Anonymous')
    rating = request.form.get('rating', '5')
    comment = request.form.get('comment', '')
    add_reviewDB(slug, author, int(rating), comment)
    return redirect(f'/product/{slug}/')

@app.route('/ajax/search/')
def search_ajax():
    query = request.args.get('q', '')
    results = [p for p in PRODUCTS if query.lower() in p['title'].lower()]
    data = [{"title": p["title"], "price": p["price"], "url": f"/product/{p['slug']}/", "image": p["image"]} for p in results]
    return jsonify({"items": data})

@app.route('/error')
def error_page():
    message = request.args.get('message', '')
    if not message:
        message = 'The resource was not found, please check your URL'
    return render_template('404.html', message=message), 404

@app.errorhandler(404)
def not_found(e):
    message = request.args.get('message', 'The resource was not found, please check your URL')
    return redirect(f'/error?message={message}')

# ── Chat ──
@app.route('/chat/')
def chat_new():
    # Generar un identificador único para la sesión
    return redirect(f'/chat/tempChat/')

@app.route('/chat/<session_id>/')
def chat_view(session_id):
    history = get_messages_for_session(session_id)
    return render_template('chat.html', session_id=session_id, messages_history=history)

@sock.route('/ws/chat/<session_id>/')
def ws_chat(ws, session_id):
    # No es necesario inicializar la sesión; se guarda directamente en la BD
    while True:
        data = ws.receive()
        if data is None:
            break
        try:
            payload = json.loads(data)
            user_message = payload.get('message', '').strip()
            if not user_message:
                continue

            # Guardar mensaje del usuario
            add_message(session_id, "user", user_message)
            ws.send(json.dumps({"sender": "user", "message": user_message}))

            # Obtener y guardar respuesta del bot
            bot_reply = get_bot_response(user_message)
            add_message(session_id, "bot", bot_reply)
            ws.send(json.dumps({"sender": "bot", "message": bot_reply}))

        except Exception:
            break

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)