// Teste de integracao real contra o endpoint publico do Supabase BOX74
const https = require('https');

const SUPABASE_URL = 'https://owzamemhgbmrqmwlkqcc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9Q9g9ziWIZuhq24zRPp11Q_OgIMhkq6';

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

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function run() {
  console.log('=== TESTES DE INTEGRACAO REAL SUPABASE BOX74 ===\n');

  try {
    // 1. Verificar contagem dos 33 produtos oficiais
    const res = await request(`${SUPABASE_URL}/rest/v1/box74_products?select=*`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    assert(res.statusCode === 200, `API REST box74_products respondeu HTTP 200 (obteve ${res.statusCode})`);
    const produtos = JSON.parse(res.data);
    assert(Array.isArray(produtos), 'Resposta e uma lista de produtos');
    assert(produtos.length === 33, `Exatamente 33 produtos oficiais cadastrados (encontrados: ${produtos.length})`);

    // 2. Verificar produtos com imagem e acessibilidade publica
    const comFoto = produtos.filter(p => p.image_path || (p.foto && p.foto.includes('supabase.co')));
    assert(comFoto.length > 0, `Produtos com imagem no catálogo remoto (${comFoto.length} encontrados)`);

    if (comFoto.length > 0) {
      const p = comFoto[0];
      const imageUrl = p.foto || `${SUPABASE_URL}/storage/v1/object/public/box74-products/${p.image_path}`;
      const imgRes = await request(imageUrl, { method: 'HEAD' });
      assert(imgRes.statusCode === 200, `Imagem publica acessivel no Storage HTTP 200`);
    }

    // 3. Teste de seguranca: tentativa anonima de upload bloqueada por RLS
    const uploadRes = await request(`${SUPABASE_URL}/storage/v1/object/box74-products/test-unauthorized.jpg`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'image/jpeg'
      },
      body: Buffer.from([0xFF, 0xD8, 0xFF])
    });
    assert(uploadRes.statusCode === 400 || uploadRes.statusCode === 401 || uploadRes.statusCode === 403,
      `Tentativa de upload anonimo bloqueada por RLS (HTTP ${uploadRes.statusCode})`);

    // 4. Teste de seguranca: tentativa anonima de remocao bloqueada por RLS
    const deleteRes = await request(`${SUPABASE_URL}/storage/v1/object/box74-products/test-unauthorized.jpg`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    assert(deleteRes.statusCode === 400 || deleteRes.statusCode === 401 || deleteRes.statusCode === 403,
      `Tentativa de remocao anonima bloqueada por RLS (HTTP ${deleteRes.statusCode})`);

    // 5. Garantir integridade dos 33 produtos (nenhum produto de teste persistido no banco)
    const testProducts = produtos.filter(p => p.nome && p.nome.toLowerCase().includes('teste'));
    assert(testProducts.length === 0, `Nenhum produto de teste poluiu a base oficial (33 produtos limpos)`);

    // 6. Validar existencia e protecao RLS da tabela box74_orders
    const ordersRes = await request(`${SUPABASE_URL}/rest/v1/box74_orders?select=*`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    assert(ordersRes.statusCode === 200, `API REST box74_orders respondeu HTTP 200`);
    const ordersData = JSON.parse(ordersRes.data);
    assert(Array.isArray(ordersData), 'Resposta de box74_orders e uma lista');
    assert(ordersData.length === 0, 'RLS protege os pedidos: nenhum dado de cliente visivel para usuarios anonimos');

  } catch (err) {
    console.error('Erro de integracao:', err);
    failed++;
  }

  console.log('\n========================================');
  console.log(`TOTAL TESTES INTEGRACAO: ${passed} passaram, ${failed} falharam.`);
  console.log('========================================');

  if (failed > 0) process.exit(1);
}

run();
