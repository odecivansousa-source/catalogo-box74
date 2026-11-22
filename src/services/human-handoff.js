// =====================================================================
// BOX74 - Gerenciador do Fluxo de Atendimento Humano
// Gerencia transbordo, silenciamento da IA e alertas para o administrador
// =====================================================================

const { config } = require('../config');

class HumanHandoffService {
  constructor(options = {}) {
    const handoffConfig = { ...config.humanSupport, ...options };
    this.adminPhone = handoffConfig.adminPhone || '';
    this.alertOnHandoff = handoffConfig.alertOnHandoff;
    this.silencedClients = new Map(); // phone -> { transferredAt, reason, clientInfo }
    this.adapter = options.adapter || null;
  }

  setAdapter(adapter) {
    this.adapter = adapter;
  }

  // Verifica se o cliente está sob atendimento humano (IA pausada)
  isSilenced(phone) {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    return this.silencedClients.has(cleanPhone);
  }

  // Marca início do transbordo humano e alerta o responsável da BOX74
  async triggerHandoff(phone, details = {}) {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const handoffRecord = {
      transferredAt: new Date().toISOString(),
      reason: details.reason || 'Solicitação direta do cliente',
      customerName: details.customerName || 'Cliente BOX74',
      lastMessage: details.lastMessage || '',
      cartSummary: details.cartSummary || 'Nenhum item no carrinho'
    };

    this.silencedClients.set(cleanPhone, handoffRecord);

    // Enviar alerta ao responsável se houver número configurado
    if (this.alertOnHandoff && this.adminPhone && this.adapter) {
      const alertText = `🚨 *BOX74 - ALERTA DE ATENDIMENTO HUMANO*\n\n` +
        `👤 *Cliente:* ${handoffRecord.customerName}\n` +
        `📱 *WhatsApp:* +${cleanPhone}\n` +
        `💬 *Motivo/Mensagem:* ${handoffRecord.lastMessage || handoffRecord.reason}\n` +
        `🛒 *Carrinho:* ${handoffRecord.cartSummary}\n\n` +
        `👉 Para assumir, inicie a conversa diretamente com o cliente pelo número acima.`;

      try {
        await this.adapter.sendMessage(this.adminPhone, alertText);
        console.log(`[BOX74 Handoff] Alerta enviado ao administrador (${this.adminPhone})`);
      } catch (err) {
        console.error('[BOX74 Handoff] Falha ao enviar alerta para o administrador:', err.message);
      }
    }

    return {
      success: true,
      silenced: true,
      message: 'Você foi transferido para um atendente da equipe BOX74. Em breve um responsável entrará em contato aqui pelo WhatsApp!\n\n*(Caso queira voltar para o atendimento automático, digite MENU)*'
    };
  }

  // Reativa o atendimento automático da IA
  resumeBot(phone) {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const wasSilenced = this.silencedClients.has(cleanPhone);
    this.silencedClients.delete(cleanPhone);
    return { wasSilenced, active: true };
  }

  // Retorna status dos clientes sob atendimento humano
  getActiveHandoffs() {
    return Array.from(this.silencedClients.entries()).map(([phone, info]) => ({
      phone,
      ...info
    }));
  }
}

module.exports = { HumanHandoffService };
