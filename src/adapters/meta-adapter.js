// =====================================================================
// BOX74 - Adaptador Oficial Meta WhatsApp Cloud API
// Envio, recebimento e marcação de mensagens via Graph API oficial
// =====================================================================

const https = require('https');
const crypto = require('crypto');

class MetaWhatsAppAdapter {
  constructor(options = {}) {
    this.token = options.token || '';
    this.phoneNumberId = options.phoneNumberId || '';
    this.appSecret = options.appSecret || '';
    this.apiVersion = options.apiVersion || 'v21.0';
    this.mockTransport = options.mockTransport || null; // Para testes unitários
  }

  // Validação criptográfica de assinatura X-Hub-Signature-256 enviada pela Meta
  verifySignature(rawBody, signatureHeader) {
    if (!this.appSecret) {
      // Se não houver segredo configurado (ambiente local/desenvolvimento), aceita com aviso
      return { valid: true, warning: 'META_WA_APP_SECRET não configurado' };
    }

    if (!signatureHeader) {
      return { valid: false, error: 'Cabeçalho X-Hub-Signature-256 ausente' };
    }

    const [scheme, signature] = signatureHeader.split('=');
    if (scheme !== 'sha256' || !signature) {
      return { valid: false, error: 'Formato de assinatura inválido. Esperado sha256=<hash>' };
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.appSecret)
      .update(rawBody, typeof rawBody === 'string' ? 'utf8' : undefined)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: 'Comprimento de assinatura divergente' };
    }

    const matches = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    return { valid: matches, error: matches ? null : 'Assinatura inválida (HMAC diverge)' };
  }

  // Extrai mensagem recebida do webhook da Meta Cloud API
  parseIncoming(payload) {
    try {
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value || !value.messages || !value.messages[0]) {
        // Suporte a formato direto / simplificado (testes e integrações diretas)
        if (payload?.from && (payload?.text || payload?.message)) {
          return {
            isStatus: false,
            messageId: payload.messageId || payload.id || `msg-${Date.now()}`,
            from: String(payload.from).replace(/\D/g, ''),
            text: typeof payload.text === 'string' ? payload.text : (payload.text?.body || payload.message || ''),
            senderName: payload.senderName || '',
            timestamp: Date.now(),
            type: 'text',
            raw: payload
          };
        }

        // Pode ser atualização de status (sent, delivered, read)
        if (value?.statuses && value.statuses[0]) {
          const status = value.statuses[0];
          return {
            isStatus: true,
            status: status.status,
            messageId: status.id,
            recipientId: status.recipient_id
          };
        }
        return null;
      }

      const metaMsg = value.messages[0];
      const contact = value.contacts?.[0] || {};
      const profileName = contact.profile?.name || '';

      let text = '';
      if (metaMsg.type === 'text') {
        text = metaMsg.text?.body || '';
      } else if (metaMsg.type === 'interactive') {
        text = metaMsg.interactive?.button_reply?.title || metaMsg.interactive?.list_reply?.title || '';
      } else if (metaMsg.type === 'button') {
        text = metaMsg.button?.text || '';
      } else {
        text = `[Mídia não suportada: ${metaMsg.type}]`;
      }

      return {
        isStatus: false,
        messageId: metaMsg.id,
        from: metaMsg.from,
        text,
        senderName: profileName,
        timestamp: metaMsg.timestamp ? parseInt(metaMsg.timestamp, 10) * 1000 : Date.now(),
        type: metaMsg.type,
        raw: metaMsg
      };
    } catch (err) {
      console.error('[BOX74 MetaAdapter] Erro no parsing:', err);
      return null;
    }
  }

  // Envia mensagem de texto via Graph API da Meta
  async sendMessage(to, text, options = {}) {
    if (this.mockTransport) {
      return this.mockTransport.sendMessage(to, text, options);
    }

    if (!this.token || !this.phoneNumberId) {
      console.warn('[BOX74 MetaAdapter] Credenciais Meta não configuradas. Mensagem em modo log.');
      return {
        success: false,
        error: 'META_WA_TOKEN ou META_WA_PHONE_NUMBER_ID não configurados',
        preview: { to, text }
      };
    }

    const cleanTo = to.replace(/\D/g, '');
    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'text',
      text: {
        preview_url: options.previewUrl || false,
        body: text
      }
    });

    return new Promise((resolve) => {
      const path = `/${this.apiVersion}/${this.phoneNumberId}/messages`;
      const req = https.request({
        hostname: 'graph.facebook.com',
        port: 443,
        path,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const messageId = parsed.messages?.[0]?.id;
              resolve({ success: true, messageId, data: parsed });
            } else {
              console.error('[BOX74 MetaAdapter] Erro da Meta API:', parsed);
              resolve({ success: false, statusCode: res.statusCode, error: parsed.error?.message || 'Erro na Meta API', data: parsed });
            }
          } catch (e) {
            resolve({ success: false, statusCode: res.statusCode, error: data });
          }
        });
      });

      req.on('error', (err) => {
        console.error('[BOX74 MetaAdapter] Erro na requisição HTTP:', err.message);
        resolve({ success: false, error: err.message });
      });

      req.write(payload);
      req.end();
    });
  }

  // Marca mensagem como lida
  async markAsRead(messageId) {
    if (this.mockTransport) {
      return this.mockTransport.markAsRead(messageId);
    }

    if (!this.token || !this.phoneNumberId || !messageId) {
      return { success: false, error: 'Credenciais ou messageId ausentes' };
    }

    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'graph.facebook.com',
        port: 443,
        path: `/${this.apiVersion}/${this.phoneNumberId}/messages`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({ success: res.statusCode >= 200 && res.statusCode < 300 });
        });
      });

      req.on('error', () => resolve({ success: false }));
      req.write(payload);
      req.end();
    });
  }
}

module.exports = { MetaWhatsAppAdapter };
