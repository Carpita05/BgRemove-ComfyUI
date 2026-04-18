# 🚀 IA de fotos con fondo personalizado con ComfyUI

Este proyecto es una aplicación web de alto rendimiento que integra **ComfyUI** con un servidor **Node.js** para automatizar la creación de montajes fotográficos y branding corporativo. El sistema incorpora una interfaz moderna (adaptada a móviles para capturar cámara o galería), detecta y recorta sujetos mediante IA, ajusta inteligentemente la escala, los integra en un entorno predefinido y envía el resultado final directamente al cliente vía **WhatsApp**.

---

## 💻 Requisitos de Hardware (Optimización NVIDIA)
Este sistema está diseñado para aprovechar la aceleración por hardware.
* **GPU Recomendada:** NVIDIA GeForce (Serie 20, 30 o 40) con al menos 8GB de VRAM.
* **Tecnología:** El flujo de trabajo utiliza algoritmos intensivos para el recorte y composición.
* **Rendimiento:** Con una GPU NVIDIA el tiempo de procesado y envío será de unos 8-10 segundos. Sin GPU dedicada el tiempo será sustancialmente mayor.

---

## 🛠️ Requisitos de Software
1. **Servidor Backend**
   * **Node.js:** Versión 18 o superior. Requierido para el servidor backend, procesamiento de imágenes (sharp) y la pasarela de WhatsApp.
2. **Motor de IA (ComfyUI)**
   * Instancia de ComfyUI activa procesando la API (por defecto `http://127.0.0.1:8188`).
   * **Nodos Custom Necesarios:**
      * ComfyUI-Inspyrenet-Rembg (o nodo similar RMBG).
      * ComfyUI-Essentials (para nodos de utilidades como redimensionado o posicionamiento).

---

## ⚙️ Instalación paso a paso (Desde Cero)

Sigue estas instrucciones si acabas de clonar/descargar el repositorio en tu ordenador:

**1. Instalar dependencias del proyecto**  
Abre una terminal en la carpeta del proyecto y ejecuta:  
```bash
npm install
```

**2. Configurar las Variables de Entorno (.env)**  
El proyecto requiere un archivo de configuración `.env`. Tienes una plantilla lista para usar:  
- Duplica el archivo `.env.example` y renómbralo a `.env` (sin extensiones).  
- Abre el `.env` con un editor de texto y revisa los valores (por defecto funcionan para el flujo estándar local, pero aquí puedes configurar la escala de la persona `PERSON_SCALE`, el puerto o la URL de tu ComfyUI).

**3. Vinculación y Sesión de WhatsApp**  
- Lanza el servidor backend por primera vez:
```bash
npm start
```
- A los pocos segundos, la consola mostrará un **código QR grande** generado en la propia terminal.
- Abre tu app de WhatsApp en el móvil, ve a *Dispositivos vinculados -> Vincular un dispositivo* y escanea la terminal.
- Verás el mensaje `[WhatsApp] ✅ Cliente conectado y listo para enviar mensajes.`.
- *Nota:* La sesión se guarda en `.wwebjs_auth/` de forma persistente. No tendrás que escanearlo más veces salvo que cierres sesión en el móvil.

**4. Preparar ComfyUI y Assets de Diseño**  
- Asegúrate de que tu `workflow.json` (diseñado en ComfyUI y exportado en formato "Save (API)") está pegado en la misma raíz de este proyecto.
- Los fondos e imágenes auxiliares para inyectar deben estar disponibles o colocados en tu carpeta `input/` de ComfyUI. (Configura el nombre del fondo deseado en el `.env` con la variable `COMFY_BG_FILENAME`).
- El servidor backend se encarga automáticamente de corregir fotos de móviles e inyectarlas al centro.

---

## 🎮 Guía de Uso Rápido

1. Enciende **ComfyUI** (ej. ejecutando su `.bat` o entorno virtual). Asegúrate de que no haya errores iniciales.
2. Abre la terminal en esta carpeta y arranca el servidor Node:
```bash
npm start
```
3. En tu navegador de ordenador o móvil conectado a la misma red, entra a la interfaz web:  
   👉 `http://localhost:3000`  
4. Sube una foto (desde el móvil te ofrecerá **Hacer Foto** o usar la **Galería**).
5. Selecciona el Logo, indica el nombre del Cliente y añade su número de **WhatsApp**.
6. Haz clic en **Iniciar Secuencia de Generación**.
   * El sistema automáticamente ajustará la escala del cliente, inyectará tu workflow de IA a ComfyUI, esperará la finalización, la descargará en la carpeta `/outputs` (creada automáticamente) y la mandará al cliente final de forma instantánea.

---

## 📂 Especificación Técnica de Ajustes (*Troubleshooting*)

* **La persona se ve deformada "tumbada":** Ya se ha arreglado gracias a la integración de la librería `sharp`. El server backend detecta los meta-datos de rotación EXIF de móviles iOS/Android y aplana la imagen horizontalmente antes de inyectarla para no emborronar el recorte.
* **La persona sale muy grande o muy pequeña:** Edita la variable `PERSON_SCALE` en tu `.env`. Un valor de `0.85` representa el 85% de la altura de la imagen total resultante.
* **Error `400 Bad Request`:** Ocurre si faltan assets en ComfyUI o si una imagen es desorbitantemente enorme para la composición. En las últimas versiones el escalado "inteligente" evita este riesgo limitando de forma matemática el crecimiento de la máscara en la composición x,y.
