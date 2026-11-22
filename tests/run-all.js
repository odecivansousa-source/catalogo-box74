// Runner unificado para a suite de testes BOX74
const { execSync } = require('child_process');
const path = require('path');

const tests = [
  { name: 'Segurança e Autenticação', file: 'test-security.js' },
  { name: 'Ciclo de Vida de Imagens e Erros Storage', file: 'test-images-lifecycle.js' },
  { name: 'Módulo de Histórico e Gestão de Pedidos', file: 'test-orders-module.js' },
  { name: 'Controle Inteligente de Estoque', file: 'test-stock-module.js' },
  { name: 'Integração Real Supabase', file: 'test-integration.js' }
];

console.log('====================================================');
console.log('   INICIANDO SUÍTE COMPLETA DE TESTES BOX74');
console.log('====================================================\n');

let allPassed = true;

for (const test of tests) {
  const filePath = path.join(__dirname, test.file);
  console.log(`>>> Executando: ${test.name} (${test.file})`);
  try {
    const output = execSync(`node "${filePath}"`, { stdio: 'inherit' });
    console.log(`>>> [OK] ${test.name} concluído com sucesso.\n`);
  } catch (err) {
    console.error(`>>> [FALHA] ${test.name} falhou.\n`);
    allPassed = false;
  }
}

if (!allPassed) {
  console.error('FATAL: Um ou mais testes falharam.');
  process.exit(1);
} else {
  console.log('====================================================');
  console.log('   TODAS AS SUÍTES FORAM APROVADAS COM SUCESSO!');
  console.log('====================================================');
}
