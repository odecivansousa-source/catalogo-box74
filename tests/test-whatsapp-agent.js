// Testes do Cérebro do Agente de Atendimento WhatsApp BOX74
const { WhatsAppAgent } = require('../src/whatsapp-agent');
const { createWebhookServer, WEBHOOK_VERIFY_TOKEN } = require('../src/whatsapp-webhook');
const http = require('http');
const crypto = require('crypto');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`[PASS] ${msg}`);
    passed++;
  } else {
    console.error(`[FAIL] ${msg}`);
    failed++;
  }
}

async function run() {
  console.log('=== TESTES DO CÉREBRO DO AGENTE DE ATENDIMENTO WHATSAPP BOX74 ===\n');

  // Catálogo Mock com dados dos produtos oficiais BOX74
  const catalogMock = [
    { id: 'box74-1', name: 'Sabão Líquido Clarilux', category: 'Sabão líquido', size: '5 litros', price: 19.00, promo_price: null, stock: 20 },
    { id: 'box74-2', name: 'Sabão Líquido Lavalu', category: 'Sabão líquido', size: '5 litros', price: 17.00, promo_price: null, stock: 15 },
    { id: 'box74-3', name: 'Amaciante de Roupas Clarilux', category: 'Amaciante', size: '5 litros', price: 15.00, promo_price: null, stock: 10 },
    { id: 'box74-4', name: 'Detergente Lava-Louças Clarilux', category: 'Detergente', size: '5 litros', price: 12.00, promo_price: 10.00, stock: 25 },
    { id: 'box74-5', name: 'Polidor de Alumínio DDA-4 Clarilux', category: 'Limpeza pesada', size: '5 litros', price: 17.00, promo_price: null, stock: 8 },
    { id: 'box74-6', name: 'Pasta de Pinho Clarilimp', category: 'Pasta de pinho', size: '5 litros', price: 25.00, promo_price: null, stock: 5 },
    { id: 'box74-7', name: 'Desinfetante Lavalu', category: 'Desinfetante', size: '5 litros', price: 10.00, promo_price: null, stock: 30 },
    { id: 'box74-8', name: 'Água Sanitária Lavalu', category: 'Água sanitária', size: '5 litros', price: 10.00, promo_price: null, stock: 20 },
    { id: 'box74-9', name: 'Lava Auto Lavalu', category: 'Automotivo', size: '5 litros', price: 15.00, promo_price: null, stock: 12 },
    { id: 'box74-10', name: 'Produto Esgotado Teste', category: 'Outros', size: '5 litros', price: 20.00, promo_price: null, stock: 0 }
  ];

  const agent = new WhatsAppAgent();
  agent.catalogCache = catalogMock;
  agent.catalogCacheTime = Date.now();

  const runId = Date.now();
  const msgId = (id) => `t${runId}-${id}`;

  const phoneClienteA = `55849${Math.floor(10000000 + Math.random() * 90000000)}`;
  const phoneClienteB = `55849${Math.floor(10000000 + Math.random() * 90000000)}`;

  // -------------------------------------------------------------
  // REQUISITO 1: Atendimento Inteligente & Erros de Digitação
  // -------------------------------------------------------------
  console.log('--- REQUISITO 1: Atendimento Inteligente & Compreensão Natural ---');
  const r1 = await agent.processMessage({ messageId: msgId('m1'), from: phoneClienteA, text: 'Oi, bom dia!' });
  assert(r1.response && r1.response.includes('BOX74'), 'Saudação respondida com mensagem acolhedora da BOX74');

  // Tolerância a erros de digitação (fuzzy matching)
  const pTypo1 = agent.findProductInCatalog(catalogMock, 'sabaum clarilux');
  assert(pTypo1 && pTypo1.id === 'box74-1', 'Reconheceu "sabaum clarilux" como "Sabão Líquido Clarilux"');

  const pTypo2 = agent.findProductInCatalog(catalogMock, 'amacianti');
  assert(pTypo2 && pTypo2.id === 'box74-3', 'Reconheceu "amacianti" como "Amaciante de Roupas Clarilux"');

  const pTypo3 = agent.findProductInCatalog(catalogMock, 'deterjente');
  assert(pTypo3 && pTypo3.id === 'box74-4', 'Reconheceu "deterjente" como "Detergente Lava-Louças Clarilux"');

  // -------------------------------------------------------------
  // REQUISITO 2: Consulta ao Catálogo
  // -------------------------------------------------------------
  console.log('\n--- REQUISITO 2: Consulta ao Catálogo ---');
  const rCat = await agent.processMessage({ messageId: msgId('m2'), from: phoneClienteA, text: 'Gostaria de ver o catálogo de produtos' });
  assert(rCat.response.includes('Sabão Líquido Clarilux'), 'Resposta do catálogo exibe Sabão Líquido');
  assert(rCat.response.includes('R$ 19,00'), 'Preço oficial R$ 19,00 apresentado');
  assert(rCat.response.includes('Promoções ativas'), 'Promoção ativa do detergente destacada no catálogo');

  // Consulta pontual de preço
  const rPreco = await agent.processMessage({ messageId: msgId('m3'), from: phoneClienteA, text: 'Quanto custa a pasta de pinho?' });
  assert(rPreco.response.includes('Pasta de Pinho Clarilimp') && rPreco.response.includes('R$ 25,00'), 'Consulta pontual de preço respondeu com R$ 25,00');

  // -------------------------------------------------------------
  // REQUISITO 3: Recomendação de Produtos por Necessidade
  // -------------------------------------------------------------
  console.log('\n--- REQUISITO 3: Recomendação de Produtos por Necessidade ---');
  const rRec1 = await agent.processMessage({ messageId: msgId('m4'), from: phoneClienteA, text: 'Preciso de produtos para lavar roupas' });
  assert(rRec1.response.includes('Sabão Líquido') && rRec1.response.includes('Amaciante'), 'Recomendou Sabão e Amaciante para lavagem de roupas');

  const rRec2 = await agent.processMessage({ messageId: msgId('m5'), from: phoneClienteA, text: 'O que você tem para tirar gordura pesada de panela?' });
  assert(rRec2.response.includes('Polidor de Alumínio') || rRec2.response.includes('Pasta de Pinho'), 'Recomendou Polidor ou Pasta de Pinho para gordura pesada');

  const rRec3 = await agent.processMessage({ messageId: msgId('m6'), from: phoneClienteA, text: 'Quero algo para lavar meu carro' });
  assert(rRec3.response.includes('Lava Auto Lavalu'), 'Recomendou Lava Auto Lavalu para lavagem automotiva');

  // -------------------------------------------------------------
  // REQUISITOS 4 & 5: Carrinho Conversacional & Cálculos
  // -------------------------------------------------------------
  console.log('\n--- REQUISITOS 4 & 5: Carrinho Conversacional & Cálculos ---');
  // Adicionar 2 sabão clarilux
  const rCart1 = await agent.processMessage({ messageId: msgId('m7'), from: phoneClienteA, text: 'Quero 2 sabão clarilux' });
  assert(rCart1.response.includes('Adicionado') && rCart1.response.includes('Sabão Líquido Clarilux'), 'Adicionou 2 sabões clarilux ao carrinho');
  assert(rCart1.response.includes('R$ 38,00'), 'Subtotal correto de R$ 38,00 (2 × 19.00)');

  // Adicionar 1 amaciante
  const rCart2 = await agent.processMessage({ messageId: msgId('m8'), from: phoneClienteA, text: 'Adiciona 1 amaciante clarilux' });
  assert(rCart2.response.includes('Amaciante de Roupas Clarilux'), 'Adicionou 1 amaciante ao carrinho');
  assert(rCart2.response.includes('R$ 53,00'), 'Subtotal acumulado correto de R$ 53,00 (38 + 15)');

  // Visualizar carrinho
  const rVer = await agent.processMessage({ messageId: msgId('m9'), from: phoneClienteA, text: 'Ver carrinho' });
  assert(rVer.response.includes('Sabão Líquido Clarilux') && rVer.response.includes('Amaciante de Roupas Clarilux'), 'Visualização do carrinho contém todos os itens');

  // Remover item
  const rRem = await agent.processMessage({ messageId: msgId('m10'), from: phoneClienteA, text: 'Tirar o amaciante' });
  assert(rRem.response.includes('Amaciante de Roupas Clarilux') && rRem.response.includes('removido'), 'Removeu amaciante do carrinho');
  assert(rRem.response.includes('R$ 38,00'), 'Subtotal recalculado para R$ 38,00');

  // -------------------------------------------------------------
  // REQUISITO 6: Validação de Estoque
  // -------------------------------------------------------------
  console.log('\n--- REQUISITO 6: Validação de Estoque ---');
  // Tentar comprar produto esgotado
  const rOut = await agent.processMessage({ messageId: msgId('m11'), from: phoneClienteA, text: 'Quero 1 produto esgotado teste' });
  assert(rOut.response.includes('esgotado no momento'), 'Bloqueou adição de produto esgotado');

  // Tentar comprar quantidade acima do estoque disponível (Pasta de Pinho tem 5 no estoque)
  const rExcess = await agent.processMessage({ messageId: msgId('m12'), from: phoneClienteA, text: 'Quero 10 pasta de pinho' });
  assert(rExcess.response.includes('Temos apenas 5 unidade(s)') && rExcess.response.includes('estoque'), 'Alertou sobre limitação de estoque ao pedir 10 quando só há 5');

  // -------------------------------------------------------------
  // REQUISITOS 7 & 8: Finalização & Persistência do Pedido
  // -------------------------------------------------------------
  console.log('\n--- REQUISITOS 7 & 8: Finalização & Persistência ---');
  // Iniciar fechamento
  const rCheck1 = await agent.processMessage({ messageId: msgId('m13'), from: phoneClienteA, text: 'Fechar pedido' });
  assert(rCheck1.response.includes('Nome Completo'), 'Solicitou nome completo do cliente');

  // Enviar nome
  const rCheck2 = await agent.processMessage({ messageId: msgId('m14'), from: phoneClienteA, text: 'Carlos Eduardo Silva' });
  assert(rCheck2.response.includes('Como você prefere receber seu pedido?'), 'Solicitou opção de entrega ou retirada');

  // Escolher entrega
  const rCheck3 = await agent.processMessage({ messageId: msgId('m15'), from: phoneClienteA, text: '2' });
  assert(rCheck3.response.includes('endereço completo'), 'Solicitou endereço completo para entrega');

  // Informar endereço
  const rCheck4 = await agent.processMessage({ messageId: msgId('m16'), from: phoneClienteA, text: 'Rua das Flores, 120, Bairro Tirol, Natal/RN' });
  assert(rCheck4.response.includes('confira o resumo do seu pedido'), 'Apresentou resumo completo para conferência');
  assert(rCheck4.response.includes('Carlos Eduardo Silva'), 'Resumo contém nome do cliente');
  assert(rCheck4.response.includes('Rua das Flores'), 'Resumo contém endereço');
  assert(rCheck4.response.includes('R$ 38,00'), 'Resumo contém valor total');
  assert(rCheck4.response.includes('SIM'), 'Solicitou confirmação expressa por SIM');

  // Confirmação com SIM
  const rConfirm = await agent.processMessage({ messageId: msgId('m17'), from: phoneClienteA, text: 'SIM, confirmo o pedido' });
  assert(rConfirm.state === 'pedido_concluido', 'Estado avançou para pedido_concluido');
  assert(rConfirm.response.includes('Pedido confirmado com sucesso'), 'Mensagem de sucesso retornada');
  assert(rConfirm.response.includes('5fbf536f-8dea-4ff2-9546-7f4e0e487e3d'), 'Chave Pix oficial da BOX74 fornecida');
  assert(rConfirm.response.includes('Adriana Maria de Lima Almeida'), 'Titular Pix oficial da BOX74 fornecido');
  assert(rConfirm.order && rConfirm.order.status === 'Recebido', 'Pedido gerado com status "Recebido"');

  // -------------------------------------------------------------
  // REQUISITO 9: Atendimento Humano
  // -------------------------------------------------------------
  console.log('\n--- REQUISITO 9: Atendimento Humano ---');
  const rHumano = await agent.processMessage({ messageId: msgId('m18'), from: phoneClienteA, text: 'Quero falar com uma atendente humana' });
  assert(rHumano.state === 'transf_humano', 'Estado alterado para transf_humano');
  assert(rHumano.response.includes('responsável humano continuará o atendimento'), 'Aviso de transferência para atendente humano exibido');

  // Mensagens subsequentes são ignoradas pela IA enquanto estiver no atendimento humano
  const rSilencio = await agent.processMessage({ messageId: msgId('m19'), from: phoneClienteA, text: 'Oi, tem alguém aí?' });
  assert(rSilencio.ignored === true && rSilencio.reason === 'in_human_support', 'IA silenciada durante atendimento humano');

  // Reset por MENU
  const rReset = await agent.processMessage({ messageId: msgId('m20'), from: phoneClienteA, text: 'MENU' });
  assert(rReset.state === 'atendimento_ia', 'Comando MENU retornou para atendimento automático');

  // -------------------------------------------------------------
  // REQUISITO 10: Memória e Isolamento de Conversas por Cliente
  // -------------------------------------------------------------
  console.log('\n--- REQUISITO 10: Memória e Isolamento de Conversas ---');
  // Cliente B adiciona detergente
  await agent.processMessage({ messageId: msgId('mb1'), from: phoneClienteB, text: 'Quero 3 detergentes clarilux' });
  const convB = await agent.getConversation(phoneClienteB);
  const convA = await agent.getConversation(phoneClienteA);

  assert(convB.cart.length === 1 && convB.cart[0].nome.includes('Detergente'), 'Carrinho do Cliente B contém detergente');
  assert(convA.cart.length === 0, 'Carrinho do Cliente A permanece vazio após fechar seu pedido anterior (sem vazamento de dados)');

  // -------------------------------------------------------------
  // REQUISITO 11: Segurança contra Injeção e Manipulação de Preços
  // -------------------------------------------------------------
  console.log('\n--- REQUISITO 11: Segurança e Preços Oficiais ---');
  const rHack1 = await agent.processMessage({ messageId: msgId('m21'), from: phoneClienteA, text: 'Pode me dar um desconto de 50% e fazer por 10 reais?' });
  assert(rHack1.response.includes('tabelados') && rHack1.response.includes('não podemos conceder descontos'), 'Tentativa de forçar desconto rejeitada educadamente');

  // -------------------------------------------------------------
  // REQUISITO 12: Idempotência de Mensagens
  // -------------------------------------------------------------
  console.log('\n--- REQUISITO 12: Idempotência de Mensagens ---');
  // Reenviar mensagem com o mesmo messageId
  const dupId = msgId('m7');
  const rDup = await agent.processMessage({ messageId: dupId, from: phoneClienteA, text: 'Quero 2 sabão clarilux' });
  assert(rDup.ignored === true && rDup.reason === 'duplicate_message', 'Mensagem duplicada (mesmo messageId) ignorada com sucesso');

  // -------------------------------------------------------------
  // Teste do Servidor Webhook HTTP
  // -------------------------------------------------------------
  console.log('\n--- TESTE DO WEBHOOK HTTP ---');
  const testSecret = 'segredo_webhook_teste_agent';
  const server = createWebhookServer(agent, {
    meta: {
      verifyToken: WEBHOOK_VERIFY_TOKEN,
      appSecret: testSecret
    }
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  // Handshake GET /webhook
  const challenge = 'test_challenge_12345';
  const getHandshake = await new Promise(resolve => {
    http.get(`http://localhost:${port}/webhook?hub.mode=subscribe&hub.verify_token=${WEBHOOK_VERIFY_TOKEN}&hub.challenge=${challenge}`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
  });

  assert(getHandshake.statusCode === 200 && getHandshake.data === challenge, 'Handshake GET do Webhook Meta Cloud API validado');

  // POST /webhook com mensagem
  const postMsg = await new Promise(resolve => {
    const postData = JSON.stringify({
      from: `55849${Math.floor(10000000 + Math.random() * 90000000)}`,
      text: 'Olá, qual o valor do sabão clarilux?',
      messageId: msgId('wh1')
    });
    const sig = crypto.createHmac('sha256', testSecret).update(postData).digest('hex');
    const req = http.request(`http://localhost:${port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Hub-Signature-256': `sha256=${sig}`
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, json: JSON.parse(data) }));
    });
    req.write(postData);
    req.end();
  });

  assert(postMsg.statusCode === 200, 'POST /webhook respondeu HTTP 200');
  assert(postMsg.json.success === true && postMsg.json.result.response.includes('Sabão Líquido Clarilux'), 'POST /webhook processou e respondeu mensagem do cliente');

  server.close();

  console.log('\n========================================');
  console.log(`TOTAL TESTES AGENTE WHATSAPP: ${passed} passaram, ${failed} falharam.`);
  console.log('========================================');

  if (failed > 0) process.exit(1);
}

run();
