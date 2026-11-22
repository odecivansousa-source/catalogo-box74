// =====================================================================
// BOX74 - Adaptador Opcional Evolution API (v1 / v2)
// Gateway auto-hospedado para WhatsApp Baileys
// =====================================================================

const https = require('https');
const http = require('http');

class EvolutionApiAdapter {
  constructor(options = {}) {
    this.apiUrl = (options.apiUrl || '').replace(/\/$/, '');
    this.apiKey = options.apiKey || '';
    this.instance = options.instance || 'box74';
    this.mockTransport = options.mockTransport || null;
  }

  // Extrai mensagem recebida da Evolution API
  parseIncoming(payload) {
    try {
      const data = payload?.data || payload;
      const key = data?.key || {};
      const message = data?.message || {};

      // Ignora mensagens enviadas pelo próprio bot (fromMe = true)
      if (key.fromMe) return null;

      const remoteJid = key.remoteJid || '';
      if (!remoteJid || remoteJid.includes('@g.us')) {
        // Ignora grupos ou remetentes inválidos
        return null;
      }

      const from = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
      const messageId = key.id || `evo-${Date.now()}`;

      let text = '';
      if (message.conversation) {
        text = message.conversation;
      } else if (message.extendedTextMessage?.text) {
        text = message.extendedTextMessage.text;
      } else if (message.buttonsResponseMessage?.selectedButtonId) {
        text = message.buttonsResponseMessage.selectedButtonId;
      } else if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
        text = message.listResponseMessage.singleSelectReply.selectedRowId;
      }

      if (!text && data.text) {
        text = typeof data.text === 'string' ? data.text : data.text.message || '';
      }

      const senderName = data.pushName || '';

      return {
        isStatus: false,
        messageId,
        from,
        text,
        senderName,
        timestamp: Date.now(),
        type: 'text',
        raw: payload
      };
    } catch (err) {
      console.error('[BOX74 EvolutionAdapter] Erro no parsing:', err);
      return null;
    }
  }

  // Envia mensagem via Evolution API
  async sendMessage(to, text) {
    if (this.mockTransport) {
      return this.mockTransport.sendMessage(to, text);
    }

    if (!this.apiUrl || !this.apiKey) {
      return { success: false, error: 'EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurados' };
    }

    const cleanTo = to.replace(/\D/g, '');
    const url = `${this.apiUrl}/message/sendText/${this.instance}`;
    const payload = JSON.stringify({
      number: cleanTo,
      text: text
    });

    return new Promise((resolve) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request(url, {
        method: 'POST',
        headers: {
          'apikey': this.apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            const success = res.statusCode >= 200 && res.statusCode < 300;
            resolve({ success, messageId: parsed.key?.id, data: parsed });
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

module.exports = { EvolutionApiAdapter };
