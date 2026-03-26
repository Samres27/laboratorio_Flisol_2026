# ============================================================
# VULNERABLE CONFIG — Solo para uso educativo en ciberseguridad
# NO usar en producción
# ============================================================

SECRET_KEY = "csrf_demo_insecure_key_2024"  # VULNERABLE: clave predecible

# VULNERABLE: SameSite=None permite envío cross-origin de cookies
SESSION_COOKIE_SAMESITE = None #'lax'

# VULNERABLE: accesible desde JavaScript
SESSION_COOKIE_HTTPONLY = False

# VULNERABLE: no requiere HTTPS
SESSION_COOKIE_SECURE = False

DATABASE = "blog.db"
DEBUG = True

# VULNERABLE: sin cabeceras de seguridad (CSP, X-Frame-Options, etc.)
