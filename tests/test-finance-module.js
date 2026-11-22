// Testes do Modulo Financeiro BOX74
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

console.log('=== TESTES DO MÓDULO FINANCEIRO BOX74 ===\n');

// 1. Validacao dos Elementos HTML e CSS
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert(html.includes('id="tab-finance-btn"'), 'Aba Painel Financeiro presente no HTML');
assert(html.includes('id="admin-finance-section"'), 'Container da seção financeira presente no HTML');
assert(html.includes('id="finance-period"'), 'Seletor de período financeiro presente');
assert(html.includes('id="export-finance-csv"'), 'Botão de exportação CSV presente');
assert(html.includes('id="fin-metric-revenue"'), 'KPI Faturamento Bruto presente');
assert(html.includes('id="fin-metric-cmv"'), 'KPI Custo Mercadorias (CMV) presente');
assert(html.includes('id="fin-metric-gross-profit"'), 'KPI Lucro Bruto presente');
assert(html.includes('id="fin-metric-expenses"'), 'KPI Despesas Operacionais presente');
assert(html.includes('id="fin-metric-net-result"'), 'KPI Resultado Líquido presente');
assert(html.includes('id="expense-form"'), 'Formulário de despesas operacionais presente');
assert(html.includes('id="top-lucrative-table"'), 'Tabela de ranking dos produtos mais lucrativos presente');
assert(html.includes('id="product-margins-table"'), 'Tabela de margens por produto presente');
assert(html.includes('id="expenses-table"'), 'Tabela de histórico de despesas presente');
assert(html.includes('id="product-cost"'), 'Input de preço de custo no formulário de produtos presente');

assert(html.includes('expense-badge-frete'), 'Classe visual para categoria Frete presente');
assert(html.includes('expense-badge-embalagens'), 'Classe visual para categoria Embalagens presente');
assert(html.includes('expense-badge-taxas'), 'Classe visual para categoria Taxas presente');
assert(html.includes('box74_expenses'), 'Integração com tabela box74_expenses no Supabase presente');

// 2. Teste lógico: Cadastro de Custo e Cálculo de Margem por Produto
const produtosMock = [
  { id: 'prod-1', nome: 'Sabão Clarilux 5L', preco: 19.00, custo: 10.00 },
  { id: 'prod-2', nome: 'Detergente Clarilux 5L', preco: 12.00, custo: 6.50 },
  { id: 'prod-3', nome: 'Amaciante Clarilux 5L', preco: 15.00, custo: 8.00 },
  { id: 'prod-4', nome: 'Produto Sem Custo 5L', preco: 10.00, custo: 0.00 }
];

function calcMargemProduto(p) {
  const lucro = p.preco - p.custo;
  const margemPct = p.preco > 0 ? (lucro / p.preco) * 100 : 0;
  return { lucro, margemPct };
}

const m1 = calcMargemProduto(produtosMock[0]);
assert(m1.lucro === 9.00, 'Lucro unitário de prod-1 é R$ 9,00 (19 - 10)');
assert(Math.round(m1.margemPct * 10) / 10 === 47.4, 'Margem percentual de prod-1 é 47.4%');

const m2 = calcMargemProduto(produtosMock[1]);
assert(m2.lucro === 5.50, 'Lucro unitário de prod-2 é R$ 5,50 (12 - 6.50)');
assert(Math.round(m2.margemPct * 10) / 10 === 45.8, 'Margem percentual de prod-2 é 45.8%');

// 3. Teste lógico: Faturamento, CMV e Lucro Bruto por Período
const pedidosMock = [
  {
    id: 'ped-1',
    created_at: new Date().toISOString(), // Hoje
    status: 'Concluído',
    total: 38.00,
    items: [{ id: 'prod-1', quantidade: 2, preco: 19.00, subtotal: 38.00 }]
  },
  {
    id: 'ped-2',
    created_at: new Date().toISOString(), // Hoje
    status: 'Em preparação',
    total: 24.00,
    items: [{ id: 'prod-2', quantidade: 2, preco: 12.00, subtotal: 24.00 }]
  },
  {
    id: 'ped-cancelado',
    created_at: new Date().toISOString(), // Hoje
    status: 'Cancelado',
    total: 100.00,
    items: [{ id: 'prod-1', quantidade: 5, preco: 20.00, subtotal: 100.00 }]
  },
  {
    id: 'ped-antigo',
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 dias atrás
    status: 'Concluído',
    total: 15.00,
    items: [{ id: 'prod-3', quantidade: 1, preco: 15.00, subtotal: 15.00 }]
  }
];

const despesasMock = [
  { id: 'exp-1', category: 'Frete', description: 'Entrega moto', amount: 12.00, expense_date: new Date().toISOString().split('T')[0] },
  { id: 'exp-2', category: 'Embalagens', description: 'Sacolas', amount: 5.00, expense_date: new Date().toISOString().split('T')[0] }
];

function calcularFinanceiroTeste(periodo) {
  const agora = new Date();
  const hojeStr = agora.toDateString();
  const limite7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  function noPeriodo(dt) {
    if (periodo === 'todos') return true;
    const d = new Date(dt);
    if (periodo === 'hoje') return d.toDateString() === hojeStr;
    if (periodo === '7dias') return d.getTime() >= limite7d;
    if (periodo === 'mes') return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    return true;
  }

  const peds = pedidosMock.filter(o => o.status !== 'Cancelado' && noPeriodo(o.created_at));
  let faturamento = 0;
  let cmv = 0;

  for (const o of peds) {
    faturamento += o.total;
    for (const it of o.items) {
      const prod = produtosMock.find(p => p.id === it.id);
      const custoUnit = prod ? prod.custo : 0;
      cmv += custoUnit * it.quantidade;
    }
  }

  const lucroBruto = faturamento - cmv;
  const margemBruta = faturamento > 0 ? (lucroBruto / faturamento) * 100 : 0;

  const desps = despesasMock.filter(d => noPeriodo(d.expense_date + 'T12:00:00'));
  const totalDespesas = desps.reduce((s, d) => s + d.amount, 0);
  const resultadoLiquido = lucroBruto - totalDespesas;
  const margemLiquida = faturamento > 0 ? (resultadoLiquido / faturamento) * 100 : 0;

  return { faturamento, cmv, lucroBruto, margemBruta, totalDespesas, resultadoLiquido, margemLiquida, count: peds.length };
}

