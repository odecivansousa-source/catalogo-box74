const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Extract the main script block
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!scriptMatch) {
  console.error('FAIL: Script tag not found in index.html');
  process.exit(1);
}
// Append internal state inspection getter only for the test environment
const scriptCode = scriptMatch[1] + '\n;globalThis.__getInternalState = () => ({ isAdmin, produtos, carrinho });';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

// Helper to create a minimal DOM environment
function createMockEnv(overrides = {}) {
  const elements = {};
  function getEl(sel) {
    if (!elements[sel]) {
      elements[sel] = {
        id: sel.replace(/[#.]/g, ''),
        classList: {
          classes: new Set(['hidden']),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          toggle(c, force) {
            if (force !== undefined) {
              if (force) this.classes.add(c); else this.classes.delete(c);
            } else {
              if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c);
            }
          },
          contains(c) { return this.classes.has(c); }
        },
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
        listeners: {},
        addEventListener(evt, fn) { this.listeners[evt] = fn; },
        closest(sel) { return null; },
        scrollIntoView() {},
        reset() { this.value = ''; },
        focus() {},
        click() { if (this.listeners['click']) this.listeners['click']({ target: this, preventDefault() {} }); }
      };
    }
    return elements[sel];
  }

  const localStorageData = {};
  const mockLocalStorage = {
    getItem(k) { return localStorageData[k] || null; },
    setItem(k, v) { localStorageData[k] = String(v); },
    removeItem(k) { delete localStorageData[k]; }
  };

  const sandbox = {
    window: {
      location: { search: '', hash: '' },
      supabase: overrides.supabase || undefined,
      open() {},
      setTimeout: (fn) => setTimeout(fn, 0),
      clearTimeout: () => {}
    },
    document: {
      querySelector: (sel) => getEl(sel),
      querySelectorAll: (sel) => [getEl(sel)],
      createElement: (tag) => getEl(tag)
    },
    localStorage: mockLocalStorage,
    Intl,
    URLSearchParams,
    Number,
    JSON,
    console,
    alert: () => {},
    confirm: () => true,
    navigator: { clipboard: { writeText: async () => {} } },
    createImageBitmap: async () => ({ width: 100, height: 100, close() {} }),
    ...overrides.globals
  };

  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox;
  return { sandbox, getEl, mockLocalStorage };
}

async function runTests() {
  console.log('--- TEST 1: Supabase desconectado - Tentativa de Login Administrativo ---');
  {
    const { sandbox, getEl } = createMockEnv({ supabase: null });
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);

    const loginForm = getEl('#admin-login-form');
    getEl('#admin-email').value = 'loja@box74.com';
    getEl('#admin-password').value = 'senha123456';
    
    await loginForm.listeners['submit']({ preventDefault() {} });

    const state = sandbox.globalThis.__getInternalState();
    assert(state.isAdmin === false, 'isAdmin deve permanecer false com Supabase desconectado');
    assert(getEl('#admin-panel').classList.contains('hidden'), 'admin-panel deve permanecer oculto');
    assert(getEl('#auth-status').textContent.includes('indisponível') || getEl('#auth-status').textContent.includes('desconectado'), 'auth-status deve indicar indisponibilidade do Supabase');
  }

  console.log('\n--- TEST 2: Supabase desconectado - Tentativa de Salvar (save()) ---');
  {
    const { sandbox, getEl } = createMockEnv({ supabase: null });
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);

    const adminForm = getEl('#product-form');
    getEl('#product-name').value = 'Produto Bloqueado';
    getEl('#product-category').value = 'Teste';
    getEl('#product-price').value = '25';

    await adminForm.listeners['submit']({ preventDefault() {} });

    const state = sandbox.globalThis.__getInternalState();
    assert(state.isAdmin === false, 'isAdmin deve ser false');
    assert(getEl('#admin-status').textContent.includes('Ação não permitida'), 'admin-status deve bloquear ação não permitida');
  }

  console.log('\n--- TEST 3: Supabase desconectado - Tentativa de Excluir Produto ---');
  {
    const { sandbox, getEl } = createMockEnv({ supabase: null });
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);

    const stateBefore = sandbox.globalThis.__getInternalState();
    const initialCount = stateBefore.produtos.length;
    const adminList = getEl('#admin-list');

    const mockDelBtn = {
      dataset: { delete: stateBefore.produtos[0].id },
      closest(sel) { return sel === '[data-delete]' ? this : null; }
    };

    await adminList.listeners['click']({ target: mockDelBtn });

    const stateAfter = sandbox.globalThis.__getInternalState();
    assert(stateAfter.produtos.length === initialCount, 'Lista de produtos não deve ser modificada');
    assert(getEl('#admin-status').textContent.includes('Ação não permitida'), 'admin-status deve bloquear exclusão');
  }

  console.log('\n--- TEST 4: Supabase desconectado - Tentativa de Editar Produto ---');
  {
    const { sandbox, getEl } = createMockEnv({ supabase: null });
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);

    const state = sandbox.globalThis.__getInternalState();
    const adminList = getEl('#admin-list');

    const mockEditBtn = {
      dataset: { edit: state.produtos[0].id },
      closest(sel) { return sel === '[data-edit]' ? this : null; }
    };

    await adminList.listeners['click']({ target: mockEditBtn });

    assert(getEl('#admin-status').textContent.includes('Ação não permitida'), 'admin-status deve bloquear abertura de edição sem admin');
    assert(getEl('#product-form').classList.contains('hidden'), 'product-form deve permanecer oculto');
  }

  console.log('\n--- TEST 5: Autenticação Válida com Usuário NÃO Administrador ---');
  {
    const mockAuthSupabase = {
      createClient: () => ({
        auth: {
          signInWithPassword: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }),
          signOut: async () => {},
          onAuthStateChange: () => {},
          getSession: async () => ({ data: { session: null } })
        },
        rpc: async (func) => {
          if (func === 'box74_is_admin') return { data: false, error: null };
          return { data: null, error: 'unknown function' };
        },
        from: () => ({ select: () => ({ order: () => ({ data: [], error: null }) }) })
      })
    };

    const { sandbox, getEl } = createMockEnv({ supabase: mockAuthSupabase });
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);

    const loginForm = getEl('#admin-login-form');
    getEl('#admin-email').value = 'cliente@gmail.com';
    getEl('#admin-password').value = 'senha123456';

    await loginForm.listeners['submit']({ preventDefault() {} });

    const state = sandbox.globalThis.__getInternalState();
    assert(state.isAdmin === false, 'isAdmin deve ser false para usuário não-admin');
    assert(getEl('#admin-panel').classList.contains('hidden'), 'admin-panel deve estar oculto');
    assert(getEl('#auth-status').textContent.includes('não tem permissão'), 'auth-status deve informar falta de permissão');
  }

  console.log('\n--- TEST 6: Autenticação Válida com Administrador Confirmado ---');
  {
    let deletedId = null;
    let upsertedRows = null;

    const mockAdminSupabase = {
      createClient: () => ({
        auth: {
          signInWithPassword: async () => ({ data: { session: { user: { id: 'admin1' } } }, error: null }),
          signOut: async () => {},
          onAuthStateChange: () => {},
          getSession: async () => ({ data: { session: null } })
        },
        rpc: async (func) => {
          if (func === 'box74_is_admin') return { data: true, error: null };
          return { data: null, error: 'unknown function' };
        },
        from: (table) => ({
          select: () => ({ order: () => ({ data: [], error: null }) }),
          delete: () => ({ eq: (col, val) => { deletedId = val; return { error: null }; } }),
          upsert: (rows) => { upsertedRows = rows; return { error: null }; }
        }),
        storage: {
          from: () => ({
            upload: async () => ({ error: null }),
            getPublicUrl: () => ({ data: { publicUrl: 'https://exemplo.com/foto.jpg' } }),
            remove: async () => ({ error: null })
          })
        }
      })
    };

    const { sandbox, getEl } = createMockEnv({ supabase: mockAdminSupabase });
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);

    const loginForm = getEl('#admin-login-form');
    getEl('#admin-email').value = 'admin@box74.com';
    getEl('#admin-password').value = 'senha123456';

    await loginForm.listeners['submit']({ preventDefault() {} });

    const state = sandbox.globalThis.__getInternalState();
    assert(state.isAdmin === true, 'isAdmin deve ser true após login com permissão');
    assert(!getEl('#admin-panel').classList.contains('hidden'), 'admin-panel deve estar visível');

    // Test product deletion with admin
    const adminList = getEl('#admin-list');
    const targetId = state.produtos[0].id;
    const mockDelBtn = {
      dataset: { delete: targetId },
      closest(sel) { return sel === '[data-delete]' ? this : null; }
    };
    await adminList.listeners['click']({ target: mockDelBtn });
    assert(deletedId === targetId, 'delete() no Supabase deve ser chamado com o id correto');

    // Test product edit with admin (using a product that exists after deletion)
    const stateAfterDel = sandbox.globalThis.__getInternalState();
    const editTargetId = stateAfterDel.produtos[0].id;
    const mockEditBtn = {
      dataset: { edit: editTargetId },
      closest(sel) { return sel === '[data-edit]' ? this : null; }
    };
    await adminList.listeners['click']({ target: mockEditBtn });
    assert(!getEl('#product-form').classList.contains('hidden'), 'product-form deve abrir para admin');

    // Test product save with admin
    const adminForm = getEl('#product-form');
    getEl('#product-id').value = editTargetId;
    getEl('#product-name').value = 'Sabão Líquido Clarilux Editado';
    getEl('#product-category').value = 'Sabão líquido';
    getEl('#product-price').value = '22.00';
    getEl('#product-stock').value = '50';
    getEl('#product-promo-price').value = '';
    getEl('#product-promo-label').value = '';

    await adminForm.listeners['submit']({ preventDefault() {} });
    assert(upsertedRows !== null, 'upsert() no Supabase deve ser executado no salvamento');
  }

  console.log(`\n========================================`);
  console.log(`RESUMO DOS TESTES DE SEGURANÇA: ${passed} passaram, ${failed} falharam.`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
