# BlogCSRF

Plataforma de blogs intencionalmente vulnerable a **CSRF (Cross-Site Request Forgery)**.
Construida con Flask + SQLite3 para uso exclusivo en laboratorios de ciberseguridad.

---

## ⚠ Advertencia

> Este proyecto contiene vulnerabilidades de seguridad **intencionales**.
> Úsalo únicamente en entornos de laboratorio controlados.
> **Nunca lo despliegues en producción ni en redes públicas.**

---

## Stack

- Python 3.8+
- Flask 2.3.3
- SQLite3 (stdlib)
- Jinja2 (incluido en Flask)

---

## Instalación

```bash
git clone <repo>
cd blogcsrf

python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt
python app.py
```

El servidor arranca en `http://localhost:5000`

---

## Credenciales por defecto

| Usuario | Contraseña | Rol    |
|---------|-----------|--------|
| admin   | admin123  | admin  |

Registra escritores desde `/register`.

---

## Estructura del proyecto

```
blogcsrf/
├── app.py              # Entry point / factory
├── config.py           # Configuración insegura (intencional)
├── database.py         # Helper SQLite3
├── schema.sql          # DDL de tablas
├── requirements.txt
│
├── blueprints/
│   ├── auth.py         # Login, logout, registro
│   ├── admin.py        # Gestión de usuarios (VULNERABLE)
│   └── posts.py        # CRUD de posts (VULNERABLE)
│
├── templates/
│   ├── base.html
│   ├── 403.html
│   ├── 404.html
│   ├── auth/           # login.html, register.html
│   ├── admin/          # dashboard.html, users.html, posts.html
│   └── posts/          # feed.html, my_posts.html, create.html, edit.html, detail.html
│
└── exploits/           # Páginas HTML de demostración de ataques
    ├── exploit_ban_user.html
    ├── exploit_delete_user.html
    ├── exploit_create_post.html
    └── exploit_edit_post.html
```

---

## Vulnerabilidades implementadas

### 1. Sin tokens CSRF
Ningún formulario POST incluye un token de sincronización.
Flask-WTF no está instalado intencionalmente.

**Endpoints afectados:**

| Endpoint                      | Rol requerido | Impacto                        |
|-------------------------------|---------------|--------------------------------|
| `POST /admin/ban-user`        | admin         | Banear escritores              |
| `POST /admin/unban-user`      | admin         | Desbanear escritores           |
| `POST /admin/delete-user`     | admin         | Eliminar cuentas               |
| `POST /post/create`           | writer        | Crear posts falsos             |
| `POST /post/edit/<id>`        | writer        | Modificar posts                |
| `POST /post/delete/<id>`      | writer        | Eliminar posts                 |
| `POST /post/toggle/<id>`      | writer        | Cambiar estado de publicación  |

### 2. Cookie sin SameSite
```python
SESSION_COOKIE_SAMESITE = None
```
El navegador envía la cookie de sesión en cualquier request cross-origin,
condición necesaria para que CSRF funcione.

### 3. Sin verificación de origen
Ninguna ruta comprueba las cabeceras `Referer` u `Origin` del request.

### 4. IDOR en edición de posts
`POST /post/edit/<id>` no verifica que el `author_id` del post coincida
con el usuario en sesión. Un escritor puede editar posts de otro.

### 5. Cookie accesible desde JS
```python
SESSION_COOKIE_HTTPONLY = False
```
Permite leer la cookie desde JavaScript (XSS → robo de sesión).

### 6. Contraseñas con SHA-256 sin salt
```python
hashlib.sha256(password.encode()).hexdigest()
```
Vulnerable a ataques de diccionario y rainbow tables.

---

## Demostración de ataques (exploits/)

Sirve los archivos de `exploits/` desde otro puerto:

```bash
cd exploits
python3 -m http.server 8080
```

Mientras el **admin** tiene sesión abierta en `localhost:5000`,
ábrele en ese mismo navegador:

```
http://localhost:8080/exploit_ban_user.html
```

El usuario ID=2 quedará baneado sin que el admin haya hecho click en nada.

---

## Mitigaciones (para enseñar el contraste)

Para proteger el sitio después de demostrar el ataque:

```bash
pip install flask-wtf
```

```python
# En cada blueprint:
from flask_wtf.csrf import CSRFProtect
csrf = CSRFProtect(app)
```

```html
<!-- En cada formulario: -->
<input type="hidden" name="csrf_token" value="{{ csrf_token() }}">
```

```python
# En config.py — corregir:
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE   = True   # requiere HTTPS
```

---

## Licencia

MIT — Solo para uso educativo.
