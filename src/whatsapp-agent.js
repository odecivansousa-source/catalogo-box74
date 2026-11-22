// =====================================================================
// BOX74 - Cérebro do Agente de Atendimento WhatsApp
// Atendimento Inteligente, Consulta de Catálogo, Recomendações,
// Carrinho Conversacional, Validação de Estoque e Persistência no Supabase
// =====================================================================

const https = require('https');
const { config: defaultConfig } = require('./config');
const { AIService } = require('./services/ai-service');
const { HumanHandoffService } = require('./services/human-handoff');

const DEFAULT_SUPABASE_URL = defaultConfig?.supabase?.url || 'https://owzamemhgbmrqmwlkqcc.supabase.co';
const DEFAULT_SUPABASE_KEY = defaultConfig?.supabase?.anonKey || 'sb_publishable_9Q9g9ziWIZuhq24zRPp11Q_OgIMhkq6';
const PIX_KEY = defaultConfig?.pix?.key || '5fbf536f-8dea-4ff2-9546-7f4e0e487e3d';
const PIX_OWNER = defaultConfig?.pix?.owner || 'Adriana Maria de Lima Almeida';

class WhatsAppAgent {
  constructor(options = {}) {
    this.config = options.config || defaultConfig || {};
    this.supabaseUrl = options.supabaseUrl || this.config.supabase?.url || DEFAULT_SUPABASE_URL;
    this.supabaseKey = options.supabaseKey || this.config.supabase?.anonKey || DEFAULT_SUPABASE_KEY;
    this.catalogCache = null;
    this.catalogCacheTime = 0;
    this.cacheTtlMs = options.cacheTtlMs || 60000; // 1 minuto
    this.processedMessageIds = new Set();
    this.inMemoryConversations = new Map();
    this.customClient = options.supabaseClient || null;

    // Serviços auxiliares integrados
    this.aiService = options.aiService || new AIService(options.ai || this.config.ai);
    this.coexistenceService = options.coexistenceService || null;
    this.humanHandoff = options.humanHandoff || new HumanHandoffService({
      ...(this.config.humanSupport || {}),
      ...(options.humanSupport || {}),
      adapter: options.adapter
    });
  }

