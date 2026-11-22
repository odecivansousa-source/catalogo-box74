// =====================================================================
// BOX74 - Webhook do WhatsApp (Meta Cloud API / Evolution / Z-API / Baileys)
// Recebe mensagens de clientes e despacha para o motor de atendimento IA
// =====================================================================

const http = require('http');
const { WhatsAppAgent } = require('./whatsapp-agent');

const PORT = process.env.PORT || 3000;
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'box74_webhook_token_seguro';

function createWebhookServer(agent = new WhatsAppAgent()) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'BOX74 WhatsApp AI Agent', time: new Date().toISOString() }));
      return;
    }

    // Handshake de verificação do Webhook (Padrão Meta WhatsApp Cloud API)
    if (url.pathname === '/webhook' && req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(challenge);
        return;
      } else {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Token de verificação inválido.');
        return;
      }
    }

    // Recebimento de mensagens recebidas (POST /webhook)
    if (url.pathname === '/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');

          // Extrair mensagem no padrão Meta Cloud API ou formato genérico
          let messageData = null;

          if (payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            const metaMsg = payload.entry[0].changes[0].value.messages[0];
            if (metaMsg.type === 'text') {
              messageData = {
                messageId: metaMsg.id,
                from: metaMsg.from,
                text: metaMsg.text?.body || ''
              };
            }
          } else if (payload.from && payload.text) {
            // Formato direto / Simplificado
            messageData = {
              messageId: payload.messageId || payload.id || `msg-${Date.now()}`,
              from: payload.from,
              text: payload.text
            };
          }

          if (messageData) {
            const result = await agent.processMessage(messageData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, result }));
          } else {
            // Eventos de status ou mensagens não de texto retornam 200 para confirmar recebimento
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true, ignored: true }));
          }
        } catch (err) {
          console.error('Erro no processamento do webhook:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return server;
}

if (require.main === module) {
  const agent = new WhatsAppAgent();
  const server = createWebhookServer(agent);
  server.listen(PORT, () => {
    console.log(`[BOX74] Servidor Webhook do WhatsApp rodando na porta ${PORT}`);
    console.log(`[BOX74] Endpoint: http://localhost:${PORT}/webhook`);
  });
}

module.exports = { createWebhookServer, WEBHOOK_VERIFY_TOKEN };
