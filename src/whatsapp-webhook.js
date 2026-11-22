// =====================================================================
// BOX74 - Servidor Webhook do WhatsApp (Produção & Coexistência Meta)
// Meta Cloud API Oficial com adaptadores Evolution API e Z-API
// Suporte a Embedded Signup, Coexistência de App móvel e validação HMAC
// =====================================================================

const http = require('http');
const { WhatsAppAgent } = require('./whatsapp-agent');
const { createWhatsAppAdapter } = require('./adapters');
const { CredentialsStore } = require('./services/credentials-store');
const { CoexistenceService } = require('./services/coexistence-service');
const { MetaEmbeddedSignupService } = require('./services/meta-embedded-signup');
const { config } = require('./config');

function createWebhookServer(agent = new WhatsAppAgent(), options = {}) {
  const currentConfig = { ...config, ...options };
  const adapter = options.adapter || createWhatsAppAdapter(currentConfig);

  const credentialsStore = options.credentialsStore || new CredentialsStore({
    supabaseClient: agent.customClient
  });

  const coexistenceService = options.coexistenceService || new CoexistenceService({
    humanHandoff: agent.humanHandoff,
    officialNumber: currentConfig.officialPhone?.number,
    enabled: currentConfig.meta?.coexistenceEnabled
  });

  if (agent && !agent.coexistenceService) {
    agent.coexistenceService = coexistenceService;
  }

  const embeddedSignupService = options.embeddedSignupService || new MetaEmbeddedSignupService({
    appId: currentConfig.meta?.appId,
    appSecret: currentConfig.meta?.appSecret,
    apiVersion: currentConfig.meta?.apiVersion,
    officialNumber: currentConfig.officialPhone?.number,
    credentialsStore,
    mockTransport: options.mockEmbeddedTransport
  });

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
        officialPhone: currentConfig.officialPhone?.display,
        aiEnabled: agent.aiService?.enabled || false,
        coexistenceEnabled: coexistenceService.enabled,
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
        officialPhone: currentConfig.officialPhone?.display,
        humanHandoffsCount: activeHandoffs.length,
        activeHandoffs,
        coexistenceActive: coexistenceService.enabled,
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // 3. Status da Coexistência com WhatsApp Business App
    if (url.pathname === '/api/meta/coexistence/status' && req.method === 'GET') {
      const creds = await credentialsStore.getCredentials();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        officialPhoneNumber: currentConfig.officialPhone?.display,
        officialPhoneNumberRaw: currentConfig.officialPhone?.number,
        coexistenceEnabled: coexistenceService.enabled,
        recentHumanInterventionsCount: coexistenceService.recentHumanInterventions.size,
        status: creds.coexistence_status || 'preparado'
      }));
      return;
    }

    // 4. Configuração pública para o fluxo Meta Embedded Signup (Frontend FB Login SDK)
    if (url.pathname === '/api/meta/embedded-signup/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        appId: currentConfig.meta?.appId || '',
        configId: currentConfig.meta?.configId || '',
        officialPhoneNumber: currentConfig.officialPhone?.display,
        officialPhoneNumberRaw: currentConfig.officialPhone?.number,
        apiVersion: currentConfig.meta?.apiVersion || process.env.META_WA_API_VERSION || 'v22.0',
        coexistenceSupported: true
      }));
      return;
    }

    // 5. Status seguro das credenciais Meta (sem expor segredos)
    if (url.pathname === '/api/meta/credentials/status' && req.method === 'GET') {
      const pubStatus = await credentialsStore.getPublicStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pubStatus));
      return;
    }

    // 6. Callback / Troca do código do Meta Embedded Signup (POST /api/meta/embedded-signup)
    if (url.pathname === '/api/meta/embedded-signup' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { code, wabaId, phoneNumberId, redirectUri } = payload;

          if (!code || !phoneNumberId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Parâmetros code e phoneNumberId são obrigatórios no Embedded Signup.'
            }));
            return;
          }

          const setupResult = await embeddedSignupService.processEmbeddedSignup({
            code,
            wabaId,
            phoneNumberId,
            redirectUri: redirectUri || ''
          });

          if (!setupResult.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(setupResult));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(setupResult));
        } catch (err) {
          console.error('[BOX74 EmbeddedSignup] Erro no endpoint:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // 7. Handshake de verificação do Webhook (Padrão Meta WhatsApp Cloud API)
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

    // 8. Recebimento de eventos e mensagens (POST /webhook)
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        const rawBody = Buffer.concat(chunks);
        const bodyStr = rawBody.toString('utf8');

        // Validação criptográfica de assinatura se for provedor Meta
        if (currentConfig.waProvider === 'meta') {
          const isProd = currentConfig.env === 'production';
          const sigHeader = req.headers['x-hub-signature-256'];

          // Em produção, a ausência de appSecret é estritamente rejeitada por segurança
          if (isProd && !currentConfig.meta.appSecret) {
            console.error('[BOX74 Webhook] ERRO CRÍTICO: META_WA_APP_SECRET não configurado em produção. Requisição rejeitada.');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Configuração insegura: META_WA_APP_SECRET é obrigatório em produção.' }));
            return;
          }

          if (currentConfig.meta.appSecret && typeof adapter.verifySignature === 'function') {
            const verification = adapter.verifySignature(bodyStr, sigHeader, isProd);
            if (!verification.valid) {
              console.warn('[BOX74 Webhook] Assinatura X-Hub-Signature-256 rejeitada:', verification.error);
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Assinatura inválida', detail: verification.error }));
              return;
            }
          } else if (isProd) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Assinatura HMAC-SHA256 ausente em ambiente de produção.' }));
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

          // Tratamento de Coexistência: Detecção de eco de mensagem humana no WhatsApp Business App
          if (parsed.isEcho) {
            const echoResult = await coexistenceService.handleHumanIntervention(parsed, agent);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true, coexistence: true, result: echoResult }));
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

const WEBHOOK_VERIFY_TOKEN = config.meta.verifyToken;

// Inicialização com suporte a encerramento gracioso (Graceful Shutdown)
if (require.main === module) {
  const agent = new WhatsAppAgent();
  const server = createWebhookServer(agent);
  const PORT = config.port;

  server.listen(PORT, config.host, () => {
    console.log(`=======================================================`);
    console.log(`[BOX74] Servidor Webhook do WhatsApp ATIVO`);
    console.log(`[BOX74] Número Oficial: ${config.officialPhone.display} (${config.officialPhone.number})`);
    console.log(`[BOX74] Porta: ${PORT} | Provedor: ${config.waProvider.toUpperCase()}`);
    console.log(`[BOX74] Coexistência com App móvel: HABILITADA`);
    console.log(`[BOX74] Endpoint Webhook: http://${config.host}:${PORT}/webhook`);
    console.log(`[BOX74] Embedded Signup API: http://${config.host}:${PORT}/api/meta/embedded-signup`);
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

module.exports = { createWebhookServer, WEBHOOK_VERIFY_TOKEN };
