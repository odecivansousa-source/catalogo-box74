// =====================================================================
// BOX74 - Servidor Webhook do WhatsApp (Produção)
// Meta Cloud API Oficial com adaptadores Evolution API e Z-API
// Validação de assinatura criptográfica, persistência e envio real
// =====================================================================

const http = require('http');
const { WhatsAppAgent } = require('./whatsapp-agent');
const { createWhatsAppAdapter } = require('./adapters');
const { config } = require('./config');

function createWebhookServer(agent = new WhatsAppAgent(), options = {}) {
  const currentConfig = { ...config, ...options };
  const adapter = options.adapter || createWhatsAppAdapter(currentConfig);

  // Vincula o adapter ao serviço de atendimento humano se configurado
  if (agent.humanHandoff && typeof agent.humanHandoff.setAdapter === 'function') {
    agent.humanHandoff.setAdapter(adapter);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Health check para monitoramento (PM2 / Docker / UptimeRobot)
    if (url.pathname === '/health' && req.method === 'GET') {
      const mem = process.memoryUsage();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        service: 'BOX74 WhatsApp AI Agent',
        provider: currentConfig.waProvider,
        aiEnabled: agent.aiService?.enabled || false,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssMb: Math.round(mem.rss / 1024 / 1024),
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // 2. Status administrativo e clientes em atendimento humano
    if (url.pathname === '/admin/status' && req.method === 'GET') {
      const activeHandoffs = agent.humanHandoff ? agent.humanHandoff.getActiveHandoffs() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        provider: currentConfig.waProvider,
        humanHandoffsCount: activeHandoffs.length,
        activeHandoffs,
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // 3. Handshake de verificação do Webhook (Padrão Meta WhatsApp Cloud API)
    if (url.pathname === '/webhook' && req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      const expectedToken = currentConfig.meta.verifyToken;
      if (mode === 'subscribe' && token === expectedToken) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(challenge);
        return;
      } else {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Token de verificação inválido.');
        return;
      }
    }

    // 4. Recebimento de eventos e mensagens (POST /webhook)
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        const rawBody = Buffer.concat(chunks);
        const bodyStr = rawBody.toString('utf8');

        // Validação criptográfica de assinatura se for provedor Meta
        if (currentConfig.waProvider === 'meta' && currentConfig.meta.appSecret && typeof adapter.verifySignature === 'function') {
          const sigHeader = req.headers['x-hub-signature-256'];
          const verification = adapter.verifySignature(bodyStr, sigHeader);
          if (!verification.valid) {
            console.warn('[BOX74 Webhook] Assinatura X-Hub-Signature-256 rejeitada:', verification.error);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Assinatura inválida', detail: verification.error }));
            return;
          }
        }

        try {
          const payload = JSON.parse(bodyStr || '{}');

          // Parser unificado através do adaptador
          const parsed = adapter.parseIncoming(payload);

          if (!parsed) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true, ignored: true, reason: 'payload_sem_mensagem' }));
            return;
          }

          if (parsed.isStatus) {
            // Confirmação de status (enviado, entregue, lido)
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true, status: parsed.status }));
            return;
          }

          // Processar mensagem no cérebro do agente
          const agentResult = await agent.processMessage(parsed);

          // Se o agente gerou uma resposta para o cliente, envia via adaptador
          let dispatchResult = null;
          if (agentResult && agentResult.response && !agentResult.ignored) {
            dispatchResult = await adapter.sendMessage(parsed.from, agentResult.response);

            // Grava histórico da resposta enviada no Supabase
            if (typeof agent.recordOutgoingMessage === 'function') {
              await agent.recordOutgoingMessage(parsed.messageId, parsed.from, agentResult.response);
            }

            // Marca mensagem do cliente como lida
            if (typeof adapter.markAsRead === 'function') {
              await adapter.markAsRead(parsed.messageId);
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            result: agentResult,
            dispatch: dispatchResult
          }));
        } catch (err) {
          console.error('[BOX74 Webhook] Erro no processamento:', err);
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

// Inicialização com suporte a encerramento gracioso (Graceful Shutdown)
if (require.main === module) {
  const agent = new WhatsAppAgent();
  const server = createWebhookServer(agent);
  const PORT = config.port;

  server.listen(PORT, config.host, () => {
    console.log(`=======================================================`);
    console.log(`[BOX74] Servidor Webhook do WhatsApp ATIVO`);
    console.log(`[BOX74] Porta: ${PORT} | Provedor: ${config.waProvider.toUpperCase()}`);
    console.log(`[BOX74] Endpoint: http://${config.host}:${PORT}/webhook`);
    console.log(`[BOX74] Health Check: http://${config.host}:${PORT}/health`);
    console.log(`=======================================================`);
  });

  const shutdown = () => {
    console.log('\n[BOX74] Encerrando servidor de forma graciosa...');
    server.close(() => {
      console.log('[BOX74] Servidor encerrado.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const WEBHOOK_VERIFY_TOKEN = config.meta.verifyToken;

module.exports = { createWebhookServer, WEBHOOK_VERIFY_TOKEN };
