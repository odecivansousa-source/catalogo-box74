// =====================================================================
// BOX74 - Testes da Integração Meta Embedded Signup & Coexistência
// Validação de Troca de Código por Token, Validação Estrita do Número
// +55 84 98189-6369, Coexistência com App móvel e Endpoints
// =====================================================================

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');

const { config } = require('../src/config');
const { MetaEmbeddedSignupService } = require('../src/services/meta-embedded-signup');
const { CredentialsStore } = require('../src/services/credentials-store');
const { CoexistenceService } = require('../src/services/coexistence-service');
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
  console.log('=== TESTES META EMBEDDED SIGNUP & COEXISTÊNCIA BOX74 ===\n');

  const OFFICIAL_PHONE = '5584981896369';
  const OFFICIAL_DISPLAY = '+55 84 98189-6369';

  // -------------------------------------------------------------
  // 1. VALIDAÇÃO DE NÚMERO OFICIAL CONFIGURADO
  // -------------------------------------------------------------
  console.log('--- 1. Regras do Número Oficial ---');
  it('Configuração aponta estritamente para o número oficial +55 84 98189-6369', () => {
    assert.strictEqual(config.officialPhone.number, OFFICIAL_PHONE);
    assert.strictEqual(config.officialPhone.display, OFFICIAL_DISPLAY);
  });

  // -------------------------------------------------------------
  // 2. EMBEDDED SIGNUP SERVICE & VALIDAÇÃO ESTRITA
  // -------------------------------------------------------------
  console.log('\n--- 2. Meta Embedded Signup Service & Validação ---');
  const mockTransport = {
    graphRequest: async (path, method, body, token) => {
      // Troca de código por token
      if (path.includes('/oauth/access_token')) {
        if (path.includes('code=code_valido_meta')) {
          return {
            statusCode: 200,
            data: {
              access_token: 'EAAB_token_sistema_meta_permanente',
              token_type: 'bearer',
              expires_in: 5184000
            }
          };
        } else {
          return {
            statusCode: 400,
            data: { error: { message: 'Código de autorização inválido ou expirado' } }
          };
        }
      }

      // Consulta de número oficial autorizado (+55 84 98189-6369)
      if (path.includes('/phone_123_oficial')) {
        return {
          statusCode: 200,
          data: {
            id: 'phone_123_oficial',
            display_phone_number: '+55 84 98189-6369',
            verified_name: 'BOX74 MATERIAIS DE LIMPEZA',
            quality_rating: 'GREEN',
            platform_type: 'CLOUD_API_COEXISTENCE'
          }
        };
      }

      // Consulta de número divergente (tentativa de uso de outro número)
      if (path.includes('/phone_999_divergente')) {
        return {
          statusCode: 200,
          data: {
            id: 'phone_999_divergente',
            display_phone_number: '+55 84 99941-5379',
            verified_name: 'Numero Antigo',
            quality_rating: 'GREEN'
          }
        };
      }

      // Subscrição de webhooks no WABA
      if (path.includes('/waba_box74_123/subscribed_apps')) {
        return {
          statusCode: 200,
          data: { success: true }
        };
      }

      return { statusCode: 404, data: { error: 'Not found' } };
    }
  };

  // Mock Supabase para testes sem depender de rede/chaves externas
  const inMemoryDb = new Map();
  const mockSupabase = {
    from: () => ({
      upsert: async (record) => {
        inMemoryDb.set(record.id, { ...record, updated_at: new Date().toISOString() });
        return { data: [inMemoryDb.get(record.id)], error: null };
      },
      select: () => ({
        eq: (col, val) => ({
          single: async () => {
            const row = inMemoryDb.get(val);
            return { data: row || null, error: row ? null : { message: 'Not found' } };
          }
        })
      })
    })
  };

  const store = new CredentialsStore({ supabaseClient: mockSupabase });
  const signupService = new MetaEmbeddedSignupService({
    appId: '1234567890',
    appSecret: 'segredo_app_meta',
    officialNumber: OFFICIAL_PHONE,
    credentialsStore: store,
    mockTransport
  });

  await itAsync('Troca código de autorização válido por token permanente da Meta', async () => {
    const res = await signupService.exchangeCodeForToken('code_valido_meta');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.accessToken, 'EAAB_token_sistema_meta_permanente');
  });

  await itAsync('Rejeita código de autorização inválido ou expirado', async () => {
    const res = await signupService.exchangeCodeForToken('code_invalido');
    assert.strictEqual(res.success, false);
    assert.ok(res.error);
  });

  await itAsync('Valida com sucesso número correspondente ao oficial (+55 84 98189-6369)', async () => {
    const res = await signupService.validatePhoneNumber('phone_123_oficial', 'token_dummy');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.displayPhoneNumber, '+55 84 98189-6369');
    assert.strictEqual(res.coexistenceConfirmed, true);
  });

  await itAsync('Bloqueia estritamente tentativa de conectar número divergente', async () => {
    const res = await signupService.validatePhoneNumber('phone_999_divergente', 'token_dummy');
    assert.strictEqual(res.valid, false);
    assert.ok(res.error.includes('diverge do número oficial autorizado'));
  });

  await itAsync('CredentialsStore rejeita e lança erro caso a persistência falhe', async () => {
    const failingStore = new CredentialsStore({
      supabaseClient: {
        from: () => ({
          upsert: () => Promise.resolve({ data: null, error: { message: 'Erro de permissão no Supabase' } })
        })
      }
    });

    let threw = false;
    try {
      await failingStore.saveCredentials({ wabaId: 'w1', phoneNumberId: 'p1' });
    } catch (e) {
      threw = true;
      assert.ok(e.message.includes('Falha ao persistir credenciais Meta no Supabase'));
    }
    assert.strictEqual(threw, true, 'Deve lançar erro e não declarar sucesso falso');
  });

  await itAsync('CredentialsStore impede fallback para anon e falha explicitamente sem service_role', async () => {
    const anonOnlyStore = new CredentialsStore({
      supabaseClient: null,
      supabaseKey: null
    });
    anonOnlyStore.serviceRoleKey = null;

    let threw = false;
    try {
      await anonOnlyStore.saveCredentials({ wabaId: 'w1', phoneNumberId: 'p1' });
    } catch (e) {
      threw = true;
      assert.ok(e.message.includes('SUPABASE_SERVICE_ROLE_KEY'));
    }
    assert.strictEqual(threw, true, 'Deve falhar explicitamente sem service_role');
  });

  await itAsync('getCredentials() propaga erros de consulta no Supabase sem mascarar', async () => {
    const errorStore = new CredentialsStore({
      supabaseClient: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for table box74_meta_credentials' } })
            })
          })
        })
      }
    });

    let threw = false;
    try {
      await errorStore.getCredentials();
    } catch (e) {
      threw = true;
      assert.ok(e.message.includes('permission denied'));
    }
    assert.strictEqual(threw, true, 'Deve propagar erro em vez de engolir');
  });

  await itAsync('Executa pipeline completo do Embedded Signup e persiste credenciais protegidas', async () => {
    const result = await signupService.processEmbeddedSignup({
      code: 'code_valido_meta',
      wabaId: 'waba_box74_123',
      phoneNumberId: 'phone_123_oficial'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.officialPhone, OFFICIAL_DISPLAY);
    assert.strictEqual(result.status, 'autorizado');
    assert.strictEqual(result.coexistenceStatus, 'ativo');

    // Verifica persistência protegida no CredentialsStore (com token armazenado)
    const saved = await store.getCredentials();
    assert.strictEqual(saved.phone_number, OFFICIAL_PHONE);
    assert.strictEqual(saved.phone_number_id, 'phone_123_oficial');
    assert.strictEqual(saved.waba_id, 'waba_box74_123');
    assert.strictEqual(saved.access_token, 'EAAB_token_sistema_meta_permanente');
  });

  // -------------------------------------------------------------
  // 3. COEXISTÊNCIA COM WHATSAPP BUSINESS APP
  // -------------------------------------------------------------
  console.log('\n--- 3. Coexistência com App no Smartphone ---');
  let silencedPhone = null;
  const mockHandoff = {
    triggerHandoff: async (phone, details) => {
      silencedPhone = phone;
      return { silenced: true };
    }
  };

  const coexistence = new CoexistenceService({
    officialNumber: OFFICIAL_PHONE,
    humanHandoff: mockHandoff,
    enabled: true
  });

  it('Identifica evento com isEcho = true como intervenção humana', () => {
    const echoEvent = { isEcho: true, from: OFFICIAL_PHONE, to: '5585991112222', text: 'Oi, estou respondendo pelo celular' };
    assert.strictEqual(coexistence.isHumanEcho(echoEvent), true);
  });

  it('Identifica mensagem enviada do número oficial para um cliente como intervenção humana', () => {
    const outEvent = { from: OFFICIAL_PHONE, to: '5585991112222', text: 'Mensagem enviada do celular da loja' };
    assert.strictEqual(coexistence.isHumanEcho(outEvent), true);
  });

  it('Não confunde mensagem de cliente como intervenção humana', () => {
    const inEvent = { from: '5585991112222', to: OFFICIAL_PHONE, text: 'Quero comprar sabão' };
    assert.strictEqual(coexistence.isHumanEcho(inEvent), false);
  });

  await itAsync('handleHumanIntervention silencia o bot para o cliente atendido no celular', async () => {
    let mockConversation = { phone: '5585991112222', state: 'atendimento_ia' };
    const mockAgent = {
      getConversation: async () => mockConversation,
      saveConversation: async (c) => { mockConversation = c; },
      recordOutgoingMessage: async () => {}
    };

    const echoEvent = {
      isEcho: true,
      from: OFFICIAL_PHONE,
      to: '5585991112222',
      text: 'Olá, sou a dona da BOX74 e vou continuar seu atendimento!'
    };

    const res = await coexistence.handleHumanIntervention(echoEvent, mockAgent);
    assert.strictEqual(res.handled, true);
    assert.strictEqual(res.action, 'bot_silenced');
    assert.strictEqual(mockConversation.state, 'transf_humano');
    assert.strictEqual(silencedPhone, '5585991112222');
    const isSilencedInitial = await coexistence.isCustomerUnderHumanWindow('5585991112222', mockAgent);
    assert.strictEqual(isSilencedInitial, true);

    // Simulação de reinício do servidor (Map em memória limpo)
    coexistence.recentHumanInterventions.clear();
    assert.strictEqual(coexistence.recentHumanInterventions.size, 0);

    // Consulta durável deve manter a IA pausada recuperando o estado persistido no banco
    const isSilencedAfterRestart = await coexistence.isCustomerUnderHumanWindow('5585991112222', mockAgent);
    assert.strictEqual(isSilencedAfterRestart, true, 'Estado de silenciamento deve ser preservado após reinício');
  });

  await itAsync('Comando MENU limpa estado persistido de atendimento humano e reativa IA', async () => {
    let mockConv = { phone: '5585991112222', state: 'transf_humano', last_human_intervention_at: new Date().toISOString() };
    const testAgent = new WhatsAppAgent({
      supabaseClient: {
        from: () => ({
          select: () => ({ order: () => Promise.resolve({ data: [], error: null }) })
        }),
        rpc: () => Promise.resolve({ data: true, error: null })
      }
    });
    testAgent.getConversation = async () => mockConv;
    testAgent.saveConversation = async (c) => { mockConv = c; };
    testAgent.coexistenceService = coexistence;

    // Coloca cliente na janela recente da coexistência
    coexistence.recentHumanInterventions.set('5585991112222', Date.now());

    // 1. Mensagem comum deve ser ignorada por estar em atendimento humano
    const resIgnored = await testAgent.processMessage({
      from: '5585991112222',
      text: 'Tem alguém aí?',
      messageId: 'msg-test-human-1'
    });
    assert.strictEqual(resIgnored.ignored, true);
    assert.strictEqual(resIgnored.reason, 'in_human_support');

    // 2. Envio de MENU deve resetar o estado persistido e reativar a IA
    const resMenu = await testAgent.processMessage({
      from: '5585991112222',
      text: 'MENU',
      messageId: 'msg-test-menu-1'
    });
    assert.strictEqual(resMenu.state, 'atendimento_ia');
    assert.strictEqual(mockConv.state, 'atendimento_ia');
    assert.strictEqual(mockConv.last_human_intervention_at, null);
    assert.strictEqual(coexistence.recentHumanInterventions.has('5585991112222'), false);
    assert.ok(resMenu.response.includes('Atendimento automático reiniciado'));
  });

  await itAsync('CoexistenceService adota fail-closed se consulta ao Supabase falhar', async () => {
    coexistence.recentHumanInterventions.clear();
    const failingAgent = {
      getConversation: async () => {
        throw new Error('Falha de conexão com banco de dados');
      }
    };
    const isSilenced = await coexistence.isCustomerUnderHumanWindow('5585993334444', failingAgent);
    assert.strictEqual(isSilenced, true, 'Deve retornar true (fail-closed) para não responder automaticamente');
  });

  // -------------------------------------------------------------
  // 4. ENDPOINTS HTTP DO SERVIDOR WEBHOOK
  // -------------------------------------------------------------
  console.log('\n--- 4. Endpoints HTTP de Embedded Signup & Coexistência ---');
  const agent = new WhatsAppAgent();
  const server = createWebhookServer(agent, {
    credentialsStore: store,
    coexistenceService: coexistence,
    mockEmbeddedTransport: mockTransport,
    meta: {
      appSecret: 'segredo_app_meta',
      verifyToken: 'meu_token_box74_verificacao'
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  function doReq(path, method = 'GET', body = null, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
          resolve({ statusCode: res.statusCode, data: parsed });
        });
      });
      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }

  await itAsync('GET /api/meta/embedded-signup/config retorna dados seguros para FB Login SDK', async () => {
    const res = await doReq('/api/meta/embedded-signup/config');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.officialPhoneNumber, OFFICIAL_DISPLAY);
    assert.strictEqual(res.data.coexistenceSupported, true);
    assert.strictEqual(res.data.apiVersion, 'v22.0');
  });

  await itAsync('GET /api/meta/coexistence/status retorna status da coexistência', async () => {
    const res = await doReq('/api/meta/coexistence/status');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.status, 'ativo');
    assert.strictEqual(res.data.officialPhoneNumber, OFFICIAL_DISPLAY);
  });

  await itAsync('GET /api/meta/credentials/status retorna metadados públicos sem expor segredos', async () => {
    const res = await doReq('/api/meta/credentials/status');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.officialPhoneNumber, OFFICIAL_DISPLAY);
    assert.strictEqual(res.data.configured, true);
    assert.strictEqual(res.data.status, 'autorizado');
    assert.strictEqual(res.data.access_token, undefined, 'Tokens secretos NUNCA devem ser expostos na API');
  });

  await itAsync('POST /api/meta/embedded-signup rejeita requisição sem código ou phoneId', async () => {
    const res = await doReq('/api/meta/embedded-signup', 'POST', {});
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.data.success, false);
  });

  await itAsync('POST /api/meta/embedded-signup processa autorização e atualiza credenciais', async () => {
    const res = await doReq('/api/meta/embedded-signup', 'POST', {
      code: 'code_valido_meta',
      wabaId: 'waba_box74_123',
      phoneNumberId: 'phone_123_oficial'
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.officialPhone, OFFICIAL_DISPLAY);
  });

  await itAsync('POST /webhook com payload de echo da coexistência detecta e silencia sem acionar IA', async () => {
    const echoPayload = {
      entry: [{
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: OFFICIAL_PHONE, phone_number_id: 'phone_123_oficial' },
            message_echoes: [{
              id: 'wamid.echo.test.1',
              from: OFFICIAL_PHONE,
              to: '5585977778888',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'Olá! Estou respondendo aqui pelo celular da loja.' }
            }]
          }
        }]
      }]
    };

    const bodyStr = JSON.stringify(echoPayload);
    const sig = crypto.createHmac('sha256', 'segredo_app_meta').update(bodyStr).digest('hex');
    const res = await doReq('/webhook', 'POST', bodyStr, {
      'X-Hub-Signature-256': `sha256=${sig}`
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.coexistence, true);
    assert.strictEqual(res.data.result.action, 'bot_silenced');
  });

  server.close();

  console.log('\n========================================');
  console.log(`TOTAL TESTES EMBEDDED SIGNUP: ${passedTests} passaram, ${failedTests} falharam.`);
  console.log('========================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
