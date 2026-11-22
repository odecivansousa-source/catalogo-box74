// =====================================================================
// BOX74 - Adaptador Opcional Z-API
// Gateway em nuvem para WhatsApp
// =====================================================================

const https = require('https');

class ZApiAdapter {
  constructor(options = {}) {
    this.instanceId = options.instanceId || '';
    this.token = options.token || '';
    this.clientToken = options.clientToken || '';
    this.mockTransport = options.mockTransport || null;
  }

  // Extrai mensagem recebida do webhook da Z-API
  parseIncoming(payload) {
    try {
      if (payload?.fromMe) return null;
      if (payload?.isGroup) return null;

      const from = (payload?.phone || payload?.senderPhone || '').replace(/\D/g, '');
      if (!from) return null;

      const messageId = payload?.messageId || payload?.id || `zapi-${Date.now()}`;
      let text = '';

      if (typeof payload?.text === 'string') {
        text = payload.text;
      } else if (payload?.text?.message) {
        text = payload.text.message;
      } else if (payload?.body) {
        text = payload.body;
      }

      return {
        isStatus: false,
        messageId,
        from,
        text,
        senderName: payload?.senderName || '',
        timestamp: Date.now(),
        type: 'text',
        raw: payload
      };
    } catch (err) {
      console.error('[BOX74 ZApiAdapter] Erro no parsing:', err);
      return null;
    }
  }

  // Envia mensagem via Z-API
  async sendMessage(to, text) {
    if (this.mockTransport) {
      return this.mockTransport.sendMessage(to, text);
    }

    if (!this.instanceId || !this.token) {
      return { success: false, error: 'ZAPI_INSTANCE_ID ou ZAPI_TOKEN não configurados' };
    }

    const cleanTo = to.replace(/\D/g, '');
    const url = `https://api.z-api.io/instances/${this.instanceId}/token/${this.token}/send-text`;
    const payload = JSON.stringify({
      phone: cleanTo,
      message: text
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    };
    if (this.clientToken) {
      headers['Client-Token'] = this.clientToken;
    }

    return new Promise((resolve) => {
      const req = https.request(url, {
        method: 'POST',
        headers
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            const success = res.statusCode >= 200 && res.statusCode < 300;
            resolve({ success, messageId: parsed.messageId || parsed.id, data: parsed });
          } catch (e) {
            resolve({ success: false, error: data });
          }
        });
      });

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.write(payload);
      req.end();
    });
  }

  async markAsRead() {
    return { success: true };
  }
}

module.exports = { ZApiAdapter };
