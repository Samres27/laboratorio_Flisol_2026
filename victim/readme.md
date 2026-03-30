## Vulnerabilidades
XSS ->  tienda online -> basado en https://github.com/zinmyoswe/Django-Ecommerce
- stored -> comentario en publicacion*
- reflex -> error en el servidor*
- dom -> busqueda
- HTTP smuggling -> cache practicas 
- websocket -> chatbot

CRSF -> pagina personal
- token csrf divulgado mala configuracion -> publicacion con token csrf
- refer roto -> cambiar la password de un usuario -> id dor
- metodo de la solicut get con cooke lax-> eliminar un post, un bot verifica las publicaciones si se elimina la publicacion, la app publica la publicacion con la flag

clickjacking -> pagina de videos tipo youtube-
- Sitio basico con credenciales -> crear un nuevo usuario con lectura del sitio web
- Dos pasos -> eliminar un usuario con su contraseña

dom-based vulnerabilitys -> blog
- json.parse -> mediante iframe de un sitio personal blog
- redirecciones online -> el parametro -> uso de credenciales blog

SSRF -> un sitio de cursos.
- SSRF ciego con deteccion fuerza bruta -> musca sitio medinate el parametro
- SSRF con filtros de bypass mediante rediccion rota -> realiza peticiones como administrador.

dasboard para manejo -> 