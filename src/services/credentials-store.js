// =====================================================================
// BOX74 - Armazenamento Seguro de Credenciais Meta WhatsApp
// Persistência de WABA ID, Phone Number ID e estado de Coexistência
// =====================================================================

const https = require('https');
const { config } = require('../config');

class CredentialsStore {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || config.supabase.url;
    this.supabaseKey = options.supabaseKey || config.supabase.anonKey;
    this.customClient = options.supabaseClient || null;
    this.inMemoryStore = new Map();
  }

  // Requisição auxiliar ao Supabase REST API
  async _supabaseRequest(endpoint, method = 'GET', body = null, headers = {}) {
    if (this.customClient) return null;
    return new Promise((resolve, reject) => {
      const url = `${this.supabaseUrl}${endpoint}`;
      const reqHeaders = {
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
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

  // Salva ou atualiza as credenciais da Meta com segurança
  async saveCredentials({ wabaId, phoneNumberId, phoneNumber, status, coexistenceEnabled, metadata = {} }) {
    const record = {
      id: 'active_whatsapp_integration',
      phone_number: (phoneNumber || config.officialPhone.number).replace(/\D/g, ''),
      phone_number_display: config.officialPhone.display,
      phone_number_id: phoneNumberId || '',
      waba_id: wabaId || '',
      status: status || 'configured', // 'pending_verification', 'configured', 'coexistence_active'
      coexistence_enabled: coexistenceEnabled !== undefined ? coexistenceEnabled : true,
      updated_at: new Date().toISOString(),
      metadata: metadata || {}
    };

    // Sempre mantém em memória como cache imediato
    this.inMemoryStore.set(record.id, record);

    if (this.customClient) {
      try {
        await this.customClient
          .from('box74_meta_credentials')
          .upsert(record, { onConflict: 'id' });
      } catch (err) {
        // Fallback in-memory
      }
      return record;
    }

    try {
      await this._supabaseRequest(
        '/rest/v1/box74_meta_credentials',
        'POST',
        record,
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
      );
    } catch (e) {
      // Fallback em memória já garantido
    }

    return record;
  }

  // Obtém as credenciais ativas
  async getCredentials() {
    let creds = null;

    if (this.customClient) {
      try {
        const { data } = await this.customClient
          .from('box74_meta_credentials')
          .select('*')
          .eq('id', 'active_whatsapp_integration')
          .single();
        if (data) creds = data;
      } catch (e) {
        // Fallback
      }
    }

    if (!creds) {
      try {
        const res = await this._supabaseRequest(
          '/rest/v1/box74_meta_credentials?id=eq.active_whatsapp_integration&select=*',
          'GET'
        );
        if (res.statusCode === 200 && Array.isArray(res.data) && res.data.length > 0) {
          creds = res.data[0];
        }
      } catch (e) {
        // Fallback
      }
    }

    if (!creds && this.inMemoryStore.has('active_whatsapp_integration')) {
      creds = this.inMemoryStore.get('active_whatsapp_integration');
    }

    // Se ainda não existir no banco, usa as variáveis de ambiente atuais
    if (!creds) {
      creds = {
        id: 'active_whatsapp_integration',
        phone_number: config.officialPhone.number,
        phone_number_display: config.officialPhone.display,
        phone_number_id: config.meta.phoneNumberId,
        waba_id: config.meta.wabaId,
        status: config.meta.token && config.meta.phoneNumberId ? 'configured' : 'pending_configuration',
        coexistence_enabled: config.meta.coexistenceEnabled,
        updated_at: new Date().toISOString()
      };
    }

    return creds;
  }

  // Retorna resumo público seguro sem segredos ou tokens
  async getPublicStatus() {
    const creds = await this.getCredentials();
    return {
      officialPhoneNumber: config.officialPhone.display,
      phoneNumberRaw: config.officialPhone.number,
      configured: Boolean(creds.phone_number_id && creds.waba_id),
      phoneNumberId: creds.phone_number_id || null,
      wabaId: creds.waba_id || null,
      status: creds.status || 'pending_configuration',
      coexistenceEnabled: Boolean(creds.coexistence_enabled),
      lastUpdated: creds.updated_at || null
    };
  }
}

module.exports = { CredentialsStore };
