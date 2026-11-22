// =====================================================================
// BOX74 - Fábrica de Adaptadores de Mensageria WhatsApp
// Cria o adaptador apropriado com base no provedor configurado
// =====================================================================

const { MetaWhatsAppAdapter } = require('./meta-adapter');
const { EvolutionApiAdapter } = require('./evolution-adapter');
const { ZApiAdapter } = require('./zapi-adapter');
const { config } = require('../config');

function createWhatsAppAdapter(customConfig = {}) {
  const cfg = { ...config, ...customConfig };
  const provider = (cfg.waProvider || 'meta').toLowerCase();

  switch (provider) {
    case 'evolution':
      return new EvolutionApiAdapter({
        apiUrl: cfg.evolution?.apiUrl,
        apiKey: cfg.evolution?.apiKey,
        instance: cfg.evolution?.instance,
        mockTransport: customConfig.mockTransport
      });

    case 'zapi':
      return new ZApiAdapter({
        instanceId: cfg.zapi?.instanceId,
        token: cfg.zapi?.token,
        clientToken: cfg.zapi?.clientToken,
        mockTransport: customConfig.mockTransport
      });

    case 'meta':
    default:
      return new MetaWhatsAppAdapter({
        token: cfg.meta?.token,
        phoneNumberId: cfg.meta?.phoneNumberId,
        appSecret: cfg.meta?.appSecret,
        apiVersion: cfg.meta?.apiVersion,
        mockTransport: customConfig.mockTransport
      });
  }
}

module.exports = {
  createWhatsAppAdapter,
  MetaWhatsAppAdapter,
  EvolutionApiAdapter,
  ZApiAdapter
};
