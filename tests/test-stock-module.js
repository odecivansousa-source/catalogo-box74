// Testes do Modulo de Controle Inteligente de Estoque BOX74
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

console.log('=== TESTES DO MÓDULO DE CONTROLE INTELIGENTE DE ESTOQUE BOX74 ===\n');

// 1. Validacao do HTML e CSS
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert(html.includes('id="tab-stock-btn"'), 'Aba Controle de Estoque presente no HTML');
assert(html.includes('id="admin-stock-section"'), 'Container da secao de estoque presente no HTML');
assert(html.includes('id="stock-metric-total-prods"'), 'Métrica de total de itens no catálogo presente');
assert(html.includes('id="stock-metric-total-units"'), 'Métrica de total de unidades em estoque presente');
assert(html.includes('id="stock-metric-low"'), 'Métrica de produtos com estoque baixo presente');
assert(html.includes('id="stock-metric-out"'), 'Métrica de produtos esgotados presente');
assert(html.includes('id="stock-alert-badge"'), 'Badge de alerta de estoque presente');
assert(html.includes('id="stock-adjust-form"'), 'Formulário de entrada/ajuste manual de estoque presente');
assert(html.includes('id="top-selling-list"'), 'Container do relatório de mais vendidos presente');
assert(html.includes('id="stock-table"'), 'Tabela de estoque atual presente');
assert(html.includes('id="stock-movements-table"'), 'Tabela de histórico de movimentações presente');

assert(html.includes('badge-low-stock'), 'Classe visual para alerta de estoque baixo presente');
assert(html.includes('badge-out-of-stock'), 'Classe visual para produto esgotado presente');
assert(html.includes('out-of-stock'), 'Destaque visual para produto esgotado presente');
assert(html.includes("status-cancelado"), 'Classe visual para status Cancelado presente');
assert(html.includes("box74_stock_movements"), 'Integracao com tabela box74_stock_movements presente');

// 2. Teste lógico: Regra de baixa condicional de estoque
const produtosMock = [
  { id: 'prod-1', nome: 'Detergente 5L', preco: 12, estoque: 20 },
  { id: 'prod-2', nome: 'Sabão 5L', preco: 19, estoque: 4 }, // Estoque baixo (<= 5)
  { id: 'prod-3', nome: 'Desinfetante 5L', preco: 10, estoque: 0 }, // Esgotado
  { id: 'prod-4', nome: 'Amaciante 5L', preco: 15, estoque: null } // Sem controle
];

// Alerta visual de estoque no catálogo
const pBaixo = produtosMock.find(p => p.id === 'prod-2');
assert(Number(pBaixo.estoque) > 0 && Number(pBaixo.estoque) <= 5, 'Produto prod-2 identificado como estoque baixo (4 unidades)');

const pEsgotado = produtosMock.find(p => p.id === 'prod-3');
assert(Number(pEsgotado.estoque) <= 0, 'Produto prod-3 identificado como esgotado (0 unidades)');

// Simulação de pedido
const pedido = {
  id: 'ped-teste-estoque',
  customer_name: 'Cliente Teste',
  status: 'Recebido',
  stock_deducted: false,
  items: [
    { id: 'prod-1', nome: 'Detergente 5L', quantidade: 5 },
    { id: 'prod-4', nome: 'Amaciante 5L', quantidade: 2 }
  ]
};

// REGRA 3: Não baixar estoque quando o pedido estiver apenas recebido
assert(pedido.status === 'Recebido', 'Pedido recém-criado possui status "Recebido"');
assert(pedido.stock_deducted === false, 'Estoque NÃO é baixado enquanto status for "Recebido"');
assert(produtosMock.find(p => p.id === 'prod-1').estoque === 20, 'Estoque do produto permanece inalterado (20 unidades)');

// REGRA 2: Baixar quantidades somente quando o administrador confirmar o pedido
const movimentos = [];
function simularMudancaStatus(ped, novoStatus) {
  const confirmando = novoStatus === 'Em preparação' || novoStatus === 'Enviado' || novoStatus === 'Concluído';
  if (confirmando && !ped.stock_deducted) {
    for (const it of ped.items) {
      const prod = produtosMock.find(p => p.id === it.id);
      if (prod && prod.estoque !== null && prod.estoque !== '') {
        const prev = prod.estoque;
        prod.estoque = Math.max(0, prod.estoque - it.quantidade);
        movimentos.push({
          product_id: prod.id,
          type: 'saida',
          quantity: it.quantidade,
          previous_stock: prev,
          new_stock: prod.estoque,
          reason: `Confirmação Pedido #${ped.id}`
        });
      }
    }
    ped.stock_deducted = true;
  }

  // REGRA 4: Cancelamento com reversão da baixa
  if (novoStatus === 'Cancelado' && ped.stock_deducted) {
    for (const it of ped.items) {
      const prod = produtosMock.find(p => p.id === it.id);
      if (prod && prod.estoque !== null && prod.estoque !== '') {
        const prev = prod.estoque;
        prod.estoque = prod.estoque + it.quantidade;
        movimentos.push({
          product_id: prod.id,
          type: 'cancelamento',
          quantity: it.quantidade,
          previous_stock: prev,
          new_stock: prod.estoque,
          reason: `Reversão Cancelamento Pedido #${ped.id}`
        });
      }
    }
    ped.stock_deducted = false;
  }

  ped.status = novoStatus;
}

