// =====================================================================
// BOX74 - Configuração do Gerenciador de Processos PM2
// Garante execução contínua, reinício automático em falhas e controle de memória
// =====================================================================

module.exports = {
  apps: [
    {
      name: 'box74-whatsapp',
      script: 'src/whatsapp-webhook.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '250M', // Controle de memória para não sobrecarregar o host
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      time: true
    }
  ]
};