  // Normalização de texto para NLU tolerante a erros de digitação e acentos
  normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^\w\s]/gi, ' ')      // remove pontuação
      .replace(/\s+/g, ' ')          // normaliza espaços
      .trim();
  }

  // Distância Levenshtein para correspondência aproximada
  levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  // Similaridade entre 0 e 1
  similarity(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    const dist = this.levenshtein(a, b);
    return 1.0 - (dist / maxLen);
  }

  // Requisição HTTP genérica para Supabase REST API
  async _supabaseRequest(endpoint, method = 'GET', body = null, options = {}) {
    if (this.customClient) {
      return null;
    }
    return new Promise((resolve, reject) => {
      const url = `${this.supabaseUrl}${endpoint}`;
      const headers = {
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json'
      };
      if (method === 'POST') {
        headers['Prefer'] = options.prefer || 'return=representation';
      }

      const req = https.request(url, { method, headers }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed = null;
          try {
            if (data) parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ statusCode: res.statusCode, data: parsed });
        });
      });

      req.on('error', reject);
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  // 1. Consulta ao catálogo diretamente no Supabase com cache
  async getCatalog(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.catalogCache && (now - this.catalogCacheTime < this.cacheTtlMs)) {
      return this.catalogCache;
    }

    if (this.customClient) {
      const { data, error } = await this.customClient.from('box74_products').select('*').order('sort_order');
      if (!error && Array.isArray(data)) {
        this.catalogCache = data;
        this.catalogCacheTime = now;
        return data;
      }
    }

    try {
      const res = await this._supabaseRequest('/rest/v1/box74_products?select=*&order=sort_order.asc');
      if (res.statusCode === 200 && Array.isArray(res.data)) {
        this.catalogCache = res.data;
        this.catalogCacheTime = now;
        return res.data;
      }
    } catch (err) {
      console.warn('Erro ao carregar catálogo remoto:', err.message);
    }

    return this.catalogCache || [];
  }

  // Preço de venda efetivo (considera promoção ativa)
  getProductPrice(product) {
    const promo = Number(product.promo_price);
    const regular = Number(product.price);
    if (promo > 0 && promo < regular) {
      return promo;
    }
    return regular;
  }

  // Busca inteligente de produto por nome ou categoria com tolerância a erros e palavras-chave
  findProductInCatalog(catalog, query) {
    if (!query || !catalog || !catalog.length) return null;
    const qNorm = this.normalizeText(query);
    if (!qNorm) return null;

    // 1. Busca exata por nome completo
    for (const p of catalog) {
      const pNorm = this.normalizeText(p.name);
      if (pNorm === qNorm) return p;
    }

    // 2. Análise por tokens do produto presentes na consulta
    const stopWords = new Set(['de', 'da', 'do', 'dos', 'das', 'para', 'com', 'sem', 'em', 'um', 'uma', 'uns', 'umas', 'litro', 'litros', 'litrao', 'galao', 'galoes']);
    const qTokens = qNorm.split(/\s+/).filter(t => t.length > 0);

    let bestProduct = null;
    let highestScore = 0;

    for (const p of catalog) {
      const pNorm = this.normalizeText(p.name);
      const pTokens = pNorm.split(/\s+/).filter(t => t.length >= 3 && !stopWords.has(t));
      if (!pTokens.length) continue;

      let matchedPTokens = 0;
      for (const pTok of pTokens) {
        let tokMatched = false;
        for (const qTok of qTokens) {
          if (qTok === pTok) {
            tokMatched = true;
            break;
          }
          if (pTok.length >= 4 && qTok.length >= 4 && (pTok.includes(qTok) || qTok.includes(pTok))) {
            tokMatched = true;
            break;
          }
          const sim = this.similarity(pTok, qTok);
          if (sim >= 0.58) {
            tokMatched = true;
            break;
          }
        }
        if (tokMatched) matchedPTokens++;
      }

      const score = matchedPTokens / pTokens.length;

      // Bônus para termos altamente específicos da BOX74
      let bonus = 0;
      if (pNorm.includes('clarilux') && (qNorm.includes('clarilux') || qNorm.includes('clarilux'))) bonus += 0.25;
      if (pNorm.includes('lavalu') && qNorm.includes('lavalu')) bonus += 0.25;
      if (pNorm.includes('pinho') && qNorm.includes('pinho')) bonus += 0.35;
      if (pNorm.includes('polidor') && qNorm.includes('polidor')) bonus += 0.35;
      if (pNorm.includes('detergente') && (qNorm.includes('detergente') || qNorm.includes('deterjente') || qNorm.includes('deterg'))) bonus += 0.30;
      if (pNorm.includes('desinfetante') && (qNorm.includes('desinfetante') || qNorm.includes('desinfetant'))) bonus += 0.30;
      if (pNorm.includes('amaciante') && (qNorm.includes('amaciante') || qNorm.includes('amacianti'))) bonus += 0.30;
      if (pNorm.includes('sabao') && (qNorm.includes('sabao') || qNorm.includes('sabaum'))) bonus += 0.20;

      const totalScore = score + bonus;
      if (matchedPTokens >= 1 && totalScore > highestScore && totalScore >= 0.45) {
        highestScore = totalScore;
        bestProduct = p;
      }
    }

    return bestProduct;
  }

  // 2. Recomendações de produtos por necessidade
  recommendProducts(catalog, needText) {
    const norm = this.normalizeText(needText);
    const recommendations = [];

    const needMappings = [
      {
        keys: ['roupa', 'roupas', 'lavar roupa', 'tecido', 'lavanderia', 'maquina', 'mancha'],
        searchTerms: ['Sabão Líquido Clarilux', 'Amaciante de Roupas Clarilux'],
        reason: 'Para lavar suas roupas com máximo rendimento e maciez, recomendamos o Sabão Líquido e o Amaciante Clarilux de 5L!'
      },
      {
        keys: ['louca', 'loucas', 'prato', 'talher', 'copo', 'pia', 'gordura louca'],
        searchTerms: ['Detergente Lava-Louças Clarilux'],
        reason: 'Para lavar louças e desengordurar sem agredir as mãos, a melhor opção é o Detergente Lava-Louças Clarilux 5L!'
      },
      {
        keys: ['pesada', 'aluminio', 'panela', 'panelas', 'graxa', 'forno', 'fogao', 'encardido', 'chapa', 'gordura pesada'],
        searchTerms: ['Polidor de Alumínio DDA-4 Clarilux', 'Pasta de Pinho Clarilimp'],
        reason: 'Para limpeza pesada e tirar gordura incrustada de panelas e grelhas, recomendamos o Polidor de Alumínio DDA-4 ou a Pasta de Pinho Clarilimp!'
      },
      {
        keys: ['banheiro', 'sanitario', 'vaso', 'desinfetar', 'germes', 'bacteria', 'cheiro bom', 'privada'],
        searchTerms: ['Desinfetante Lavalu', 'Água Sanitária Lavalu'],
        reason: 'Para desinfetar banheiros, pisos e deixar o ambiente perfumado, indicamos o Desinfetante Lavalu 5L e a Água Sanitária!'
      },
      {
        keys: ['carro', 'auto', 'veiculo', 'moto', 'parabrisa', 'lataria'],
        searchTerms: ['Lava Auto Lavalu'],
        reason: 'Para lavar seu carro ou moto com brilho e proteção, o ideal é o Lava Auto Lavalu 5L!'
      },
      {
        keys: ['maos', 'sabonete', 'lavabo', 'banho'],
        searchTerms: ['Sabonete Líquido'],
        reason: 'Para higiene das mãos com suavidade, temos o Sabonete Líquido!'
      }
    ];

    for (const mapping of needMappings) {
      if (mapping.keys.some(k => norm.includes(k))) {
        const found = [];
        for (const term of mapping.searchTerms) {
          const prod = this.findProductInCatalog(catalog, term);
          if (prod) found.push(prod);
        }
        if (found.length > 0) {
          recommendations.push({
            reason: mapping.reason,
            products: found
          });
        }
      }
    }

    return recommendations;
  }

  // Extrai filtro de volume solicitado pelo cliente em linguagem natural
  extractVolumeFilter(text) {
    const norm = this.normalizeText(text);
    const m = norm.match(/\b(\d+)\s*(l|litros?|litrao)\b/) || norm.match(/galao\s*de\s*(\d+)/) || norm.match(/galao\s*(\d+)/);
    if (m) {
      return m[1];
    }
    if (/\b(cinco\s*litros?|cinco\s*l)\b/.test(norm)) return '5';
    if (/\b(dois\s*litros?|dois\s*l)\b/.test(norm)) return '2';
    if (/\b(um\s*litro|um\s*l)\b/.test(norm)) return '1';
    if (/\b(500\s*ml|meio\s*litro)\b/.test(norm)) return '500';
    return null;
  }

  // Verifica se o tamanho do produto corresponde ao volume filtrado
  matchProductVolume(productSize, volumeFilter) {
    if (!volumeFilter) return true;
    if (!productSize) return false;
    const sNorm = this.normalizeText(productSize);
    const regex = new RegExp('(^|\\s)' + volumeFilter + '(\\s*litros?|\\s*l|\\s*ml|$)', 'i');
    return regex.test(sNorm);
  }

  // Identifica intenção de consulta por categoria/tipo de produto
  findCategoryInquiry(text) {
    const norm = this.normalizeText(text);

    const categoryDefinitions = [
      {
        key: 'sabao liquido',
        label: 'Sabão Líquido',
        pattern: /\b(sabao\s+liquido|saboes\s+liquidos)\b/,
        match: (p) => {
          const c = this.normalizeText(p.category || '');
          const n = this.normalizeText(p.name || '');
          return c.includes('sabao liquido') || n.includes('sabao liquido');
        }
      },
      {
        key: 'amaciante',
        label: 'Amaciante',
        pattern: /\b(amaciante|amaciantes)\b/,
        match: (p) => {
          const c = this.normalizeText(p.category || '');
          const n = this.normalizeText(p.name || '');
          return c.includes('amaciante') || n.includes('amaciante');
        }
      },
      {
        key: 'detergente',
        label: 'Detergente',
        pattern: /\b(detergente|detergentes)\b/,
        match: (p) => {
          const c = this.normalizeText(p.category || '');
          const n = this.normalizeText(p.name || '');
          return c.includes('detergente') || n.includes('detergente');
        }
      },
      {
        key: 'desinfetante',
        label: 'Desinfetante',
        pattern: /\b(desinfetante|desinfetantes)\b/,
        match: (p) => {
          const c = this.normalizeText(p.category || '');
          const n = this.normalizeText(p.name || '');
          return c.includes('desinfetante') || n.includes('desinfetante');
        }
      },
      {
        key: 'agua sanitaria',
        label: 'Água Sanitária',
        pattern: /\b(agua\s+sanitaria|aguas\s+sanitarias|cloro)\b/,
        match: (p) => {
          const c = this.normalizeText(p.category || '');
          const n = this.normalizeText(p.name || '');
          return c.includes('agua sanitaria') || n.includes('agua sanitaria') || c.includes('cloro') || n.includes('cloro');
        }
      },
      {
        key: 'saco de lixo',
        label: 'Saco de Lixo',
        pattern: /\b(saco\s+de\s+lixo|sacos\s+de\s+lixo)\b/,
        match: (p) => {
          const c = this.normalizeText(p.category || '');
          const n = this.normalizeText(p.name || '');
          return c.includes('saco') || n.includes('saco de lixo') || n.includes('sacos de lixo');
        }
      }
    ];

    for (const def of categoryDefinitions) {
      if (def.pattern.test(norm)) {
        return def;
      }
    }
    return null;
  }

  // 3. Gestão de Estado e Memória da Conversa (Supabase / In-Memory)
  async getConversation(phone) {
    let conv = null;

    if (this.customClient) {
      const { data } = await this.customClient.rpc('box74_get_conversation', { p_phone: phone });
      if (data) conv = data;
    }

    if (!conv) {
      try {
        const res = await this._supabaseRequest('/rest/v1/rpc/box74_get_conversation', 'POST', { p_phone: phone });
        if (res.statusCode === 200 && res.data) {
          conv = res.data;
        }
      } catch (e) {
        // fallback in-memory
      }
    }

    if (!conv) {
      if (!this.inMemoryConversations.has(phone)) {
        this.inMemoryConversations.set(phone, {
          phone,
          customer_name: null,
          customer_address: null,
          fulfillment: 'Retirada na loja',
          cart: [],
          state: 'atendimento_ia',
          pending_order_id: null
        });
      }
      conv = this.inMemoryConversations.get(phone);
    }

    // Garantir que cart seja sempre um array em JavaScript
    if (typeof conv.cart === 'string') {
      try { conv.cart = JSON.parse(conv.cart); } catch (e) { conv.cart = []; }
    }
    if (!Array.isArray(conv.cart)) conv.cart = [];

    // Manter sincronizado no in-memory
    this.inMemoryConversations.set(phone, conv);
    return conv;
  }

  async saveConversation(conv) {
    if (!Array.isArray(conv.cart)) conv.cart = [];
    this.inMemoryConversations.set(conv.phone, { ...conv, updated_at: new Date().toISOString() });

    if (this.customClient) {
      await this.customClient.rpc('box74_save_conversation', {
        p_phone: conv.phone,
        p_name: conv.customer_name || null,
        p_address: conv.customer_address || null,
        p_fulfillment: conv.fulfillment || 'Retirada na loja',
        p_cart: conv.cart || [],
        p_state: conv.state || 'atendimento_ia',
        p_order_id: conv.pending_order_id || null
      });
      return;
    }

    try {
      await this._supabaseRequest('/rest/v1/rpc/box74_save_conversation', 'POST', {
        p_phone: conv.phone,
        p_name: conv.customer_name || null,
        p_address: conv.customer_address || null,
        p_fulfillment: conv.fulfillment || 'Retirada na loja',
        p_cart: conv.cart || [],
        p_state: conv.state || 'atendimento_ia',
        p_order_id: conv.pending_order_id || null
      });
    } catch (e) {
      // fallback in-memory já atualizado
    }
  }

  // Idempotência de mensagens (evita duplicidade de processamento no WhatsApp)
  async isMessageProcessed(messageId, phone, text) {
    if (!messageId) return false;
    if (this.processedMessageIds.has(messageId)) return true;

    if (this.customClient) {
      const { data } = await this.customClient.rpc('box74_record_message', {
        p_id: messageId,
        p_phone: phone,
        p_direction: 'inbound',
        p_content: text
      });
      if (data === false) return true;
      this.processedMessageIds.add(messageId);
      return false;
    }

    try {
      const res = await this._supabaseRequest('/rest/v1/rpc/box74_record_message', 'POST', {
        p_id: messageId,
        p_phone: phone,
        p_direction: 'inbound',
        p_content: text
      });
      if (res.statusCode === 200 && res.data === false) {
        return true;
      }
      this.processedMessageIds.add(messageId);
      return false;
    } catch (e) {
      if (this.processedMessageIds.has(messageId)) return true;
      this.processedMessageIds.add(messageId);
      return false;
    }
  }

  // Grava mensagem enviada pelo bot no histórico de mensagens do Supabase
  async recordOutgoingMessage(messageId, phone, text) {
    if (!phone || !text) return;
    const outId = `out-${messageId || Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    if (this.customClient) {
      try {
        await this.customClient.rpc('box74_record_message', {
          p_id: outId,
          p_phone: phone,
          p_direction: 'outbound',
          p_content: text
        });
      } catch (err) {
        // Fallback silencioso
      }
      return;
    }

    try {
      await this._supabaseRequest('/rest/v1/rpc/box74_record_message', 'POST', {
        p_id: outId,
        p_phone: phone,
        p_direction: 'outbound',
        p_content: text
      });
    } catch (e) {
      // Ignora falha de auditoria para não travar a conversa
    }
  }

  // Formatação de Moeda
  formatCurrency(val) {
    return `R$ ${Number(val).toFixed(2).replace('.', ',')}`;
  }

  // 4. Extração de Quantidade em Texto Natural
  extractQuantity(text) {
    const norm = this.normalizeText(text);
    const matchNum = norm.match(/\b(\d+)\b/);
    if (matchNum) {
      const n = parseInt(matchNum[1], 10);
      if (n > 0) return n;
    }
    if (/\bum\b|\buma\b/.test(norm)) return 1;
    if (/\bdois\b|\bduas\b/.test(norm)) return 2;
    if (/\btres\b/.test(norm)) return 3;
    if (/\bquatro\b/.test(norm)) return 4;
    if (/\bcinco\b/.test(norm)) return 5;
    if (/\bdez\b/.test(norm)) return 10;
    return 1;
  }

  // 5. Motor Central de Processamento Conversacional
  async processMessage({ messageId, from, text }) {
    if (!from || !text) {
      return { response: 'Mensagem inválida.', state: 'error' };
    }

    // Regra 12: Idempotência de mensagens
    if (messageId && await this.isMessageProcessed(messageId, from, text)) {
      return { ignored: true, reason: 'duplicate_message' };
    }

    const conv = await this.getConversation(from);
    if (!Array.isArray(conv.cart)) conv.cart = [];
    const norm = this.normalizeText(text);
    const catalog = await this.getCatalog();

    // Regra 11: Proteção contra comandos administrativos e injeção de preços
    if (/drop table|delete from|update box74|set price|set stock|fazer por|desconto de|quero pagar menos/i.test(text)) {
      if (/fazer por|desconto de|quero pagar menos/i.test(text)) {
        return {
          response: 'Os valores da BOX74 são tabelados de acordo com nosso catálogo oficial e não podemos conceder descontos adicionais sem autorização prévia da gerência. Para negociações especiais, você pode solicitar a transferência para um atendente humano.',
          state: conv.state
        };
      }
    }

    // Regra 9: Transferência para Atendimento Humano
    if (/\b(atendente|humano|humana|pessoa real|falar com alguém|falar com alguem|suporte humano|atendimento humano)\b/.test(norm)) {
      conv.state = 'transf_humano';
      conv.last_human_intervention_at = new Date().toISOString();
      await this.saveConversation(conv);
      if (this.humanHandoff) {
        await this.humanHandoff.triggerHandoff(from, {
          customerName: conv.customer_name,
          lastMessage: text,
          cartSummary: this._formatCartMessage(conv)
        });
      }
      return {
        response: 'Encaminhei sua conversa para a equipe da BOX74. Um responsável humano continuará o atendimento por aqui em instantes!\n\nCaso queira voltar para o atendimento automático, basta digitar *MENU*.',
        state: 'transf_humano'
      };
    }

    // Verificação de Intervenção Humana (respeitando coexistência e persistência durável no banco)
    let isUnderHuman = conv.state === 'transf_humano' || (this.humanHandoff && this.humanHandoff.isSilenced(from));
    if (!isUnderHuman && this.coexistenceService && typeof this.coexistenceService.isCustomerUnderHumanWindow === 'function') {
      isUnderHuman = await this.coexistenceService.isCustomerUnderHumanWindow(from, this);
    }

    // Comando de Reinício / Menu - SEMPRE limpa o estado humano persistido e retoma o atendimento
    if (norm === 'menu' || norm === 'reiniciar' || norm === 'inicio' || norm === 'voltar') {
      conv.state = 'atendimento_ia';
      conv.last_human_intervention_at = null;
      await this.saveConversation(conv);
      if (this.humanHandoff) {
        this.humanHandoff.resumeBot(from);
      }
      if (this.coexistenceService && typeof this.coexistenceService.clearHumanWindow === 'function') {
        await this.coexistenceService.clearHumanWindow(from, this);
      }
      return {
        response: isUnderHuman
          ? 'Atendimento automático reiniciado! Como posso ajudar você hoje na BOX74?'
          : 'Olá! Sou o assistente virtual da *BOX74 - Produtos de Limpeza*.\n\nComo posso te ajudar?\n1. Ver opções do *Catálogo de produtos*\n2. Receber uma *Recomendação* para sua limpeza\n3. Ver seu *Carrinho de compras*\n4. Falar com *Atendente humano*',
        state: 'atendimento_ia'
      };
    }

    // Se estiver sob atendimento humano e NÃO digitou "menu", a IA silencia
    if (isUnderHuman) {
      return { ignored: true, reason: 'in_human_support' };
    }

    // ==========================================
    // ETAPAS DE FINALIZAÇÃO DO PEDIDO (STATEFUL)
    // ==========================================
    if (conv.state === 'coletando_nome') {
      conv.customer_name = text.trim();
      conv.state = 'coletando_recebimento';
      await this.saveConversation(conv);
      return {
        response: `Perfeito, *${conv.customer_name}*!\n\nComo você prefere receber seu pedido?\n1. *Retirada na loja*\n2. *Entrega* (frete a combinar pelo WhatsApp)`,
        state: 'coletando_recebimento'
      };
    }

    if (conv.state === 'coletando_recebimento') {
      if (norm.includes('1') || norm.includes('retirada') || norm.includes('loja')) {
        conv.fulfillment = 'Retirada na loja';
        conv.customer_address = null;
        conv.state = 'aguardando_confirmacao';
        await this.saveConversation(conv);
        return {
          response: this._buildOrderConfirmationSummary(conv),
          state: 'aguardando_confirmacao'
        };
      } else if (norm.includes('2') || norm.includes('entrega') || norm.includes('entregar')) {
        conv.fulfillment = 'Entrega (frete a combinar)';
        conv.state = 'coletando_endereco';
        await this.saveConversation(conv);
        return {
          response: 'Por favor, informe seu *endereço completo* para entrega (Rua, número, bairro e cidade):',
          state: 'coletando_endereco'
        };
      } else {
        return {
          response: 'Por favor, escolha uma das opções:\n1 para *Retirada na loja*\n2 para *Entrega*',
          state: 'coletando_recebimento'
        };
      }
    }

    if (conv.state === 'coletando_endereco') {
      if (text.trim().length < 5) {
        return {
          response: 'Por favor, informe o endereço completo para a entrega (Rua, número e bairro):',
          state: 'coletando_endereco'
        };
      }
      conv.customer_address = text.trim();
      conv.state = 'aguardando_confirmacao';
      await this.saveConversation(conv);
      return {
        response: this._buildOrderConfirmationSummary(conv),
        state: 'aguardando_confirmacao'
      };
    }

    if (conv.state === 'aguardando_confirmacao') {
      if (norm === 'sim' || norm.includes('confirmo') || norm.includes('confirmar') || norm.includes('pode fechar') || norm === 'ok' || norm === 'fechado') {
        const orderResult = await this._persistConfirmedOrder(conv);
        conv.cart = [];
        conv.state = 'atendimento_ia';
        await this.saveConversation(conv);

        return {
          response: `✅ *Pedido confirmado com sucesso!*\n\nCódigo do pedido: *#${orderResult.id}*\nValor total: *${this.formatCurrency(orderResult.total)}*\nRecebimento: *${conv.fulfillment}*\n\n*Dados para Pagamento via Pix:*\nChave Pix: \`${PIX_KEY}\`\nTitular: *${PIX_OWNER}*\n\nApós o pagamento, envie o comprovante por aqui para prepararmos seu pedido. A equipe da BOX74 agradece sua preferência!`,
          state: 'pedido_concluido',
          order: orderResult
        };
      } else if (norm.includes('nao') || norm.includes('cancelar') || norm.includes('cancela') || norm.includes('mudar')) {
        conv.state = 'atendimento_ia';
        await this.saveConversation(conv);
        return {
          response: 'O pedido não foi finalizado. Seu carrinho continua salvo! Você pode adicionar ou alterar itens, ou digitar *MENU* para reiniciar.',
          state: 'atendimento_ia'
        };
      } else {
        return {
          response: 'Por favor, responda *SIM* para confirmar e registrar seu pedido, ou *NÃO* caso queira alterar algo.',
          state: 'aguardando_confirmacao'
        };
      }
    }

    // ==========================================
    // ATENDIMENTO GERAL E RECONHECIMENTO DE INTENÇÕES
    // ==========================================

    // Saudações
    if (/^(oi|ola|bom dia|boa tarde|boa noite|opa|e ai|tudo bem)\b/i.test(norm) && norm.split(' ').length <= 4) {
      return {
        response: 'Olá! Seja muito bem-vindo(a) à *BOX74 - Produtos de Limpeza*!\n\nComo posso te ajudar hoje?\n• Me diga o que precisa limpar ou lavar;\n• Peça um produto do nosso catálogo;\n• Ou solicite o que deseja adicionar ao seu carrinho.',
        state: 'atendimento_ia'
      };
    }

    // Consulta Específica por Categoria ou Tipo de Produto (ex: Sabão líquido 5L)
    const isRemovalIntent = /\b(tirar|tira|remover|remove|excluir)\b/.test(norm);
    const categoryInquiry = !isRemovalIntent ? this.findCategoryInquiry(norm) : null;
    const isQuestionOrInquiry = /\b(quais|quanto|quantos|qual|custa|custam|valor|preco|precos|tipos|opcoes|tem|temos)\b/.test(norm);
    const isDirectPurchase = (/\b(quero|adiciona|adicionar|bota|coloca|me ve|me manda|leva|levar)\b/.test(norm) && !isQuestionOrInquiry);

    if (categoryInquiry && !isDirectPurchase && !isRemovalIntent) {
      const volumeFilter = this.extractVolumeFilter(norm);
      let matchingProducts = catalog.filter(p => categoryInquiry.match(p));

      // Se o cliente especificou volume (ex: galão de 5 litros), filtra estritamente
      if (volumeFilter) {
        matchingProducts = matchingProducts.filter(p => this.matchProductVolume(p.size, volumeFilter));
      }

      if (matchingProducts.length > 0) {
        const volumeLabel = volumeFilter === '5'
          ? ' no galão de *5 litros*'
          : (volumeFilter ? (/^\d+$/.test(volumeFilter) ? ` de *${volumeFilter} litros*` : ` de *${volumeFilter}*`) : '');
        let resp = `Temos as seguintes opções de *${categoryInquiry.label}*${volumeLabel}:\n\n`;

        for (const p of matchingProducts) {
          const preco = this.getProductPrice(p);
          const stockText = p.stock !== null && p.stock !== '' && Number(p.stock) <= 0 ? ' _(Esgotado no momento)_' : '';
          resp += `• *${p.name}* (${p.size || '5L'}) — ${this.formatCurrency(preco)}${stockText}\n`;
        }

        resp += '\nQual dessas opções e quantas unidades você gostaria de pedir?';
        return { response: resp, state: 'atendimento_ia' };
      } else {
        const volumeLabel = volumeFilter === '5'
          ? ' no galão de 5 litros'
          : (volumeFilter ? (/^\d+$/.test(volumeFilter) ? ` de ${volumeFilter} litros` : ` de ${volumeFilter}`) : '');
        return {
          response: `No momento não encontramos opções de *${categoryInquiry.label}*${volumeLabel} em nosso catálogo.\n\nGostaria de ver outras opções de limpeza ou outro tamanho?`,
          state: 'atendimento_ia'
        };
      }
    }

    // Consulta ao Catálogo Geral
    if (/\b(catalogo|tabela|o que voces tem|o que tem|quais produtos|quais sao os produtos)\b/.test(norm) || (/\b(produtos)\b/.test(norm) && !categoryInquiry)) {
      const promoProducts = catalog.filter(p => Number(p.promo_price) > 0 && Number(p.promo_price) < Number(p.price));
      let msg = '🌟 *Catálogo BOX74 — Destaques e Linhas Principais (Galões 5L)*:\n\n';
      const mainProds = catalog.slice(0, 10);
      for (const p of mainProds) {
        const preco = this.getProductPrice(p);
        const stockText = p.stock !== null && p.stock <= 0 ? ' _(Esgotado)_' : '';
        msg += `• *${p.name}* (${p.size || '5L'}) — ${this.formatCurrency(preco)}${stockText}\n`;
      }
      if (promoProducts.length > 0) {
        msg += '\n🔥 *Promoções ativas:*\n';
        for (const p of promoProducts) {
          msg += `• *${p.name}* de ~${this.formatCurrency(p.price)}~ por apenas *${this.formatCurrency(p.promo_price)}*!\n`;
        }
      }
      msg += '\nPara pedir, basta escrever, por exemplo: _"Quero 2 sabão clarilux e 1 amaciante"_';
      return { response: msg, state: 'atendimento_ia' };
    }

    // Recomendações por necessidade
    const isAskingRec = /\b(recomenda|recomendacao|o que voce tem para|o que e bom|preciso de|quero algo para|algo para|indica|indicacao)\b/.test(norm) ||
      (/\b(roupa|roupas|panela|panelas|gordura|banheiro|carro|auto|louca)\b/.test(norm) && !/\b(adiciona|adicionar|bota|coloca|tirar|remover)\b/.test(norm));
    
    if (isAskingRec) {
      const recs = this.recommendProducts(catalog, norm);
      if (recs.length > 0) {
        let resp = '';
        for (const r of recs) {
          resp += `${r.reason}\n`;
          for (const p of r.products) {
            const preco = this.getProductPrice(p);
            const estoque = p.stock !== null && p.stock <= 0 ? ' _(Esgotado no momento)_' : '';
            resp += `• *${p.name}* (${p.size || '5L'}): ${this.formatCurrency(preco)}${estoque}\n`;
          }
        }
        resp += '\nDeseja adicionar algum destes ao seu pedido? Basta dizer a quantidade e o produto!';
        return { response: resp, state: 'atendimento_ia' };
      }
    }

    // Ver Carrinho
    if (/\b(ver carrinho|meu carrinho|meu pedido|o que tem no carrinho|quanto ta dando|quanto deu|total do pedido)\b/.test(norm)) {
      return { response: this._formatCartMessage(conv), state: 'atendimento_ia' };
    }

    // Limpar Carrinho
    if (/\b(limpar carrinho|esvaziar carrinho|zerar carrinho|apagar carrinho)\b/.test(norm)) {
      conv.cart = [];
      await this.saveConversation(conv);
      return { response: 'Seu carrinho foi esvaziado com sucesso.', state: 'atendimento_ia' };
    }

    // Remover Item do Carrinho
    if (/\b(tirar|tira|remover|remove|excluir|cancela)\b/.test(norm)) {
      const matchProd = this.findProductInCatalog(catalog, norm);
      if (matchProd) {
        const initialLen = conv.cart.length;
        conv.cart = conv.cart.filter(it => it.id !== matchProd.id && !it.nome.toLowerCase().includes(matchProd.name.toLowerCase()));
        if (conv.cart.length < initialLen) {
          await this.saveConversation(conv);
          return {
            response: `Item *${matchProd.name}* removido do seu carrinho!\n\n${this._formatCartMessage(conv)}`,
            state: 'atendimento_ia'
          };
        } else {
          return {
            response: `O item *${matchProd.name}* não estava no seu carrinho.\n\n${this._formatCartMessage(conv)}`,
            state: 'atendimento_ia'
          };
        }
      }
    }

    // Adicionar Item / Pedido Conversacional
    const matchedProduct = this.findProductInCatalog(catalog, norm);
    const isAddingIntent = !isQuestionOrInquiry && (/\b(quero|adiciona|adicionar|bota|coloca|me ve|me manda|comprar|leva|levar|mais|unidade|unidades)\b/.test(norm) ||
      (/\d+/.test(norm) && matchedProduct && !/\b(quanto|preco|valor|custa)\b/.test(norm)));

    if (matchedProduct && isAddingIntent) {
      // Regra 6: Validação de Estoque
      if (matchedProduct.stock !== null && matchedProduct.stock !== '' && Number(matchedProduct.stock) <= 0) {
        return {
          response: `Puxa, o produto *${matchedProduct.name}* está esgotado no momento. Posso sugerir outra opção similar do nosso catálogo?`,
          state: 'atendimento_ia'
        };
      }

      const qtdDesejada = this.extractQuantity(norm);
      const stockAvailable = matchedProduct.stock !== null && matchedProduct.stock !== '' ? Number(matchedProduct.stock) : Infinity;

      const existingItem = conv.cart.find(it => it.id === matchedProduct.id || it.nome.toLowerCase() === matchedProduct.name.toLowerCase());
      const currentCartQty = existingItem ? existingItem.quantidade : 0;
      const totalRequested = currentCartQty + qtdDesejada;

      if (totalRequested > stockAvailable) {
        const canAdd = Math.max(0, stockAvailable - currentCartQty);
        if (canAdd <= 0) {
          return {
            response: `Você já possui ${currentCartQty} unidade(s) de *${matchedProduct.name}* no carrinho, que é todo o estoque que temos disponível no momento.`,
            state: 'atendimento_ia'
          };
        } else {
          return {
            response: `Temos apenas ${stockAvailable} unidade(s) de *${matchedProduct.name}* em estoque. Você já possui ${currentCartQty} no carrinho, portanto só é possível adicionar mais ${canAdd} unidade(s).`,
            state: 'atendimento_ia'
          };
        }
      }

      const precoUnit = this.getProductPrice(matchedProduct);
      if (existingItem) {
        existingItem.quantidade += qtdDesejada;
        existingItem.subtotal = existingItem.quantidade * precoUnit;
      } else {
        conv.cart.push({
          id: matchedProduct.id,
          nome: matchedProduct.name,
          tamanho: matchedProduct.size || '5L',
          preco: precoUnit,
          quantidade: qtdDesejada,
          subtotal: qtdDesejada * precoUnit
        });
      }

      await this.saveConversation(conv);
      return {
        response: `Adicionado: *${qtdDesejada}× ${matchedProduct.name}* ao seu carrinho!\n\n${this._formatCartMessage(conv)}\n\nPara fechar a compra, digite *FECHAR PEDIDO* ou continue adicionando produtos!`,
        state: 'atendimento_ia'
      };
    }

    // Consulta de preço de produto específico
    if (matchedProduct) {
      const preco = this.getProductPrice(matchedProduct);
      const stockInfo = matchedProduct.stock !== null && matchedProduct.stock <= 0 ? '\n⚠️ _Produto esgotado no momento_' : '';
      return {
        response: `*${matchedProduct.name}* (${matchedProduct.size || '5L'})\nPreço: *${this.formatCurrency(preco)}*${stockInfo}\n\nPara adicionar ao carrinho, basta responder: _"Quero 1"_, ou a quantidade que desejar!`,
        state: 'atendimento_ia'
      };
    }

    // Fechar Pedido
    if (/\b(fechar pedido|finalizar pedido|fechar compra|concluir pedido|comprar tudo|finalizar)\b/.test(norm)) {
      if (!conv.cart || conv.cart.length === 0) {
        return {
          response: 'Seu carrinho está vazio! Escolha algum produto do catálogo antes de fechar o pedido.',
          state: 'atendimento_ia'
        };
      }

      if (!conv.customer_name) {
        conv.state = 'coletando_nome';
        await this.saveConversation(conv);
        return {
          response: 'Excelente! Vamos finalizar seu pedido.\n\nPor favor, digite seu *Nome Completo*:',
          state: 'coletando_nome'
        };
      } else {
        conv.state = 'coletando_recebimento';
        await this.saveConversation(conv);
        return {
          response: `Olá *${conv.customer_name}*! Como prefere receber seu pedido?\n1. *Retirada na loja*\n2. *Entrega* (frete a combinar)`,
          state: 'coletando_recebimento'
        };
      }
    }

    // Consulta contextual de IA caso habilitada e configurada
    if (this.aiService && this.aiService.enabled) {
      try {
        const aiResult = await this.aiService.completeChat([
          { role: 'user', content: text }
        ], { catalog });

        if (aiResult.success && aiResult.text) {
          return {
            response: aiResult.text,
            state: conv.state,
            aiGenerated: true
          };
        }
      } catch (err) {
        // Fallback silencioso para o comportamento determinístico
      }
    }

    // Fallback inteligente educado
    return {
      response: 'Não entendi perfeitamente sua mensagem. Você pode me dizer qual produto procura (ex.: _sabão_, _amaciante_, _desinfetante_), pedir o *catálogo*, ou digitar *MENU* para ver as opções disponíveis.',
      state: conv.state
    };
  }

  // Montagem da mensagem do carrinho atual
  _formatCartMessage(conv) {
    if (!conv.cart || conv.cart.length === 0) {
      return '🛒 Seu carrinho está vazio.';
    }
    let total = 0;
    let msg = '🛒 *Seu Carrinho de Compras:*\n';
    for (const it of conv.cart) {
      total += it.subtotal;
      msg += `• ${it.quantidade}× *${it.nome}* (${it.tamanho || '5L'}) — ${this.formatCurrency(it.subtotal)}\n`;
    }
    msg += `\n*Subtotal: ${this.formatCurrency(total)}*`;
    return msg;
  }

  // Resumo para confirmação prévia do pedido
  _buildOrderConfirmationSummary(conv) {
    let total = 0;
    let msg = '📋 *Por favor, confira o resumo do seu pedido antes de confirmar:*\n\n';
    msg += `👤 *Cliente:* ${conv.customer_name}\n`;
    msg += `📱 *Telefone:* ${conv.phone}\n`;
    msg += `📦 *Forma de Recebimento:* ${conv.fulfillment}\n`;
    if (conv.customer_address) {
      msg += `📍 *Endereço de Entrega:* ${conv.customer_address}\n`;
    }
    msg += '\n*Itens do Pedido:*\n';
    for (const it of conv.cart) {
      total += it.subtotal;
      msg += `• ${it.quantidade}× ${it.nome} (${it.tamanho || '5L'}) — ${this.formatCurrency(it.subtotal)}\n`;
    }
    msg += `\n*VALOR TOTAL: ${this.formatCurrency(total)}*\n\n`;
    msg += 'Para registrar seu pedido com a BOX74, responda *SIM*.\nPara cancelar ou alterar, responda *NÃO*.';
    return msg;
  }

  // 8. Persistência de pedido confirmado no Supabase
  async _persistConfirmedOrder(conv) {
    const orderId = `ped-zap-${Date.now()}`;
    const total = conv.cart.reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
    const orderItems = conv.cart.map(it => ({
      id: it.id,
      nome: it.nome,
      tamanho: it.tamanho || '',
      preco: it.preco,
      quantidade: it.quantidade,
      subtotal: it.subtotal
    }));

    const orderRow = {
      id: orderId,
      customer_name: conv.customer_name,
      customer_phone: conv.phone,
      fulfillment: conv.fulfillment,
      customer_address: conv.customer_address || null,
      items: orderItems,
      total: total,
      status: 'Recebido'
    };

    if (this.customClient) {
      const { error } = await this.customClient.from('box74_orders').insert(orderRow);
      if (error) console.warn('Aviso ao registrar pedido via client:', error.message);
    } else {
      try {
        const res = await this._supabaseRequest('/rest/v1/box74_orders', 'POST', orderRow, { prefer: 'return=minimal' });
        if (res.statusCode >= 300) {
          console.warn('Aviso status inserção de pedido:', res.statusCode, res.data);
        }
      } catch (err) {
        console.warn('Erro ao persistir pedido:', err.message);
      }
    }

    return orderRow;
  }
}

module.exports = { WhatsAppAgent, DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY, PIX_KEY, PIX_OWNER };