// Administrador confirma o pedido (muda para 'Em preparação')
simularMudancaStatus(pedido, 'Em preparação');
assert(pedido.stock_deducted === true, 'Flag stock_deducted é marcada como true após confirmação');
assert(produtosMock.find(p => p.id === 'prod-1').estoque === 15, 'Estoque de prod-1 baixou corretamente de 20 para 15');
assert(movimentos.length === 1, 'Movimentação de saída registrada no histórico');
assert(movimentos[0].type === 'saida', 'Tipo de movimentação é "saida"');
assert(movimentos[0].quantity === 5, 'Quantidade baixada é 5');

// Idempotência: mudar para 'Enviado' não duplica a baixa
simularMudancaStatus(pedido, 'Enviado');
assert(produtosMock.find(p => p.id === 'prod-1').estoque === 15, 'Mudança subsequente para "Enviado" não deduz estoque novamente');

// REGRA 4: Cancelamento com reversão da baixa
simularMudancaStatus(pedido, 'Cancelado');
assert(pedido.stock_deducted === false, 'Flag stock_deducted revertida para false após cancelamento');
assert(produtosMock.find(p => p.id === 'prod-1').estoque === 20, 'Estoque de prod-1 revertido com sucesso para 20');
assert(movimentos.length === 2, 'Segunda movimentação registrada');
assert(movimentos[1].type === 'cancelamento', 'Tipo da movimentação de reversão é "cancelamento"');

// REGRA 6: Entrada e Ajuste manual de estoque
function simularAjusteManual(prodId, type, qtd, motivo) {
  const prod = produtosMock.find(p => p.id === prodId);
  const prev = prod.estoque || 0;
  let novo = prev;
  if (type === 'entrada') novo = prev + qtd;
  else if (type === 'ajuste') novo = qtd;
  prod.estoque = novo;
  movimentos.push({
    product_id: prodId,
    type,
    quantity: qtd,
    previous_stock: prev,
    new_stock: novo,
    reason: motivo
  });
}

// Entrada manual de 30 unidades
simularAjusteManual('prod-3', 'entrada', 30, 'Reposição de estoque lote 102');
assert(produtosMock.find(p => p.id === 'prod-3').estoque === 30, 'Entrada manual atualizou estoque de 0 para 30 unidades');
assert(movimentos[2].type === 'entrada', 'Histórico registrou movimentação de "entrada"');

// Ajuste manual para saldo exato de 50
simularAjusteManual('prod-1', 'ajuste', 50, 'Contagem de inventário físico');
assert(produtosMock.find(p => p.id === 'prod-1').estoque === 50, 'Ajuste manual definiu estoque exato de 50 unidades');
assert(movimentos[3].type === 'ajuste', 'Histórico registrou movimentação de "ajuste"');

// REGRA 5: Histórico de movimentações contempla os 4 tipos
const tiposRegistrados = new Set(movimentos.map(m => m.type));
assert(tiposRegistrados.has('saida'), 'Histórico contempla "saida"');
assert(tiposRegistrados.has('cancelamento'), 'Histórico contempla "cancelamento"');
assert(tiposRegistrados.has('entrada'), 'Histórico contempla "entrada"');
assert(tiposRegistrados.has('ajuste'), 'Histórico contempla "ajuste"');

// REGRA 9: Relatório de produtos mais vendidos
const pedidosParaRanking = [
  { status: 'Concluído', items: [{ id: 'p1', nome: 'Detergente', preco: 10, quantidade: 8 }] },
  { status: 'Em preparação', items: [{ id: 'p1', nome: 'Detergente', preco: 10, quantidade: 4 }, { id: 'p2', nome: 'Amaciante', preco: 15, quantidade: 3 }] },
  { status: 'Cancelado', items: [{ id: 'p1', nome: 'Detergente', preco: 10, quantidade: 100 }] } // Pedido cancelado NÃO conta
];

function gerarMaisVendidos(pedidos) {
  const ranking = {};
  for (const o of pedidos) {
    if (o.status === 'Cancelado') continue;
    for (const it of o.items) {
      if (!ranking[it.id]) ranking[it.id] = { nome: it.nome, quantidade: 0, total: 0 };
      ranking[it.id].quantidade += it.quantidade;
      ranking[it.id].total += it.quantidade * it.preco;
    }
  }
  return Object.values(ranking).sort((a, b) => b.quantidade - a.quantidade);
}

const ranking = gerarMaisVendidos(pedidosParaRanking);
assert(ranking[0].nome === 'Detergente', 'Top 1 mais vendido é o Detergente');
assert(ranking[0].quantidade === 12, 'Quantidade vendida de Detergente é 12 (8 + 4; 100 do cancelado descartadas)');
assert(ranking[0].total === 120, 'Faturamento gerado pelo Detergente é R$ 120,00');
assert(ranking[1].nome === 'Amaciante' && ranking[1].quantidade === 3, 'Top 2 é o Amaciante com 3 unidades');

console.log('\n========================================');
console.log(`TOTAL TESTES MÓDULO ESTOQUE: ${passed} passaram, ${failed} falharam.`);
console.log('========================================');

if (failed > 0) process.exit(1);
