// =====================================================================
// BOX74 - Serviço de IA Contextual (OpenAI / Groq / OpenRouter / Compatíveis)
// Compreensão semântica avançada com resiliência e fallback automático
// =====================================================================

const https = require('https');
const { config } = require('../config');

class AIService {
  constructor(options = {}) {
    const aiConfig = { ...config.ai, ...options };
    this.enabled = aiConfig.enabled;
    this.provider = aiConfig.provider || 'openai';
    this.apiKey = aiConfig.apiKey || '';
    this.model = aiConfig.model || 'gpt-4o-mini';
    this.baseURL = aiConfig.baseURL || this._resolveBaseURL(this.provider);
    this.mockHandler = options.mockHandler || null; // Para testes unitários
  }

  _resolveBaseURL(provider) {
    switch (provider) {
      case 'groq':
        return 'api.groq.com';
      case 'openrouter':
        return 'openrouter.ai';
      case 'openai':
      default:
        return 'api.openai.com';
    }
  }

  // Gera o System Prompt enriquecido com o catálogo oficial da BOX74
  buildSystemPrompt(catalog = []) {
    const catalogSummary = catalog.length > 0
      ? catalog.map(p => `- ${p.name}: R$ ${Number(p.price).toFixed(2)} (Estoque: ${p.stock ?? 'disponível'})`).join('\n')
      : 'Catálogo oficial BOX74 com 33 produtos de limpeza (Clarilux, Lavalu, Lava+).';

    return `Você é o Vendedor Oficial da BOX74, loja especializada em produtos de limpeza automotiva, doméstica e profissional.
Sua missão é atender clientes pelo WhatsApp com cordialidade, precisão e foco em vendas.

REGRAS COMERCIAIS RÍGIDAS:
1. NUNCA invente produtos, tamanhos, preços ou promoções que não constem no catálogo oficial.
2. NUNCA conceda descontos arbitrários nem prometa frete grátis sem confirmação oficial.
3. Se o cliente solicitar produtos que não temos, informe com educação que não consta no catálogo no momento.
4. Quando o cliente pedir para falar com um humano, transfira educadamente.
5. Seja conciso e direto, ideal para mensagens de WhatsApp.

CATÁLOGO OFICIAL DISPONÍVEL:
${catalogSummary}

Chave Pix oficial para pagamentos: 5fbf536f-8dea-4ff2-9546-7f4e0e487e3d (Adriana Maria de Lima Almeida).`;
  }

  // Consulta contextual ao modelo de linguagem
  async completeChat(messages, options = {}) {
    if (this.mockHandler) {
      return this.mockHandler(messages, options);
    }

    if (!this.enabled || !this.apiKey) {
      return { success: false, fallback: true, reason: 'AI_API_KEY não configurada ou IA desativada' };
    }

    const systemPrompt = options.systemPrompt || this.buildSystemPrompt(options.catalog || []);
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const payload = JSON.stringify({
      model: this.model,
      messages: fullMessages,
      temperature: options.temperature || 0.4,
      max_tokens: options.maxTokens || 350
    });

    const path = this.provider === 'openrouter' ? '/api/v1/chat/completions' : '/v1/chat/completions';

    return new Promise((resolve) => {
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      };

      if (this.provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://box74.com.br';
        headers['X-Title'] = 'BOX74 WhatsApp Agent';
      }

      const req = https.request({
        hostname: this.baseURL,
        port: 443,
        path,
        method: 'POST',
        headers
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const text = parsed.choices?.[0]?.message?.content || '';
              resolve({ success: true, text, raw: parsed });
            } else {
              console.warn(`[BOX74 AIService] Erro HTTP ${res.statusCode}:`, parsed.error?.message || data);
              resolve({ success: false, fallback: true, error: parsed.error?.message });
            }
          } catch (e) {
            resolve({ success: false, fallback: true, error: data });
          }
        });
      });

      req.on('error', (err) => {
        console.warn('[BOX74 AIService] Falha na conexão com provedor de IA:', err.message);
        resolve({ success: false, fallback: true, error: err.message });
      });

      // Timeout seguro de 6 segundos para não travar a resposta do WhatsApp
      req.setTimeout(6000, () => {
        req.destroy();
        resolve({ success: false, fallback: true, error: 'Timeout de resposta da IA' });
      });

      req.write(payload);
      req.end();
    });
  }
}

module.exports = { AIService };
