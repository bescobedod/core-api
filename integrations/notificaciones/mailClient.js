const axios = require('axios');

const MAIL_SERVICE_URL = 'https://services.sistemaspinulito.com/notificaciones/mail/send';

// Envía un correo vía el servicio central de notificaciones (el mismo que
// ya se usa en PIOAPP). emailReceptor puede ser un string separado por
// comas o un arreglo de correos. No lanza si el envío falla en un sentido
// "duro" para el flujo que lo llama — el caller decide si un fallo de
// correo debe bloquear la acción principal o solo quedar como aviso.
async function enviarCorreo({ emisor, emailReceptor, asunto, bodyHtml }) {
    const destinatarios = Array.isArray(emailReceptor)
        ? emailReceptor.filter(Boolean).join(', ')
        : emailReceptor;

    if (!destinatarios) {
        throw new Error('emailReceptor es requerido para enviar el correo');
    }

    const basicAuth = Buffer
        .from(`${process.env.BASIC_NOTI_AUTH_USER}:${process.env.BASIC_NOTI_AUTH_PASS}`)
        .toString('base64');

    try {
        const response = await axios.post(MAIL_SERVICE_URL, {
            emisor,
            email_receptor: destinatarios,
            asunto,
            data_context: {
                body: bodyHtml
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${basicAuth}`
            }
        });

        return response.data;
    } catch (error) {
        console.log("===== SERVICIO DE NOTIFICACIONES ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const mensajeServicio =
            typeof error.response?.data === 'string'
                ? error.response.data
                : error.response?.data?.message || error.response?.data?.error || error.response?.data?.detail;

        throw new Error(mensajeServicio || error.message);
    }
}

module.exports = {
    enviarCorreo
};