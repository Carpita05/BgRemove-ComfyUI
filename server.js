'use strict';

/**
 * @file server.js
 * Entry point de la aplicación BgRemove-ComfyUI.
 *
 * Responsabilidades exclusivas de este archivo:
 *   - Cargar la configuración (y validar variables de entorno).
 *   - Crear y configurar la app Express.
 *   - Registrar los middlewares globales y las rutas.
 *   - Inicializar el cliente de WhatsApp (efecto secundario de importar el módulo).
 *   - Iniciar el servidor HTTP.
 *
 * Toda la lógica de negocio vive en src/.
 */

// config.js DEBE importarse primero: carga dotenv y valida las vars de entorno.
const config      = require('./src/config');
const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const imageRoutes = require('./src/routes/imageRoutes');

// Carga el módulo de WhatsApp (adaptador HTTP hacia Evolution API; sin QR ni estado local).
require('./src/whatsappBot');

// ── Directorios necesarios ───────────────────────────────────────────────────
// Garantiza que ./uploads/ y ./outputs/ existen antes de recibir peticiones.
['uploads', 'outputs'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.info(`[server] Directorio creado: ${fullPath}`);
  }
});

// ── App Express ──────────────────────────────────────────────────────────────
const app = express();

// Parsear cuerpos de formularios HTML (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos del frontend (HTML, CSS, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Imágenes generadas accesibles como estáticos bajo /outputs/
// Esto permite que la etiqueta <img src="/outputs/..."> funcione directamente.
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));

// ── Rutas de la API ──────────────────────────────────────────────────────────
app.use('/', imageRoutes);

// ── Arranque ─────────────────────────────────────────────────────────────────
app.listen(config.PORT, () => {
  console.info(`\n🚀 Servidor activo en http://localhost:${config.PORT}`);
  console.info(`   ComfyUI esperado en: ${config.COMFY_URL}\n`);
});