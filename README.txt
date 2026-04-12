🚀 IA de fotos con fondo personalizado con ComfyUI
Este proyecto es una aplicación web de alto rendimiento que integra ComfyUI con un servidor Node.js para automatizar la creación de branding corporativo. El sistema detecta y recorta sujetos mediante IA, los integra en un entorno de marca y envía el resultado final por WhatsApp.
________________


💻 Requisitos de Hardware (Optimización NVIDIA)
Este sistema está diseñado para aprovechar la aceleración por hardware.
* GPU Recomendada: NVIDIA GeForce (Serie 20, 30 o 40) con al menos 8GB de VRAM.
* Tecnología: El flujo de trabajo utiliza CUDA para el renderizado de los modelos BEN2 e Inspyrenet.
* Drivers: Es imprescindible tener instalados los drivers NVIDIA Game Ready o Studio actualizados para que los nodos de recorte (RMBG) funcionen a máxima velocidad.
* Rendimiento: Con una GPU NVIDIA, el tiempo de respuesta se sincroniza con la barra de carga de 8 segundos de la interfaz. Sin GPU dedicada, el tiempo de procesado aumentará significativamente.
________________


🛠️ Requisitos de Software
1. Servidor Backend
* Node.js: Versión 18 o superior.
* WhatsApp Bridge: La librería whatsapp-web.js gestiona la sesión mediante LocalAuth.
2. Motor de IA (ComfyUI)
* ComfyUI activo en http://127.0.0.1:8188 (De no ser así se puede cambiar en el código).
* Nodos Custom Necesarios:
   * ComfyUI-Inspyrenet-Rembg (o ComfyUI-RMBG).
   * ComfyUI-Essentials (para el nodo ResizeImageMaskNode).
________________


📂 Especificaciones de Assets
Para garantizar la calidad visual y evitar errores de transparencia:
Elemento
	Formato
	Función Técnica
	Cliente - JPG / PNG
	Inyectado en el Nodo 1. La IA genera la máscara mediante el modelo BEN2.
	Logo - PNG Transparente
	Inyectado en el Nodo 13. Debe tener canal Alfa para evitar recuadros negros en la composición final.
	Fondo - JPG
	Fondo base inyectado en el Nodo 3.
	________________


⚙️ Instalación en 3 Pasos
Dependencias:
Bash
npm install
1. 2. Vinculación de WhatsApp:
   * Ejecuta node server.js.
   * Escanea el Código QR que aparecerá en la terminal con tu móvil.
   * La sesión se guardará de forma segura en la carpeta local .wwebjs_auth/.
3. Preparación de ComfyUI:
   * Asegúrate de que el archivo workflow.json esté en la carpeta raíz del servidor.
   * Los nodos de redimensionado 15 y 18 están sincronizados a un multiplicador de 3.04 para mantener la escala del recorte.
________________


🎮 Guía de Uso
1. Inicia ComfyUI y verifica que la consola detecta tu tarjeta NVIDIA (CUDA habilitado).
2. Arranca el servidor: node server.js.
3. Entra en http://localhost:3000.
4. Sube una foto, introduce un nombre y un teléfono (si es español de 9 cifras, el sistema añadirá el prefijo 34 automáticamente).
5. Tras 8 segundos, aparecerá la vista previa tecnológica para confirmar el envío.
