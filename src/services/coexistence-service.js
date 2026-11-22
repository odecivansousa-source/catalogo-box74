// =====================================================================
// BOX74 - Serviço de Coexistência com WhatsApp Business App
// Permite uso simultâneo do App no celular e do Agente IA na Cloud API
// Detecta intervenções humanas via message_echoes e pausa a IA automaticamente
// =====================================================================

const { config } = require('../config');

class CoexistenceService {
  constructor(options = {}) {
    this.officialNumber = (options.officialNumber || config.officialPhone.number).replace(/\D/g, '');
    this.humanHandoff = options.humanHandoff || null;
    this.enabled = options.enabled !== undefined ? options.enabled : config.meta.coexistenceEnabled;
    this.recentHumanInterventions = new Map(); // customerPhone -> timestamp
    this.silenceWindowMs = options.silenceWindowMs || 24 * 60 * 60 * 1000; // 24 horas de silenciamento após resposta humana
  }

  setHumanHandoffService(humanHandoff) {
    this.humanHandoff = humanHandoff;
  }

  // Verifica se o evento recebido é um eco de mensagem humana enviada pelo app do celular
  isHumanEcho(event) {
    if (!this.enabled || !event) return false;

    // Se o evento for marcado explicitamente como isEcho
    if (event.isEcho === true) return true;

    // Se o remetente for o próprio número oficial da BOX74
    const cleanFrom = (event.from || '').replace(/\D/g, '');
    if (cleanFrom === this.officialNumber && event.to) {
      return true;
    }

    return false;
  }

  // Processa a intervenção humana disparada pelo WhatsApp Business App no smartphone
  async handleHumanIntervention(echoEvent, agent) {
    const customerPhone = (echoEvent.to || echoEvent.recipientId || '').replace(/\D/g, '');
    if (!customerPhone) return { ignored: true, reason: 'destinatario_indefinido' };

    const textSentByHuman = echoEvent.text || '[Mensagem enviada pelo celular]';
    this.recentHumanInterventions.set(customerPhone, Date.now());

    console.log(`[BOX74 Coexistência] Mensagem humana detectada no celular para +${customerPhone}. Pausando IA.`);

    // 1. Marca no serviço de atendimento humano
    if (this.humanHandoff && typeof this.humanHandoff.triggerHandoff === 'function') {
      await this.humanHandoff.triggerHandoff(customerPhone, {
        reason: 'Intervenção manual direta via WhatsApp Business App',
        lastMessage: textSentByHuman
      });
    }

    // 2. Atualiza estado da conversa para transf_humano no agente e persiste no Supabase
    if (agent && typeof agent.getConversation === 'function' && typeof agent.saveConversation === 'function') {
      const conv = await agent.getConversation(customerPhone);
      if (conv) {
        conv.state = 'transf_humano';
        conv.last_human_intervention_at = new Date().toISOString();
        await agent.saveConversation(conv);
      }
    }

    // 3. Registra mensagem enviada pelo humano no histórico do Supabase
    if (agent && typeof agent.recordOutgoingMessage === 'function') {
      await agent.recordOutgoingMessage(
        echoEvent.messageId || `human-echo-${Date.now()}`,
        customerPhone,
        `[Atendente no Celular]: ${textSentByHuman}`
      );
    }

    return {
      handled: true,
      coexistence: true,
      customerPhone,
      action: 'bot_silenced'
    };
  }

  // Verifica se o cliente está sob janela de intervenção humana (com persistência durável no banco)
  async isCustomerUnderHumanWindow(customerPhone, agent = null) {
    const cleanPhone = (customerPhone || '').replace(/\D/g, '');
    if (!cleanPhone) return false;

    // 1. Verificação rápida em cache de memória
    if (this.recentHumanInterventions.has(cleanPhone)) {
      const timestamp = this.recentHumanInterventions.get(cleanPhone);
      const elapsed = Date.now() - timestamp;
      if (elapsed <= this.silenceWindowMs) {
        return true;
      }
      this.recentHumanInterventions.delete(cleanPhone);
    }

    // 2. Persistência durável no banco de dados (sobrevive ao reinício do servidor)
    if (agent && typeof agent.getConversation === 'function') {
      try {
        const conv = await agent.getConversation(cleanPhone);
        if (conv && conv.state === 'transf_humano') {
          // Restaura no cache de memória local
          this.recentHumanInterventions.set(cleanPhone, Date.now());
          return true;
        }
      } catch (err) {
        // Fallback silencioso
      }
    }

    return false;
  }

  // Limpa janela e reseta estado persistido para reativar bot quando cliente enviar "MENU"
  async clearHumanWindow(customerPhone, agent = null) {
    const cleanPhone = (customerPhone || '').replace(/\D/g, '');
    this.recentHumanInterventions.delete(cleanPhone);

    if (agent && typeof agent.getConversation === 'function' && typeof agent.saveConversation === 'function') {
      try {
        const conv = await agent.getConversation(cleanPhone);
        if (conv && conv.state === 'transf_humano') {
          conv.state = 'atendimento_ia';
          conv.last_human_intervention_at = null;
          await agent.saveConversation(conv);
        }
      } catch (err) {
        // Fallback
      }
    }
  }
}

module.exports = { CoexistenceService };
