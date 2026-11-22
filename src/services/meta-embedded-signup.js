// =====================================================================
// BOX74 - Serviço Meta Embedded Signup e Autorização OAuth
// Troca segura de código por token, validação estrita do número oficial
// e subscrição de webhooks com suporte a coexistência
// =====================================================================

const https = require('https');
const { config } = require('../config');

class MetaEmbeddedSignupService {
  constructor(options = {}) {
    this.appId = options.appId || config.meta.appId;
    this.appSecret = options.appSecret || config.meta.appSecret;
    this.apiVersion = options.apiVersion || config.meta.apiVersion || 'v22.0';
    this.officialNumber = (options.officialNumber || config.officialPhone.number).replace(/\D/g, '');
    this.credentialsStore = options.credentialsStore || null;
    this.mockTransport = options.mockTransport || null; // Para testes unitários
  }

  // Faz requisição HTTPS genérica para a Graph API da Meta
  async _graphRequest(path, method = 'GET', body = null, token = null) {
    if (this.mockTransport) {
      return this.mockTransport.graphRequest(path, method, body, token);
    }

    return new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const req = https.request({
        hostname: 'graph.facebook.com',
        port: 443,
        path: `/${this.apiVersion}${path}`,
        method,
        headers
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ statusCode: res.statusCode, data });
          }
        });
      });

      req.on('error', reject);
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  // 1. Troca o código de autorização OAuth por Token de Acesso do Usuário/Sistema
  async exchangeCodeForToken(code, redirectUri = '') {
    if (!code) {
      return { success: false, error: 'Código de autorização OAuth ausente.' };
    }

    const query = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      code,
      redirect_uri: redirectUri
    });

    const res = await this._graphRequest(`/oauth/access_token?${query.toString()}`, 'GET');
    if (res.statusCode >= 200 && res.statusCode < 300 && res.data.access_token) {
      return {
        success: true,
        accessToken: res.data.access_token,
        tokenType: res.data.token_type,
        expiresIn: res.data.expires_in
      };
    }

    return {
      success: false,
      error: res.data?.error?.message || 'Falha ao trocar código de autorização da Meta por token.',
      detail: res.data
    };
  }

  // 2. Consulta e validação estrita do número de telefone oficial (+55 84 98189-6369)
  async validatePhoneNumber(phoneNumberId, accessToken) {
    if (!phoneNumberId) {
      return { valid: false, error: 'Phone Number ID não informado.' };
    }

    const res = await this._graphRequest(
      `/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type`,
      'GET',
      null,
      accessToken
    );

    if (res.statusCode < 200 || res.statusCode >= 300) {
      return {
        valid: false,
        error: res.data?.error?.message || 'Falha ao consultar detalhes do número na Meta.',
        detail: res.data
      };
    }

    const remoteNumber = (res.data.display_phone_number || '').replace(/\D/g, '');

    // Regra Obrigatória: Garantir que o número seja exclusivamente +55 84 98189-6369
    if (remoteNumber !== this.officialNumber) {
      return {
        valid: false,
        error: `O número associado (${res.data.display_phone_number}) diverge do número oficial autorizado da BOX74 (${config.officialPhone.display}). Acesso recusado por segurança.`,
        providedNumber: remoteNumber,
        expectedNumber: this.officialNumber
      };
    }

    const isCoexistenceConfirmed = res.data.platform_type === 'CLOUD_API_COEXISTENCE';

    return {
      valid: true,
      phoneNumberId: res.data.id,
      displayPhoneNumber: res.data.display_phone_number,
      verifiedName: res.data.verified_name,
      qualityRating: res.data.quality_rating,
      platformType: res.data.platform_type || 'UNKNOWN',
      coexistenceConfirmed: isCoexistenceConfirmed,
      coexistenceStatus: isCoexistenceConfirmed ? 'ativo' : 'autorizado'
    };
  }

  // 3. Subscrição automática do WABA aos Webhooks da aplicação
  async subscribeWabaWebhooks(wabaId, accessToken) {
    if (!wabaId) {
      return { success: false, error: 'WABA ID não informado.' };
    }

    const res = await this._graphRequest(
      `/${wabaId}/subscribed_apps`,
      'POST',
      null,
      accessToken
    );

    const isSuccess = res.statusCode >= 200 && res.statusCode < 300 && (res.data.success === true || res.data.data);
    return {
      success: isSuccess,
      data: res.data,
      error: isSuccess ? null : (res.data?.error?.message || 'Erro ao subscrever Webhooks no WABA')
    };
  }

  // 4. Executa o fluxo completo do Embedded Signup de ponta a ponta
  async processEmbeddedSignup({ code, wabaId, phoneNumberId, redirectUri }) {
    console.log('[BOX74 EmbeddedSignup] Iniciando processamento do signup para o número oficial...');

    // 1. Troca código por token
    const tokenResult = await this.exchangeCodeForToken(code, redirectUri);
    if (!tokenResult.success) {
      return { success: false, step: 'oauth_exchange', error: tokenResult.error };
    }

    const accessToken = tokenResult.accessToken;

    // 2. Validação estrita do número
    const phoneValidation = await this.validatePhoneNumber(phoneNumberId, accessToken);
    if (!phoneValidation.valid) {
      return { success: false, step: 'phone_validation', error: phoneValidation.error };
    }

    // 3. Subscrição dos webhooks
    const subResult = await this.subscribeWabaWebhooks(wabaId, accessToken);
    if (!subResult.success) {
      console.warn('[BOX74 EmbeddedSignup] Aviso na subscrição de webhooks:', subResult.error);
    }

    // 4. Persistência segura das credenciais com o token no backend
    if (this.credentialsStore) {
      await this.credentialsStore.saveCredentials({
        wabaId,
        phoneNumberId,
        phoneNumber: this.officialNumber,
        accessToken, // Armazenado no backend de forma restrita
        status: 'autorizado',
        coexistenceStatus: phoneValidation.coexistenceStatus,
        coexistenceEnabled: true,
        metadata: {
          verifiedName: phoneValidation.verifiedName,
          qualityRating: phoneValidation.qualityRating,
          platformType: phoneValidation.platformType,
          subscribedWebhooks: subResult.success,
          authorizedAt: new Date().toISOString()
        }
      });
    }

    return {
      success: true,
      officialPhone: config.officialPhone.display,
      wabaId,
      phoneNumberId,
      verifiedName: phoneValidation.verifiedName,
      status: 'autorizado',
      coexistenceStatus: phoneValidation.coexistenceStatus,
      coexistenceActive: Boolean(phoneValidation.coexistenceConfirmed),
      message: 'Autorização Meta concluída com sucesso. Credenciais armazenadas com segurança.'
    };
  }
}

module.exports = { MetaEmbeddedSignupService };
