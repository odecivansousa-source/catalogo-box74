// =====================================================================
// BOX74 - Testes da Infraestrutura de Produção do Agente WhatsApp
// Validação de Configuração, Criptografia HMAC-SHA256, Adapters,
// Serviço de IA Contextual, Transbordo Humano e Servidor Webhook
// =====================================================================

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');

const { config, loadEnvFile } = require('../src/config');
const { MetaWhatsAppAdapter } = require('../src/adapters/meta-adapter');
const { EvolutionApiAdapter } = require('../src/adapters/evolution-adapter');
const { ZApiAdapter } = require('../src/adapters/zapi-adapter');
const { createWhatsAppAdapter } = require('../src/adapters');
const { AIService } = require('../src/services/ai-service');
const { HumanHandoffService } = require('../src/services/human-handoff');
const { WhatsAppAgent } = require('../src/whatsapp-agent');
const { createWebhookServer } = require('../src/whatsapp-webhook');

let passedTests = 0;
let failedTests = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`[PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${desc}: ${err.message}`);
    failedTests++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`[PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${desc}: ${err.message}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('=== TESTES DA INFRAESTRUTURA DE PRODUÇÃO BOX74 ===\n');

  // -------------------------------------------------------------
  // 1. CONFIGURAÇÃO E PARSER DE .ENV
  // -------------------------------------------------------------
  console.log('--- 1. Configuração e Variáveis de Ambiente ---');
  it('Configuração carrega com valores padrão seguros', () => {
    assert.ok(config.supabase.url, 'Supabase URL deve estar presente');
    assert.strictEqual(typeof config.port, 'number', 'Porta deve ser numérica');
    assert.ok(config.pix.key, 'Chave Pix da BOX74 deve estar presente');
  });

  it('loadEnvFile ignora arquivos inexistentes sem lançar exceção', () => {
    const res = loadEnvFile('caminho/ficticio/que/nao/existe.env');
    assert.strictEqual(res, false);
  });

  // -------------------------------------------------------------
  // 2. VALIDAÇÃO DE ASSINATURA CRIPTOGRÁFICA META (HMAC-SHA256)
  // -------------------------------------------------------------
  console.log('\n--- 2. Assinatura Criptográfica X-Hub-Signature-256 ---');
  const testSecret = 'secret_box74_producao_teste';
  const metaAdapter = new MetaWhatsAppAdapter({ appSecret: testSecret });
  const rawPayload = JSON.stringify({ entry: [{ id: '123', changes: [] }] });

  it('Assinatura HMAC-SHA256 válida é aprovada com sucesso', () => {
    const expectedHash = crypto.createHmac('sha256', testSecret).update(rawPayload).digest('hex');
    const header = `sha256=${expectedHash}`;
    const result = metaAdapter.verifySignature(rawPayload, header);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.error, null);
  });

  it('Assinatura adulterada é rejeitada', () => {
    const tamperedHeader = 'sha256=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const result = metaAdapter.verifySignature(rawPayload, tamperedHeader);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  it('Cabeçalho de assinatura ausente é rejeitado quando segredo está configurado', () => {
    const result = metaAdapter.verifySignature(rawPayload, null);
    assert.strictEqual(result.valid, false);
  });

  it('Formato inválido de cabeçalho é rejeitado', () => {
    const result = metaAdapter.verifySignature(rawPayload, 'invalido_sem_sha256');
    assert.strictEqual(result.valid, false);
  });

  // -------------------------------------------------------------
  // 3. ADAPTADORES DE MENSAGERIA (META, EVOLUTION, Z-API)
  // -------------------------------------------------------------
  console.log('\n--- 3. Adaptadores de Mensageria ---');
  it('MetaWhatsAppAdapter extrai mensagem de texto corretamente', () => {
    const metaPayload = {
      entry: [{
        changes: [{
          value: {
            contacts: [{ profile: { name: 'João Silva' } }],
            messages: [{
              id: 'wamid.HBgLMTIzNDU2',
              from: '5585988887777',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'Olá, gostaria de saber o valor do sabão' }
            }]
          }
        }]
      }]
    };
    const parsed = metaAdapter.parseIncoming(metaPayload);
    assert.strictEqual(parsed.from, '5585988887777');
    assert.strictEqual(parsed.text, 'Olá, gostaria de saber o valor do sabão');
    assert.strictEqual(parsed.senderName, 'João Silva');
    assert.strictEqual(parsed.isStatus, false);
  });

  it('MetaWhatsAppAdapter detecta eventos de status (delivered/read)', () => {
    const statusPayload = {
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: 'wamid.123', status: 'delivered', recipient_id: '558599999999' }]
          }
        }]
      }]
    };
    const parsed = metaAdapter.parseIncoming(statusPayload);
    assert.strictEqual(parsed.isStatus, true);
    assert.strictEqual(parsed.status, 'delivered');
  });

  await itAsync('MetaWhatsAppAdapter envia mensagem através do transport configurado', async () => {
    let sentTo = null;
    let sentText = null;
    const adapterWithMock = new MetaWhatsAppAdapter({
      token: 'test-token',
      phoneNumberId: '12345',
      mockTransport: {
        sendMessage: async (to, text) => {
          sentTo = to;
          sentText = text;
          return { success: true, messageId: 'msg-mock-meta-1' };
        },
        markAsRead: async () => ({ success: true })
      }
    });

    const res = await adapterWithMock.sendMessage('5585999991111', 'Mensagem de teste BOX74');
    assert.strictEqual(res.success, true);
    assert.strictEqual(sentTo, '5585999991111');
    assert.strictEqual(sentText, 'Mensagem de teste BOX74');
  });

  it('EvolutionApiAdapter extrai mensagem recebida e ignora mensagens de grupos ou enviadas por si próprio', () => {
    const evoAdapter = new EvolutionApiAdapter({ apiKey: 'key', apiUrl: 'http://localhost' });
    const userMsg = {
      data: {
        key: { remoteJid: '5585977776666@s.whatsapp.net', fromMe: false, id: 'evo-1' },
        pushName: 'Maria Santos',
        message: { conversation: 'Tem amaciante?' }
      }
    };
    const parsed = evoAdapter.parseIncoming(userMsg);
    assert.strictEqual(parsed.from, '5585977776666');
    assert.strictEqual(parsed.text, 'Tem amaciante?');

    // Descarte de fromMe
    const selfMsg = { data: { key: { remoteJid: '5585977776666@s.whatsapp.net', fromMe: true } } };
    assert.strictEqual(evoAdapter.parseIncoming(selfMsg), null);

    // Descarte de grupos
    const groupMsg = { data: { key: { remoteJid: '12036302@g.us', fromMe: false } } };
    assert.strictEqual(evoAdapter.parseIncoming(groupMsg), null);
  });

  it('ZApiAdapter extrai mensagem recebida com precisão', () => {
    const zapiAdapter = new ZApiAdapter({ instanceId: 'inst', token: 'tok' });
    const zapiMsg = {
      phone: '5585966665555',
      senderName: 'Carlos Lima',
      text: { message: 'Qual o valor do detergente?' },
      messageId: 'zapi-msg-10'
    };
    const parsed = zapiAdapter.parseIncoming(zapiMsg);
    assert.strictEqual(parsed.from, '5585966665555');
    assert.strictEqual(parsed.text, 'Qual o valor do detergente?');
  });

  it('createWhatsAppAdapter instancia a classe correta conforme waProvider', () => {
    const meta = createWhatsAppAdapter({ waProvider: 'meta' });
    assert.ok(meta instanceof MetaWhatsAppAdapter);

    const evo = createWhatsAppAdapter({ waProvider: 'evolution' });
    assert.ok(evo instanceof EvolutionApiAdapter);

    const zapi = createWhatsAppAdapter({ waProvider: 'zapi' });
    assert.ok(zapi instanceof ZApiAdapter);
  });

  // -------------------------------------------------------------
  // 4. SERVIÇO DE IA CONTEXTUAL (AISERVICE)
  // -------------------------------------------------------------
  console.log('\n--- 4. Serviço de Inteligência Artificial Contextual ---');
  it('AIService gera System Prompt estruturado com catálogo oficial', () => {
    const ai = new AIService({ enabled: false });
    const prompt = ai.buildSystemPrompt([
      { name: 'Sabão Líquido Clarilux', price: 19.0, stock: 15 }
    ]);
    assert.ok(prompt.includes('Vendedor Oficial da BOX74'));
    assert.ok(prompt.includes('NUNCA invente produtos'));
    assert.ok(prompt.includes('Sabão Líquido Clarilux: R$ 19.00'));
  });

  await itAsync('AIService realiza fallback gracioso quando chave não configurada', async () => {
    const ai = new AIService({ enabled: false, apiKey: '' });
    const res = await ai.completeChat([{ role: 'user', content: 'Bom dia' }]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.fallback, true);
  });

  await itAsync('AIService processa resposta com sucesso via handler mockado', async () => {
    const ai = new AIService({
      enabled: true,
      apiKey: 'dummy',
      mockHandler: async (messages) => {
        return { success: true, text: 'Olá! Como posso ajudar você com os produtos BOX74 hoje?' };
      }
    });
    const res = await ai.completeChat([{ role: 'user', content: 'Oi' }]);
    assert.strictEqual(res.success, true);
    assert.ok(res.text.includes('BOX74'));
  });

  // -------------------------------------------------------------
  // 5. ATENDIMENTO HUMANO E NOTIFICAÇÃO DO ADMINISTRADOR
  // -------------------------------------------------------------
  console.log('\n--- 5. Atendimento Humano e Notificação ---');
  await itAsync('HumanHandoffService marca silenciamento e envia alerta via adapter', async () => {
    let sentAlertTo = null;
    let sentAlertContent = null;
    const mockAdapter = {
      sendMessage: async (to, text) => {
        sentAlertTo = to;
        sentAlertContent = text;
        return { success: true };
      }
    };

    const handoff = new HumanHandoffService({
      adminPhone: '5585999990000',
      alertOnHandoff: true,
      adapter: mockAdapter
    });

    const triggerRes = await handoff.triggerHandoff('5585911112222', {
      customerName: 'Cliente Teste',
      lastMessage: 'Quero falar com uma pessoa',
      cartSummary: '1x Sabão Líquido Clarilux'
    });

    assert.strictEqual(triggerRes.silenced, true);
    assert.strictEqual(handoff.isSilenced('5585911112222'), true);
    assert.strictEqual(sentAlertTo, '5585999990000');
    assert.ok(sentAlertContent.includes('Cliente Teste'));
    assert.ok(sentAlertContent.includes('5585911112222'));

    // Reativação
    const resumeRes = handoff.resumeBot('5585911112222');
    assert.strictEqual(resumeRes.wasSilenced, true);
    assert.strictEqual(handoff.isSilenced('5585911112222'), false);
  });

  // -------------------------------------------------------------
  // 6. SERVIDOR WEBHOOK HTTP COMPLETO
  // -------------------------------------------------------------
  console.log('\n--- 6. Servidor Webhook HTTP de Produção ---');
  let mockSupabaseStorage = [];
  const agent = new WhatsAppAgent({
    supabaseClient: {
      from: () => ({
        select: () => ({
          order: () => Promise.resolve({
            data: [
              { id: '1', name: 'Sabão Líquido Clarilux', price: 19.0, stock_quantity: 10, is_active: true }
            ],
            error: null
          })
        })
      }),
      rpc: (fnName, params) => {
        if (fnName === 'box74_record_message') {
          mockSupabaseStorage.push(params);
          return Promise.resolve({ data: true, error: null });
        }
        if (fnName === 'box74_get_conversation') {
          return Promise.resolve({ data: null, error: null });
        }
        if (fnName === 'box74_save_conversation') {
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
    }
  });

  let dispatchedMessages = [];
  const testAdapter = new MetaWhatsAppAdapter({
    appSecret: 'segredo_webhook_teste',
    mockTransport: {
      sendMessage: async (to, text) => {
        dispatchedMessages.push({ to, text });
        return { success: true, messageId: 'meta-out-1' };
      },
      markAsRead: async () => ({ success: true })
    }
  });

  const server = createWebhookServer(agent, {
    adapter: testAdapter,
    meta: {
      verifyToken: 'meu_token_box74_verificacao',
      appSecret: 'segredo_webhook_teste'
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  function doRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: serverPort,
        ...options
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
          resolve({ statusCode: res.statusCode, data: parsed });
        });
      });
      req.on('error', reject);
      if (postData) {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
      req.end();
    });
  }

  await itAsync('GET /health retorna status healthy e métricas de memória', async () => {
    const res = await doRequest({ path: '/health', method: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.status, 'healthy');
    assert.strictEqual(typeof res.data.memoryRssMb, 'number');
  });

  await itAsync('GET /admin/status retorna contagem de handoffs', async () => {
    const res = await doRequest({ path: '/admin/status', method: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(typeof res.data.humanHandoffsCount, 'number');
  });

  await itAsync('GET /webhook handshake com token correto retorna hub.challenge', async () => {
    const res = await doRequest({
      path: '/webhook?hub.mode=subscribe&hub.verify_token=meu_token_box74_verificacao&hub.challenge=11223344',
      method: 'GET'
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(String(res.data), '11223344');
  });

  await itAsync('GET /webhook handshake com token errado retorna HTTP 403', async () => {
    const res = await doRequest({
      path: '/webhook?hub.mode=subscribe&hub.verify_token=token_falso&hub.challenge=11223344',
      method: 'GET'
    });
    assert.strictEqual(res.statusCode, 403);
  });

  await itAsync('POST /webhook rejeita payload com assinatura inválida com HTTP 401', async () => {
    const payload = JSON.stringify({ entry: [] });
    const res = await doRequest({
      path: '/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=assinatura_falsa_invalida'
      }
    }, payload);
    assert.strictEqual(res.statusCode, 401);
  });

  await itAsync('POST /webhook processa mensagem válida com assinatura correta e responde cliente', async () => {
    const clientPayload = {
      entry: [{
        changes: [{
          value: {
            contacts: [{ profile: { name: 'Cliente Real' } }],
            messages: [{
              id: 'wamid-real-prod-10',
              from: '5585991122334',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'catalogo' }
            }]
          }
        }]
      }]
    };
    const bodyStr = JSON.stringify(clientPayload);
    const validSig = crypto.createHmac('sha256', 'segredo_webhook_teste').update(bodyStr).digest('hex');

    const res = await doRequest({
      path: '/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': `sha256=${validSig}`
      }
    }, bodyStr);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(dispatchedMessages.length > 0, 'Mensagem deve ter sido despachada pelo adapter');
    assert.strictEqual(dispatchedMessages[0].to, '5585991122334');
    assert.ok(dispatchedMessages[0].text.includes('Catálogo BOX74'));

    // Verifica persistência de mensagem no Supabase
    const recordedOutbound = mockSupabaseStorage.find(m => m.p_direction === 'outbound');
    assert.ok(recordedOutbound, 'Mensagem de saída deve ter sido registrada no histórico');
  });

  server.close();

  console.log('\n========================================');
  console.log(`TOTAL TESTES INFRAESTRUTURA: ${passedTests} passaram, ${failedTests} falharam.`);
  console.log('========================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