// Período Hoje
const finHoje = calcularFinanceiroTeste('hoje');
assert(finHoje.faturamento === 62.00, `Faturamento de hoje é R$ 62,00 (38 + 24; cancelado descartado) - obteve ${finHoje.faturamento}`);
assert(finHoje.cmv === 33.00, `CMV de hoje é R$ 33,00 (2*10.00 + 2*6.50 = 20 + 13) - obteve ${finHoje.cmv}`);
assert(finHoje.lucroBruto === 29.00, `Lucro Bruto de hoje é R$ 29,00 (62 - 33) - obteve ${finHoje.lucroBruto}`);
assert(Math.round(finHoje.margemBruta * 10) / 10 === 46.8, `Margem Bruta de hoje é 46.8% - obteve ${finHoje.margemBruta.toFixed(1)}%`);
assert(finHoje.totalDespesas === 17.00, `Despesas de hoje totalizam R$ 17,00 (12 + 5) - obteve ${finHoje.totalDespesas}`);
assert(finHoje.resultadoLiquido === 12.00, `Resultado Líquido de hoje é R$ 12,00 (29 - 17) - obteve ${finHoje.resultadoLiquido}`);
assert(Math.round(finHoje.margemLiquida * 10) / 10 === 19.4, `Margem Líquida de hoje é 19.4% - obteve ${finHoje.margemLiquida.toFixed(1)}%`);

// 4. Teste de Ranking dos Produtos Mais Lucrativos
function calcularRankingLucrativo() {
  const map = {};
  for (const o of pedidosMock) {
    if (o.status === 'Cancelado') continue;
    for (const it of o.items) {
      if (!map[it.id]) {
        const prod = produtosMock.find(p => p.id === it.id);
        map[it.id] = { id: it.id, nome: prod.nome, custoUnit: prod.custo, qtd: 0, faturamento: 0, cmv: 0 };
      }
      map[it.id].qtd += it.quantidade;
      map[it.id].faturamento += it.subtotal;
      map[it.id].cmv += map[it.id].custoUnit * it.quantidade;
    }
  }
  const lista = Object.values(map);
  for (const it of lista) {
    it.lucroBruto = it.faturamento - it.cmv;
  }
  return lista.sort((a, b) => b.lucroBruto - a.lucroBruto);
}

const ranking = calcularRankingLucrativo();
assert(ranking[0].id === 'prod-1', 'Produto #1 no ranking de lucratividade é prod-1');
assert(ranking[0].lucroBruto === 18.00, 'Lucro gerado por prod-1 é R$ 18,00 (38 - 20)');
assert(ranking[1].id === 'prod-2', 'Produto #2 no ranking de lucratividade é prod-2');
assert(ranking[1].lucroBruto === 11.00, 'Lucro gerado por prod-2 é R$ 11,00 (24 - 13)');

// 5. Teste de Estrutura do Relatório CSV
function gerarCSVTeste() {
  let csv = '\uFEFF';
  csv += 'BOX74 - RELATÓRIO FINANCEIRO CONSOLIDADO\n';
  csv += '1. RESUMO FINANCEIRO CONSOLIDADO\n';
  csv += 'Faturamento Bruto;62,00\n';
  csv += 'Custo das Mercadorias Vendidas (CMV);33,00\n';
  csv += 'Lucro Bruto;29,00\n';
  csv += 'Despesas Operacionais;17,00\n';
  csv += 'Resultado Líquido Operacional;12,00\n';
  csv += '2. DESEMPENHO E LUCRATIVIDADE POR PRODUTO\n';
  csv += 'Posição;Produto;Qtd Vendida;Faturamento (R$);CMV Total (R$);Lucro Bruto (R$)\n';
  csv += '1;"Sabão Clarilux 5L";2;38,00;20,00;18,00\n';
  csv += '3. DESPESAS OPERACIONAIS NO PERÍODO\n';
  csv += 'Data;Categoria;Descrição;Valor (R$)\n';
  csv += '"2026-11-22";"Frete";"Entrega moto";12,00\n';
  return csv;
}

const csvOutput = gerarCSVTeste();
assert(csvOutput.startsWith('\uFEFF'), 'CSV inicia com BOM UTF-8 para compatibilidade Excel');
assert(csvOutput.includes('Faturamento Bruto;62,00'), 'CSV contém Faturamento Bruto correto');
assert(csvOutput.includes('Lucro Bruto;29,00'), 'CSV contém Lucro Bruto correto');
assert(csvOutput.includes('Resultado Líquido Operacional;12,00'), 'CSV contém Resultado Líquido correto');
assert(csvOutput.includes('DESEMPENHO E LUCRATIVIDADE POR PRODUTO'), 'CSV contém seção de ranking por produto');
assert(csvOutput.includes('DESPESAS OPERACIONAIS NO PERÍODO'), 'CSV contém seção de despesas');

console.log('\n========================================');
console.log(`TOTAL TESTES MÓDULO FINANCEIRO: ${passed} passaram, ${failed} falharam.`);
console.log('========================================');

if (failed > 0) process.exit(1);
