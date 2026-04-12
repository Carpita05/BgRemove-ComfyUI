const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
if (!fs.existsSync('uploads')) { fs.mkdirSync('uploads'); }
const upload = multer({ dest: 'uploads/' });
const COMFY_URL = 'http://127.0.0.1:8188';

const ID_NODO_LOGO = "13";
const PLACE_ID = "ChIJvyh80bMpQg0RYBgqWBQvZ4o"; // Tu Place ID
const GOOGLE_REVIEW_URL = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('¡WhatsApp Conectado!'));
client.initialize();

async function enviarWhatsApp(telefono, nombre, filename) {
    try {
        let num = telefono.replace(/\D/g, '');
        if (num.length === 9) { num = '34' + num; }
        const numberId = await client.getNumberId(num);
        if (!numberId) throw new Error("Número no válido");
        const media = MessageMedia.fromFilePath(path.join(__dirname, '..', 'ComfyUI', 'output', filename));
        await client.sendMessage(numberId._serialized, media, {
            caption: `¡Hola ${nombre}! ✨ Aquí tienes tu foto. Valóranos: ${GOOGLE_REVIEW_URL}`
        });
    } catch (err) { console.error("Error WhatsApp:", err.message); }
}

app.get('/ver-resultado/:filename', async (req, res) => {
    try {
        const response = await axios.get(`${COMFY_URL}/view`, {
            params: { filename: req.params.filename, type: 'output' },
            responseType: 'stream'
        });
        response.data.pipe(res);
    } catch (e) { res.status(404).send('Error'); }
});

app.post('/procesar-imagen', upload.single('foto_cliente'), async (req, res) => {
    try {
        const { telefono, nombre_cliente, logo_empresa } = req.body;
        const formData = new FormData();
        formData.append('image', fs.createReadStream(req.file.path), Date.now() + "_" + req.file.originalname);
        const up = await axios.post(`${COMFY_URL}/upload/image`, formData, { headers: formData.getHeaders() });

        const workflow = JSON.parse(fs.readFileSync('workflow.json', 'utf8'));
        workflow["1"].inputs.image = up.data.name;
        workflow["3"].inputs.image = "fondo (1).jpg";
        workflow[ID_NODO_LOGO].inputs.image = logo_empresa;

        const promptResponse = await axios.post(`${COMFY_URL}/prompt`, { prompt: workflow });
        const promptId = promptResponse.data.prompt_id;
        fs.unlinkSync(req.file.path);

        let outputFilename = null;
        while (!outputFilename) {
            await new Promise(r => setTimeout(r, 1500));
            const hist = await axios.get(`${COMFY_URL}/history/${promptId}`);
            if (hist.data[promptId]?.status?.completed) {
                outputFilename = hist.data[promptId].outputs["5"].images[0].filename;
            }
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head><link rel="stylesheet" href="/style.css"></head>
            <body>
                <div class="card">
                    <div id="loading">
                        <h1 style="color: var(--neon-blue);">PROCESANDO DATOS...</h1>
                        <div class="bar"><div class="fill"></div></div>
                        <p style="color: #94a3b8;">Sincronizando capas para ${nombre_cliente}</p>
                    </div>
                    <div id="result" style="display:none;">
                        <h2 style="color: var(--neon-purple);">VISTA PREVIA GENERADA</h2>
                        <img src="/ver-resultado/${outputFilename}">
                        <form action="/enviar-confirmacion" method="POST">
                            <input type="hidden" name="telefono" value="${telefono}">
                            <input type="hidden" name="nombre" value="${nombre_cliente}">
                            <input type="hidden" name="filename" value="${outputFilename}">
                            <button type="submit">✅ TRANSMITIR POR WHATSAPP</button>
                        </form>
                        <a href="/" style="display:block; margin-top:20px; color: var(--neon-red); text-decoration:none; font-size: 0.8rem; font-weight: bold;">[ ABORTAR OPERACIÓN ]</a>
                    </div>
                </div>
                <script>
                    setTimeout(() => {
                        document.getElementById('loading').style.display = 'none';
                        document.getElementById('result').style.display = 'block';
                    }, 8000); // 8 segundos exactos
                </script>
            </body>
            </html>
        `);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/enviar-confirmacion', async (req, res) => {
    const { telefono, nombre, filename } = req.body;
    await enviarWhatsApp(telefono, nombre, filename);
    res.send(`<body style="text-align:center;padding:50px;font-family:sans-serif;"><h1>¡Enviado! ✅</h1><a href="/">Siguiente</a></body>`);
});

app.listen(3000, () => console.log('🚀 Servidor en http://localhost:3000'));