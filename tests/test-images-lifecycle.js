const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!scriptMatch) {
  console.error('FAIL: Script tag not found in index.html');
  process.exit(1);
}
const scriptCode = scriptMatch[1] + '\n;globalThis.__getInternalState = () => ({ isAdmin, produtos, carrinho, fotoEmEdicao, fotoSelecionada });\n;globalThis.__setInternalState = (s) => { if(s.isAdmin !== undefined) isAdmin = s.isAdmin; if(s.fotoEmEdicao !== undefined) fotoEmEdicao = s.fotoEmEdicao; if(s.fotoSelecionada !== undefined) fotoSelecionada = s.fotoSelecionada; };';

// Minimal DOM helper
function createMockEnv(storageMocks = {}) {
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

  const uploadedFiles = [];
  const removedFiles = [];
  const upsertedRows = [];

  const mockSupabase = {
    createClient: () => ({
      auth: {
        signInWithPassword: async () => ({ data: { session: { user: { id: 'admin1' } } }, error: null }),
        signOut: async () => {},
        onAuthStateChange: () => {},
        getSession: async () => ({ data: { session: { user: { id: 'admin1' } } } })
      },
      rpc: async (func) => {
        if (func === 'box74_is_admin') return { data: true, error: null };
        return { data: null, error: 'unknown' };
      },
      from: (table) => ({
        select: () => ({
          order: () => ({
            data: storageMocks.products || [
              {
                id: 'box74-test-1',
                name: 'Produto Teste Imagem',
                category: 'Sabão',
                size: '5L',
                price: 20,
                stock: 10,
                promo_price: null,
                promo_label: '',
                image_path: 'products/box74-test-1-foto-antiga.jpg',
                is_active: true,
                sort_order: 0
              }
            ],
            error: null
          })
        }),
        delete: () => ({
          eq: async (col, val) => {
            storageMocks.deletedId = val;
            return { error: null };
          }
        }),
        upsert: async (rows) => {
          if (storageMocks.failUpsert) {
            return { error: new Error('Erro simulado no banco') };
          }
          upsertedRows.push(...rows);
          return { error: null };
        }
      }),
      storage: {
        from: (bucket) => ({
          upload: async (path, blob, opts) => {
            if (storageMocks.failUpload) {
              return { error: new Error('Simulação de falha no upload do Storage') };
            }
            uploadedFiles.push({ bucket, path, blob, opts });
            return { error: null };
          },
          getPublicUrl: (path) => ({
            data: { publicUrl: `https://owzamemhgbmrqmwlkqcc.supabase.co/storage/v1/object/public/${bucket}/${path}` }
          }),
          remove: async (paths) => {
            if (storageMocks.failRemove) {
              return { data: null, error: new Error('Simulação de erro na remoção do Storage') };
            }
            removedFiles.push(...paths);
            return { data: paths, error: null };
          }
        })
      }
    })
  };

  const sandbox = {
    window: {
      location: { search: '', hash: '' },
      supabase: mockSupabase,
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
    fetch: async (url) => ({
      blob: async () => ({ size: 1024, type: 'image/jpeg' })
    }),
    navigator: { clipboard: { writeText: async () => {} } },
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
    uploadedFiles,
    removedFiles,
    upsertedRows
  };

  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox;
  return { sandbox, getEl, mockLocalStorage, uploadedFiles, removedFiles, upsertedRows };
}

async function runImageLifecycleTests() {
  console.log('=== TESTES DO CICLO DE VIDA DE IMAGENS BOX74 ===\n');

  let passed = 0;
  let total = 0;

  function assertTest(condition, message) {
    total++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
    }
  }

  // TEST 1: Inicialização e mapeamento do produto com foto remota
  {
    const { sandbox, getEl } = createMockEnv();
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);
    await new Promise(r => setTimeout(r, 10));

    const state = sandbox.globalThis.__getInternalState();
    const prod = state.produtos.find(p => p.id === 'box74-test-1');
    assertTest(prod !== undefined, '1. Produto remoto com imagem carregado no catálogo');
    assertTest(prod.imagePath === 'products/box74-test-1-foto-antiga.jpg', '2. imagePath mapeado corretamente');
    assertTest(prod.imagem.includes('owzamemhgbmrqmwlkqcc.supabase.co'), '3. URL pública do Supabase Storage gerada corretamente');
  }

  // TEST 2: Edição do produto SEM alterar a imagem (preservação de imagePath)
  {
    const { sandbox, getEl, upsertedRows, uploadedFiles, removedFiles } = createMockEnv();
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);
    await new Promise(r => setTimeout(r, 10));

    const editBtn = {
      dataset: { edit: 'box74-test-1' },
      closest(sel) { return sel === '[data-edit]' ? this : null; }
    };
    await getEl('#admin-list').listeners['click']({ target: editBtn });

    getEl('#product-price').value = '25.00';
    await getEl('#product-form').listeners['submit']({ preventDefault() {} });

    const updated = sandbox.globalThis.__getInternalState().produtos.find(p => p.id === 'box74-test-1');
    assertTest(updated.preco === 25, '4. Preço atualizado com sucesso');
    assertTest(updated.imagePath === 'products/box74-test-1-foto-antiga.jpg', '5. imagePath PRESERVADO após edição de preço');
    assertTest(uploadedFiles.length === 0, '6. Nenhuma imagem enviada desnecessariamente quando não houve alteração de foto');
    assertTest(removedFiles.length === 0, '7. Nenhuma imagem removida do Storage quando a foto foi mantida');
    
    const rowInDb = upsertedRows.find(r => r.id === 'box74-test-1');
    assertTest(rowInDb.image_path === 'products/box74-test-1-foto-antiga.jpg', '8. image_path gravado no banco de dados sem ser anulado');
  }

  // TEST 3: Substituição de imagem por uma nova (upload da nova + remoção da antiga sem órfãos)
  {
    const { sandbox, getEl, upsertedRows, uploadedFiles, removedFiles } = createMockEnv();
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);
    await new Promise(r => setTimeout(r, 10));

    const editBtn = {
      dataset: { edit: 'box74-test-1' },
      closest(sel) { return sel === '[data-edit]' ? this : null; }
    };
    await getEl('#admin-list').listeners['click']({ target: editBtn });

    sandbox.globalThis.__setInternalState({
      fotoEmEdicao: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
      fotoSelecionada: true
    });

    await getEl('#product-form').listeners['submit']({ preventDefault() {} });

    assertTest(uploadedFiles.length === 1, '9. Nova imagem enviada para o bucket box74-products');
    assertTest(uploadedFiles[0].bucket === 'box74-products', '10. Bucket correto (box74-products) utilizado no upload');
    assertTest(uploadedFiles[0].path.startsWith('products/box74-test-1-'), '11. Caminho da nova imagem gerado no padrão products/id-timestamp.jpg');
    
    assertTest(removedFiles.length === 1, '12. Imagem antiga enviada para remoção no Storage');
    assertTest(removedFiles[0] === 'products/box74-test-1-foto-antiga.jpg', '13. Imagem antiga EXATA foi deletada (sem arquivos órfãos)');

    const prodState = sandbox.globalThis.__getInternalState().produtos.find(p => p.id === 'box74-test-1');
    assertTest(prodState.imagePath === uploadedFiles[0].path, '14. Novo imagePath atualizado no estado do produto');
    assertTest(prodState.imagem.includes(uploadedFiles[0].path), '15. Nova URL pública gerada e apontando para a nova imagem');

    const dbRow = upsertedRows[upsertedRows.length - 1];
    assertTest(dbRow.image_path === uploadedFiles[0].path, '16. Novo image_path persistido na tabela box74_products');
  }

  // TEST 4: Falha no upload NÃO provoca perda da imagem anterior nem corrupção no catálogo (REVERSÃO ATÔMICA)
  {
    const storageMocks = { failUpload: true };
    const { sandbox, getEl } = createMockEnv(storageMocks);
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);
    await new Promise(r => setTimeout(r, 10));

    const origProd = sandbox.globalThis.__getInternalState().produtos.find(p => p.id === 'box74-test-1');
    const origImg = origProd.imagem;
    const origPath = origProd.imagePath;

    // Simulate edit with new photo that will fail upload
    const editBtn = {
      dataset: { edit: 'box74-test-1' },
      closest(sel) { return sel === '[data-edit]' ? this : null; }
    };
    await getEl('#admin-list').listeners['click']({ target: editBtn });

    sandbox.globalThis.__setInternalState({
      fotoEmEdicao: 'data:image/jpeg;base64,INVASOR_CORROMPIDO...',
      fotoSelecionada: true
    });

    await getEl('#product-form').listeners['submit']({ preventDefault() {} });

    // Verify error was reported
    assertTest(getEl('#admin-status').textContent.includes('Não foi possível sincronizar') || getEl('#admin-status').textContent.includes('Falha no upload'), '17. Mensagem de erro reportada adequadamente na interface');

    // Verify in-memory product was REVERTED to original image and path
    const afterFail = sandbox.globalThis.__getInternalState().produtos.find(p => p.id === 'box74-test-1');
    assertTest(afterFail.imagem === origImg, '18. Falha de upload NÃO corrompe a URL da imagem anterior');
    assertTest(afterFail.imagePath === origPath, '19. Falha de upload PRESERVA o imagePath original');
  }

  // TEST 5: Falha no Storage.remove não declara a imagem removida falsamente
  {
    const storageMocks = { failRemove: true };
    const { sandbox, getEl } = createMockEnv(storageMocks);
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);
    await new Promise(r => setTimeout(r, 10));

    // Edit and select new photo
    const editBtn = {
      dataset: { edit: 'box74-test-1' },
      closest(sel) { return sel === '[data-edit]' ? this : null; }
    };
    await getEl('#admin-list').listeners['click']({ target: editBtn });

    sandbox.globalThis.__setInternalState({
      fotoEmEdicao: 'data:image/jpeg;base64,NOVA_FOTO...',
      fotoSelecionada: true
    });

    await getEl('#product-form').listeners['submit']({ preventDefault() {} });

    // Verify notification informs that old image could not be removed
    assertTest(getEl('#admin-status').textContent.includes('não pôde ser removida do Storage'), '20. Falha na remoção do Storage é sinalizada com precisão sem declarar sucesso falso');
  }

  // TEST 6: Falha na remoção da imagem ao excluir produto
  {
    const storageMocks = { failRemove: true };
    const { sandbox, getEl } = createMockEnv(storageMocks);
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);
    await new Promise(r => setTimeout(r, 10));

    const delBtn = {
      dataset: { delete: 'box74-test-1' },
      closest(sel) { return sel === '[data-delete]' ? this : null; }
    };
    await getEl('#admin-list').listeners['click']({ target: delBtn });

    assertTest(getEl('#admin-status').textContent.includes('não pôde ser removida do Storage'), '21. Exclusão com falha de storage avisa que a imagem não pôde ser removida');
  }

  // TEST 7: Recarregar a página (verificar se a imagem permanece visível via cache e renderização)
  {
    const { sandbox, mockLocalStorage } = createMockEnv();
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox);
    await new Promise(r => setTimeout(r, 10));

    const cachedStr = mockLocalStorage.getItem('box74-catalogo-v2');
    assertTest(cachedStr !== null, '22. Catálogo com fotos gravado em cache no localStorage');
    const cached = JSON.parse(cachedStr);
    assertTest(cached[0].imagem.includes('supabase.co'), '23. Cache preserva URLs públicas do Supabase');
    assertTest(cached[0].imagePath === 'products/box74-test-1-foto-antiga.jpg', '24. Cache preserva imagePath');

    const env2 = createMockEnv();
    env2.mockLocalStorage.setItem('box74-catalogo-v2', cachedStr);
    vm.createContext(env2.sandbox);
    vm.runInContext(scriptCode, env2.sandbox);

    const reloadedState = env2.sandbox.globalThis.__getInternalState();
    const reloadedProd = reloadedState.produtos.find(p => p.id === 'box74-test-1');
    assertTest(reloadedProd.imagem.includes('supabase.co'), '25. Imagem permanece visível imediatamente no recarregamento da página');
  }

  console.log(`\n========================================`);
  console.log(`TOTAL DE TESTES DE CICLO DE VIDA DE IMAGENS: ${passed}/${total} aprovados.`);
  console.log(`========================================`);

  if (passed !== total) {
    process.exit(1);
  }
}

runImageLifecycleTests();
