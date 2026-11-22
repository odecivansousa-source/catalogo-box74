// =====================================================================
// BOX74 - Configuração e Variáveis de Ambiente
// Carrega e valida variáveis de ambiente com suporte a arquivo .env nativo
// =====================================================================

const fs = require('fs');
const path = require('path');

// Parser nativo de arquivo .env (sem necessidade de dependências externas)
function loadEnvFile(envPath) {
  const targetPath = envPath || path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(targetPath)) return false;

  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    const lines = content.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.substring(0, eqIdx).trim();
        let val = line.substring(eqIdx + 1).trim();
        // Remove aspas se houver
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
    return true;
  } catch (err) {
    console.warn('[BOX74 Config] Aviso ao ler .env:', err.message);
    return false;
  }
}

// Carregar .env se existir
loadEnvFile();

const config = {
  // Servidor e Ambiente
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL || 'https://owzamemhgbmrqmwlkqcc.supabase.co',
    anonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_9Q9g9ziWIZuhq24zRPp11Q_OgIMhkq6',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  },

  // Provedor de WhatsApp Principal: Meta Cloud API
  meta: {
    token: process.env.META_WA_TOKEN || '',
    phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID || '',
    appSecret: process.env.META_WA_APP_SECRET || '',
    verifyToken: process.env.META_WA_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'box74_webhook_token_seguro',
    apiVersion: process.env.META_WA_API_VERSION || 'v21.0'
  },

  // Provedor de Mensageria Selecionado ('meta', 'evolution', 'zapi' ou 'mock')
  waProvider: (process.env.WA_PROVIDER || 'meta').toLowerCase(),

  // Adaptadores Alternativos (Opcionais)
  evolution: {
    apiUrl: process.env.EVOLUTION_API_URL || '',
    apiKey: process.env.EVOLUTION_API_KEY || '',
    instance: process.env.EVOLUTION_INSTANCE || 'box74'
  },
  zapi: {
    instanceId: process.env.ZAPI_INSTANCE_ID || '',
    token: process.env.ZAPI_TOKEN || '',
    clientToken: process.env.ZAPI_CLIENT_TOKEN || ''
  },

  // Provedor de IA Contextual
  ai: {
    enabled: process.env.AI_ENABLED === 'true' || Boolean(process.env.AI_API_KEY),
    provider: (process.env.AI_PROVIDER || 'openai').toLowerCase(), // 'openai', 'groq', 'openrouter', 'gemini'
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || (process.env.AI_PROVIDER === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini'),
    baseURL: process.env.AI_BASE_URL || ''
  },

  // Atendimento Humano e Notificações
  humanSupport: {
    adminPhone: process.env.NOTIFICATION_ADMIN_PHONE || '', // Ex: '5585999999999'
    notificationChannel: process.env.NOTIFICATION_CHANNEL || 'whatsapp', // 'whatsapp', 'webhook', 'none'
    alertOnHandoff: process.env.ALERT_ON_HANDOFF !== 'false'
  },

  // Dados Comerciais BOX74
  pix: {
    key: process.env.BOX74_PIX_KEY || '5fbf536f-8dea-4ff2-9546-7f4e0e487e3d',
    owner: process.env.BOX74_PIX_OWNER || 'Adriana Maria de Lima Almeida'
  }
};

module.exports = { config, loadEnvFile };
