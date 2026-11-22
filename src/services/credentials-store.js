// =====================================================================
// BOX74 - Armazenamento Seguro de Credenciais Meta WhatsApp
// Persistência estrita com credenciais administrativas de servidor (serviceRoleKey),
// proibição de fallback para anonKey, validação de erros e segregação de estados
// =====================================================================

const https = require('https');
const { config } = require('../config');

class CredentialsStore {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || config.supabase?.url;
    // Exclusivamente serviceRoleKey para persistência no backend. NUNCA fallback para anonKey!
    this.serviceRoleKey = options.supabaseKey || config.supabase?.serviceRoleKey || null;
    this.customClient = options.supabaseClient || null;
    this.inMemoryStore = new Map();
  }

  // Requisição auxiliar ao Supabase REST API (usa estritamente serviceRoleKey)
  async _supabaseRequest(endpoint, method = 'GET', body = null, headers = {}) {
    if (this.customClient) return null;
    if (!this.serviceRoleKey) {
      throw new Error('Falha de segurança: Operação em box74_meta_credentials exige SUPABASE_SERVICE_ROLE_KEY configurada. Fallback para anon é estritamente proibido.');
    }

    return new Promise((resolve, reject) => {
      const url = `${this.supabaseUrl}${endpoint}`;
      const reqHeaders = {
        'apikey': this.serviceRoleKey,
        'Authorization': `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/json',
        ...headers
      };

      const req = https.request(url, { method, headers: reqHeaders }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed = null;
          try { if (data) parsed = JSON.parse(data); } catch (e) { parsed = data; }
          resolve({ statusCode: res.statusCode, data: parsed });
        });
      });

      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }

  // Salva ou atualiza as credenciais da Meta com validação de erro estrita
  async saveCredentials({ accessToken, wabaId, phoneNumberId, phoneNumber, status, coexistenceStatus, coexistenceEnabled, metadata = {} }) {
    if (!this.customClient && !this.serviceRoleKey) {
      throw new Error('Falha de segurança: Operação de gravação de credenciais Meta exige SUPABASE_SERVICE_ROLE_KEY configurada no backend. Chave anonKey não é permitida.');
    }

    const existing = this.inMemoryStore.get('active_whatsapp_integration') || {};

    const record = {
      id: 'active_whatsapp_integration',
      phone_number: (phoneNumber || config.officialPhone.number).replace(/\D/g, ''),
      phone_number_display: config.officialPhone.display,
      phone_number_id: phoneNumberId || existing.phone_number_id || '',
      waba_id: wabaId || existing.waba_id || '',
      access_token: accessToken || existing.access_token || '', // Armazenamento seguro de servidor
      status: status || 'autorizado', // 'preparado', 'autorizado', 'ativo'
      coexistence_status: coexistenceStatus || (status === 'ativo' ? 'ativo' : 'preparado'),
      coexistence_enabled: coexistenceEnabled !== undefined ? coexistenceEnabled : true,
      updated_at: new Date().toISOString(),
      metadata: metadata || {}
    };

    if (this.customClient) {
      const { data, error } = await this.customClient
        .from('box74_meta_credentials')
        .upsert(record, { onConflict: 'id' });

      if (error) {
        console.error('[BOX74 CredentialsStore] Erro ao salvar no Supabase:', error.message);
        throw new Error(`Falha ao persistir credenciais Meta no Supabase: ${error.message}`);
      }
      this.inMemoryStore.set(record.id, record);
      return record;
    }

    try {
      const res = await this._supabaseRequest(
        '/rest/v1/box74_meta_credentials',
        'POST',
        record,
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
      );

      if (res && res.statusCode >= 300) {
        const errorDetail = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);
        console.error(`[BOX74 CredentialsStore] Falha HTTP ${res.statusCode} no Supabase:`, errorDetail);
        throw new Error(`Falha ao persistir credenciais Meta no Supabase (HTTP ${res.statusCode}): ${errorDetail}`);
      }
    } catch (err) {
      console.error('[BOX74 CredentialsStore] Erro de rede ou autorização:', err.message);
      throw err;
    }

    this.inMemoryStore.set(record.id, record);
    return record;
  }

  // Obtém as credenciais ativas completas (para uso interno exclusivo do backend)
  async getCredentials() {
    let creds = null;

    if (this.customClient) {
      const { data, error } = await this.customClient
        .from('box74_meta_credentials')
        .select('*')
        .eq('id', 'active_whatsapp_integration')
        .single();

      if (error) {
        // Erro legítimo de ausência de linha inicial (PGRST116)
        if (error.code === 'PGRST116' || error.message?.includes('0 rows') || error.message?.includes('JSON object requested, multiple (or no) rows returned')) {
          creds = null;
        } else {
          console.error('[BOX74 CredentialsStore] Erro ao consultar credenciais no Supabase:', error.message);
          throw new Error(`Falha ao consultar credenciais Meta no Supabase: ${error.message}`);
        }
      } else if (data) {
        creds = data;
        this.inMemoryStore.set(creds.id, creds);
      }
    } else if (this.serviceRoleKey) {
      try {
        const res = await this._supabaseRequest(
          '/rest/v1/box74_meta_credentials?id=eq.active_whatsapp_integration&select=*',
          'GET'
        );
        if (res && res.statusCode >= 300) {
          const errorDetail = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);
          console.error(`[BOX74 CredentialsStore] Erro HTTP ${res.statusCode} ao consultar Supabase:`, errorDetail);
          throw new Error(`Falha ao consultar credenciais Meta no Supabase (HTTP ${res.statusCode}): ${errorDetail}`);
        }
        if (res && res.statusCode === 200 && Array.isArray(res.data) && res.data.length > 0) {
          creds = res.data[0];
          this.inMemoryStore.set(creds.id, creds);
        }
      } catch (err) {
        console.error('[BOX74 CredentialsStore] Falha na leitura de credenciais:', err.message);
        throw err;
      }
    }

    // Se ainda não existir registro persistido no banco, inicializa com o estado 'preparado'
    if (!creds) {
      creds = {
        id: 'active_whatsapp_integration',
        phone_number: config.officialPhone.number,
        phone_number_display: config.officialPhone.display,
        phone_number_id: config.meta.phoneNumberId,
        waba_id: config.meta.wabaId,
        access_token: config.meta.token || '',
        status: config.meta.token && config.meta.phoneNumberId ? 'autorizado' : 'preparado',
        coexistence_status: 'preparado',
        coexistence_enabled: config.meta.coexistenceEnabled,
        updated_at: new Date().toISOString()
      };
    }

    return creds;
  }

  // Retorna resumo público seguro (NUNCA expõe access_token ou segredos)
  async getPublicStatus() {
    const creds = await this.getCredentials();
    return {
      officialPhoneNumber: config.officialPhone.display,
      phoneNumberRaw: config.officialPhone.number,
      configured: Boolean(creds.phone_number_id && creds.waba_id && (creds.access_token || config.meta.token)),
      phoneNumberId: creds.phone_number_id || null,
      wabaId: creds.waba_id || null,
      status: creds.status || 'preparado', // 'preparado', 'autorizado', 'ativo'
      coexistenceStatus: creds.coexistence_status || 'preparado', // 'preparado', 'autorizado', 'ativo'
      coexistenceEnabled: Boolean(creds.coexistence_enabled),
      lastUpdated: creds.updated_at || null
    };
  }
}

module.exports = { CredentialsStore };
