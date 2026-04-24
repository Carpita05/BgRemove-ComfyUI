# 🤖 BgRemove-ComfyUI — Montajes Fotográficos con IA

Aplicación web que integra **ComfyUI** con un servidor **Node.js** para automatizar la creación de montajes fotográficos corporativos. Detecta y recorta sujetos con IA, los compone dinámicamente sobre un fondo personalizado con logo, añade texto de celebración y envía el resultado directamente al cliente vía **WhatsApp**.

---

## 📋 Índice

1. [Requisitos de Hardware](#-requisitos-de-hardware)
2. [Requisitos de Software](#-requisitos-de-software)
3. [Instalación paso a paso](#%EF%B8%8F-instalación-paso-a-paso)
4. [Configuración del .env](#-configuración-del-env-referencia-completa)
5. [Ajuste de Imágenes y Composición](#-ajuste-de-imágenes-y-composición)
6. [Estructura del Proyecto](#-estructura-del-proyecto)
7. [Guía de Uso Rápido](#-guía-de-uso-rápido)
8. [Solución de Problemas](#-solución-de-problemas)

---

## 💻 Requisitos de Hardware

| Componente | Recomendado | Mínimo |
|---|---|---|
| GPU | NVIDIA Serie 30/40 — 8GB+ VRAM | CPU (lento) |
| RAM | 16 GB | 8 GB |
| Almacenamiento | SSD (velocidad de I/O) | HDD |

> **Rendimiento esperado:** Con GPU NVIDIA, el ciclo completo (subida → IA → composición → WhatsApp) tarda aproximadamente **8–15 segundos**. Sin GPU el tiempo será significativamente mayor.

---

## 🛠️ Requisitos de Software

### 1. Node.js

- **Versión mínima:** Node.js **18 LTS** o superior.
- Descarga: [nodejs.org](https://nodejs.org)
- Verifica tu versión: `node -v`

### 2. ComfyUI

- Instancia de ComfyUI activa y accesible en `http://127.0.0.1:8188` (configurable).
- **Nodos personalizados necesarios** (instalar vía ComfyUI Manager):
  - `ComfyUI-Inspyrenet-Rembg` — para eliminación de fondo (nodo RMBG).
  - `ComfyUI-Essentials` — para nodos de utilidad: redimensionado, posicionamiento y composición.

### 3. WhatsApp

- Un número de WhatsApp activo en un móvil físico para escanear el código QR la primera vez.

---

## ⚙️ Instalación paso a paso

### Paso 1 — Instalar dependencias Node

```bash
npm install
```

Esto instalará: `express`, `multer`, `sharp`, `whatsapp-web.js`, `axios`, `dotenv` y el resto de dependencias listadas en `package.json`.

### Paso 2 — Crear el archivo `.env`

```bash
# En Windows
copy .env.example .env

# En Linux / macOS
cp .env.example .env
```

Abre el `.env` recién creado y revisa cada variable (ver sección de referencia abajo).

### Paso 3 — Preparar los assets en ComfyUI

1. Copia tu imagen de **fondo** (p. ej. `fondo.jpg`) a la carpeta `input/` de tu instalación de ComfyUI.
2. Copia los archivos de **logo** (`logo.png`, `logo2.png`, `logo3.png`) a la misma carpeta `input/` de ComfyUI.
   - **Alternativa:** si ComfyUI no puede acceder al logo, el servidor lo leerá automáticamente desde la carpeta local `./images/` del proyecto.
3. Asegúrate de que el `workflow.json` del proyecto está en la **raíz** del repositorio (ya incluido).

### Paso 4 — Vincular WhatsApp (solo la primera vez)

```bash
npm start
```

- Espera unos segundos. La consola mostrará un **código QR** en texto.
- En tu móvil, abre WhatsApp → **Dispositivos vinculados → Vincular un dispositivo** → escanea el QR.
- Cuando veas `[WhatsApp] ✅ Cliente conectado y listo para enviar mensajes.`, el setup está completo.
- La sesión se guarda en `.wwebjs_auth/` de forma **persistente**. No tendrás que repetir este paso salvo que cierres sesión desde el móvil.

### Paso 5 — Arrancar el servidor

```bash
# Producción (sin recarga automática)
npm start

# Desarrollo (recarga automática al editar archivos)
npm run dev
```

La interfaz estará disponible en: **`http://localhost:3000`**

---

## 🔧 Configuración del `.env` — Referencia completa

```dotenv
# URL del servidor ComfyUI (sin barra final)
# Cámbialo si ComfyUI corre en otro puerto o máquina de tu red.
COMFY_URL=http://127.0.0.1:8188

# Puerto en el que arrancará el servidor Express
PORT=3000

# ── Composición de imágenes ──────────────────────────────────────────

# Nombre del archivo de fondo tal como aparece en la carpeta input/ de ComfyUI.
# Incluye la extensión y los espacios si los tiene (ejemplo: "fondo (1).jpg").
COMFY_BG_FILENAME=fondo (1).jpg

# Fracción de la altura del fondo que puede ocupar la persona (0.1 – 1.0).
# 0.80 = la persona puede ocupar hasta el 80% de la altura total del fondo.
# Auméntalo si la persona sale pequeña. Redúcelo si sale demasiado grande.
PERSON_SCALE=0.80

# ── IDs de nodos del workflow.json ───────────────────────────────────

# ID del nodo que carga el logo en el workflow.
# Cámbialo si exportas un workflow propio con un nodo de logo en diferente posición.
COMFY_NODE_LOGO_ID=13

# ID del nodo SaveImage (salida final) en el workflow.
# Cámbialo si tu nodo de guardado tiene un ID diferente.
COMFY_NODE_OUTPUT_ID=5

# ── WhatsApp ─────────────────────────────────────────────────────────

# Prefijo telefónico internacional por defecto.
# Se antepone automáticamente si el número introducido tiene solo 9 dígitos.
PHONE_PREFIX=34

# URL de reseña de Google que se adjunta al mensaje de WhatsApp.
GOOGLE_REVIEW_URL=https://g.page/r/CWAYKlgUL2eKEAE/review
```

---

## 🖼️ Ajuste de Imágenes y Composición

Esta es la sección clave para personalizar el resultado visual del montaje.

### Cambiar el fondo

1. Copia el nuevo archivo de fondo a la carpeta `input/` de ComfyUI.
2. Actualiza la variable en tu `.env`:
   ```dotenv
   COMFY_BG_FILENAME=mi_nuevo_fondo.jpg
   ```
3. Reinicia el servidor (`npm start`).

> El servidor detecta automáticamente las dimensiones del fondo en cada petición y calcula la composición en consecuencia.

---

### Cambiar o añadir logos

Los logos se seleccionan desde el desplegable del formulario web.

**Para añadir un nuevo logo:**

1. Copia el archivo `logo_nuevo.png` a la carpeta `input/` de ComfyUI y/o a `./images/` del proyecto (fallback local).
2. Añade una opción al `<select>` en `public/index.html`:
   ```html
   <option value="logo_nuevo.png">Mi Nuevo Logo</option>
   ```

**Comportamiento automático del logo:**

El servidor aplica un recorte de bordes negros/transparentes (`trim`) al logo antes de calcular su posición. Esto garantiza que el logo se centre y escale correctamente aunque el archivo PNG tenga márgenes vacíos.

Puedes ajustar la tolerancia del recorte en `src/comfyClient.js` (función `prepareAndUploadLogo`):
```js
.trim({ background: '#000000', threshold: 30 })
//                              ^^^
//  Aumenta este valor (0-255) si el fondo del logo no se recorta completamente.
//  Redúcelo si se recorta parte del propio logo.
```

---

### Ajustar el tamaño y posición del logo

El logo se escala automáticamente para ocupar como máximo el **55% del ancho** y el **18% del alto** del fondo. Para modificar estos límites, edita las constantes en `src/comfyClient.js` (función `processImage`):

```js
const LOGO_TARGET_WIDTH_RATIO = 0.55;  // 55% del ancho del fondo
const LOGO_MAX_HEIGHT_RATIO   = 0.18;  // 18% del alto del fondo (como límite)
const LOGO_MARGIN_TOP         = Math.max(15, Math.round(bg.height * 0.025)); // margen superior
const LOGO_MARGIN_BOTTOM      = Math.max(10, Math.round(bg.height * 0.015)); // margen inferior al logo
```

---

### Ajustar el tamaño de la persona

**Método rápido (sin tocar código):**
```dotenv
# En tu .env:
PERSON_SCALE=0.90   # Persona más grande (90% del alto del fondo)
PERSON_SCALE=0.65   # Persona más pequeña (65% del alto del fondo)
```

**Posición vertical:** La persona se ancla automáticamente a la **parte inferior** del fondo, de modo que los pies siempre toquen el suelo. Esto se gestiona en `src/comfyClient.js`:
```js
const personY = Math.max(0, bg.height - processed.height);
```

---

### Personalizar el texto "¡FELICIDADES!"

El texto se genera dinámicamente con el nombre del cliente y se superpone en la **banda inferior** de la imagen final. Para modificar su apariencia, edita la función `addTextOverlay` en `src/comfyClient.js`:

```js
// Zona inferior reservada para el texto: 12% del alto, mínimo 80px
const bannerHeight = Math.max(80, Math.round(imgHeight * 0.12));
//                  ^^^ Aumenta este valor para una banda más alta

// Color del texto y del borde
fill="WHITE"          // Color principal del texto
stroke="#CC0000"      // Color del borde/contorno (rojo por defecto)

// El tamaño de fuente es adaptativo y se calcula solo. Si quieres forzarlo:
fontSize = 60; // descomenta y asigna un valor fijo
```

---

### Calidad de imagen de salida

La imagen del cliente se procesa con `sharp` a calidad JPEG **92%**. Para modificarlo, edita `preprocessImage` en `src/comfyClient.js`:

```js
.jpeg({ quality: 92, progressive: true })
//              ^^^ Rango: 1 (baja calidad) – 100 (máxima calidad)
```

La imagen final también se exporta a calidad 92% en `addTextOverlay`:
```js
.jpeg({ quality: 92 })
```

---

## 📂 Estructura del Proyecto

```
BgRemove-ComfyUI/
├── public/
│   ├── index.html          # Interfaz web del formulario
│   └── style.css           # Estilos (paleta tech: cyan, rojo, azul oscuro)
├── src/
│   ├── config.js           # Carga y valida variables de entorno
│   ├── comfyClient.js      # Toda la lógica de composición con IA
│   ├── whatsappBot.js      # Cliente WhatsApp (sesión QR)
│   └── routes/
│       └── imageRoutes.js  # Rutas Express (/procesar-imagen)
├── images/                 # Logos en fallback local (si ComfyUI no los tiene)
├── uploads/                # Temporales de subida (auto-gestionado)
├── outputs/                # Imágenes generadas (auto-gestionado)
├── workflow.json           # Workflow de ComfyUI en formato API
├── .env                    # Variables de entorno (NO subir al repositorio)
├── .env.example            # Plantilla del .env
├── server.js               # Entry point de la aplicación
└── package.json
```

---

## 🎮 Guía de Uso Rápido

1. Enciende **ComfyUI** (ejecuta su `.bat` o entorno virtual). Verifica que no haya errores en su consola.
2. Arranca el servidor Node:
   ```bash
   npm start
   ```
3. Abre la interfaz en tu navegador (PC o móvil en la misma red):
   ```
   http://localhost:3000
   ```
4. Rellena el formulario:
   - **Foto del cliente** — desde cámara o galería (en móvil aparecen ambas opciones).
   - **Logo** — selecciona la variante del desplegable.
   - **Nombre del cliente** — para personalizar el texto ¡FELICIDADES!
   - **Número WhatsApp** — con o sin prefijo (se añade automáticamente si falta).
5. Pulsa **Iniciar Secuencia de Generación**.

El sistema corregirá la orientación EXIF, escalará la foto, la enviará a ComfyUI, esperará el resultado, añadirá el texto y lo enviará por WhatsApp automáticamente.

---

## 🔴 Solución de Problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Cannot read properties of undefined (reading 'path')` | El formulario se envió sin imagen adjunta | Asegúrate de seleccionar una foto antes de enviar |
| `❌ Variable de entorno requerida: "COMFY_URL"` | Falta el archivo `.env` | Ejecuta `copy .env.example .env` y reinicia |
| La persona sale deformada / tumbada | Metadatos EXIF de móvil | Ya se corrige automáticamente con `sharp.rotate()`. Si persiste, actualiza `sharp`: `npm update sharp` |
| La persona sale muy grande o muy pequeña | `PERSON_SCALE` incorrecto | Ajusta `PERSON_SCALE` en `.env` (rango recomendado: `0.65` – `0.95`) |
| El logo no aparece o sale mal posicionado | Bordes negros no recortados | Aumenta el `threshold` en `prepareAndUploadLogo` (valor por defecto: `30`) |
| Error `400 Bad Request` desde ComfyUI | Asset no encontrado en `input/` de ComfyUI | Verifica que el fondo y los logos están en la carpeta `input/` de ComfyUI |
| `Timeout: ComfyUI no completó...` | ComfyUI sin recursos o apagado | Comprueba que ComfyUI está activo y sin errores en su consola |
| WhatsApp no envía | Sesión caducada | Elimina `.wwebjs_auth/`, reinicia el servidor y escanea el QR de nuevo |
