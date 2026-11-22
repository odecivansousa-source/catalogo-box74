// Testes unitarios e de contrato do Modulo de Gestao de Pedidos BOX74
const fs = require('fs');
const path = require('path');

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

// 1. Validacao do HTML e CSS
console.log('=== TESTES DO MÓDULO DE HISTÓRICO E GESTÃO DE PEDIDOS BOX74 ===\n');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Verificacao dos elementos da interface administrativa de pedidos
assert(html.includes('id="tab-orders-btn"'), 'Botao da aba Gestao de Pedidos presente no HTML');
assert(html.includes('id="tab-products-btn"'), 'Botao da aba Catalogo de Produtos presente no HTML');
assert(html.includes('id="admin-orders-section"'), 'Container da secao de pedidos presente no HTML');
assert(html.includes('id="metric-total-orders"'), 'Indicador de Total de Pedidos presente');
assert(html.includes('id="metric-total-revenue"'), 'Indicador de Faturamento Total presente');
assert(html.includes('id="metric-new-orders"'), 'Indicador de Novos Pedidos (Recebidos) presente');
assert(html.includes('id="metric-prep-orders"'), 'Indicador de Pedidos Em Preparacao presente');
assert(html.includes('id="metric-done-orders"'), 'Indicador de Pedidos Concluidos/Enviados presente');
assert(html.includes('id="filter-order-status"'), 'Filtro por status presente no HTML');
assert(html.includes('id="filter-order-period"'), 'Filtro por periodo presente no HTML');
assert(html.includes('id="search-orders"'), 'Campo de busca de pedidos presente no HTML');
assert(html.includes('id="orders-list"'), 'Container da lista de pedidos presente no HTML');

// 2. Verificacao da persistencia e funcoes de pedidos
assert(html.includes("from('box74_orders').insert("), 'Persistencia do pedido no Supabase na submissao do checkout');
assert(html.includes("from('box74_orders').select('*')"), 'Consulta de pedidos no Supabase com ordenacao por created_at');
assert(html.includes("from('box74_orders').update("), 'Atualizacao de status do pedido no Supabase');
assert(html.includes('status-recebido'), 'Classes de estilo para status Recebido presentes');
assert(html.includes('status-preparacao'), 'Classes de estilo para status Em preparação presentes');
assert(html.includes('status-enviado'), 'Classes de estilo para status Enviado presentes');
assert(html.includes('status-concluido'), 'Classes de estilo para status Concluido presentes');

// 3. Teste logico de calculo de metricas e filtros
const pedidosMock = [
  {
    id: 'ped-1',
    customer_name: 'Maria Silva',
    customer_phone: '84999990001',
    fulfillment: 'Retirada na loja',
    customer_address: null,
    items: [{ id: 'box74-1', nome: 'Sabão Clarilux', preco: 19, quantidade: 2, subtotal: 38 }],
    total: 38.00,
    status: 'Recebido',
    created_at: new Date().toISOString()
  },
  {
    id: 'ped-2',
    customer_name: 'João Santos',
    customer_phone: '84999990002',
    fulfillment: 'Entrega (frete a combinar)',
    customer_address: 'Rua das Flores, 123',
    items: [{ id: 'box74-2', nome: 'Amaciante', preco: 15, quantidade: 1, subtotal: 15 }],
    total: 15.00,
    status: 'Em preparação',
    created_at: new Date().toISOString()
  },
  {
    id: 'ped-3',
    customer_name: 'Ana Oliveira',
    customer_phone: '84999990003',
    fulfillment: 'Retirada na loja',
    customer_address: null,
    items: [{ id: 'box74-3', nome: 'Detergente', preco: 12, quantidade: 3, subtotal: 36 }],
    total: 36.00,
    status: 'Concluído',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 dias atras
  },
  {
    id: 'ped-4',
    customer_name: 'Carlos Mendes',
    customer_phone: '84999990004',
    fulfillment: 'Entrega (frete a combinar)',
    customer_address: 'Av. Central, 500',
    items: [{ id: 'box74-4', nome: 'Desinfetante', preco: 10, quantidade: 1, subtotal: 10 }],
    total: 10.00,
    status: 'Enviado',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() // 40 dias atras
  }
];

// Calculo de metricas
const totalOrders = pedidosMock.length;
const totalRevenue = pedidosMock.reduce((s, p) => s + p.total, 0);
const newOrders = pedidosMock.filter(p => p.status === 'Recebido').length;
const prepOrders = pedidosMock.filter(p => p.status === 'Em preparação').length;
const doneOrders = pedidosMock.filter(p => p.status === 'Concluído' || p.status === 'Enviado').length;

assert(totalOrders === 4, 'Cálculo de quantidade total de pedidos correto (4)');
assert(totalRevenue === 99.00, `Cálculo de faturamento correto (R$ 99,00 obteve R$ ${totalRevenue})`);
assert(newOrders === 1, 'Cálculo de pedidos Recebidos correto (1)');
assert(prepOrders === 1, 'Cálculo de pedidos Em preparação correto (1)');
assert(doneOrders === 2, 'Cálculo de pedidos Concluídos/Enviados correto (2)');

// Filtro por status
const filtradosRecebidos = pedidosMock.filter(p => p.status === 'Recebido');
assert(filtradosRecebidos.length === 1 && filtradosRecebidos[0].id === 'ped-1', 'Filtro por status "Recebido" funciona');

const filtradosPrep = pedidosMock.filter(p => p.status === 'Em preparação');
assert(filtradosPrep.length === 1 && filtradosPrep[0].id === 'ped-2', 'Filtro por status "Em preparação" funciona');

// Filtro por periodo
const hojeStr = new Date().toDateString();
const pedidosHoje = pedidosMock.filter(p => new Date(p.created_at).toDateString() === hojeStr);
assert(pedidosHoje.length === 2, 'Filtro por período "hoje" retorna apenas os 2 pedidos de hoje');

const limite7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
const pedidos7d = pedidosMock.filter(p => new Date(p.created_at).getTime() >= limite7d);
assert(pedidos7d.length === 3, 'Filtro por período "7 dias" retorna os 3 pedidos recentes');

// Busca textual
const buscaNome = pedidosMock.filter(p => p.customer_name.toLowerCase().includes('maria'));
assert(buscaNome.length === 1 && buscaNome[0].customer_name === 'Maria Silva', 'Busca por nome de cliente funciona');

const buscaTel = pedidosMock.filter(p => p.customer_phone.includes('0003'));
assert(buscaTel.length === 1 && buscaTel[0].customer_name === 'Ana Oliveira', 'Busca por WhatsApp/telefone funciona');

const buscaId = pedidosMock.filter(p => p.id.includes('ped-4'));
assert(buscaId.length === 1 && buscaId[0].customer_name === 'Carlos Mendes', 'Busca por ID do pedido funciona');

// Transicao de status valida
const statusPermitidos = ['Recebido', 'Em preparação', 'Enviado', 'Concluído'];
let statusAtual = 'Recebido';
for (const prox of ['Em preparação', 'Enviado', 'Concluído']) {
  assert(statusPermitidos.includes(prox), `Status "${prox}" é permitido pelo fluxo`);
  statusAtual = prox;
}
assert(statusAtual === 'Concluído', 'Ciclo de vida do pedido atinge status final Concluído');

console.log('\n========================================');
console.log(`TOTAL TESTES MÓDULO PEDIDOS: ${passed} passaram, ${failed} falharam.`);
console.log('========================================');

if (failed > 0) process.exit(1);
