# 🎵 SoundNest — Plataforma para compartir música

Aplicación Flask para subir y compartir música con gestión de cuenta de usuario.

## Requisitos

- Python 3.8+
- pip

## Instalación y ejecución

```bash
# 1. Crear entorno virtual (recomendado)
python -m venv venv
source venv/bin/activate        # Linux/Mac
venv\Scripts\activate           # Windows

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Ejecutar
python app.py
```

El sitio estará disponible en: **http://127.0.0.1:5000**

---

## Funcionalidades

| Función | Descripción |
|---|---|
| Registro | Crear cuenta con email de recuperación opcional |
| Login / Logout | Autenticación con contraseña hasheada |
| Subir canciones | MP3, WAV, OGG, FLAC (máx. 32 MB) |
| Reproducir | Player de audio en la página principal y perfil |
| **Cambiar email de recuperación** | Desde el perfil, sin necesidad de recargar |
| **Eliminar cuenta** | Confirma con contraseña; borra canciones del disco |
| Eliminar canción individual | Solo el dueño puede borrar sus canciones |

---

## Estructura del proyecto

```
musicapp/
├── app.py               # Aplicación principal Flask
├── requirements.txt
├── music.db             # SQLite (se crea automáticamente)
├── static/
│   └── uploads/         # Archivos de audio subidos
└── templates/
    ├── base.html
    ├── index.html
    ├── login.html
    ├── register.html
    ├── upload.html
    └── profile.html
```

---

## Flujo de "Eliminar cuenta" (2 pasos)

1. El usuario hace clic en **"Eliminar mi cuenta"** (zona de peligro del perfil)
2. Se abre un modal donde debe **ingresar su contraseña**
3. Si la contraseña es correcta → se eliminan canciones del disco, registros de BD y sesión
