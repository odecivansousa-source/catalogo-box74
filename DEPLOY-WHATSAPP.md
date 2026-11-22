# GUIA DE PUBLICAÇÃO E ATIVAÇÃO EM PRODUÇÃO — AGENTE WHATSAPP BOX74

Este documento descreve o passo a passo completo para o proprietário e administrador da **BOX74** ativar o atendente virtual no WhatsApp em ambiente de produção com alta disponibilidade, segurança criptográfica, fluxo **Meta Embedded Signup** e **Modo de Coexistência** com o aplicativo WhatsApp Business no celular.

> **Número Oficial Exclusivo da BOX74:** `+55 84 98189-6369` (5584981896369)

---

## 1. Visão Geral da Arquitetura e Coexistência

O sistema opera com uma arquitetura modular preparada para coexistência híbrida:

- **Motor Central (`src/whatsapp-agent.js`)**: Compreensão de linguagem natural (NLU), controle do catálogo oficial de 33 produtos, validação de estoque em tempo real, carrinho conversacional e regras comerciais.
- **Serviço de Coexistência (`src/services/coexistence-service.js`)**: Monitora eventos de `message_echoes` enviados pelo WhatsApp Business App no smartphone. Quando a proprietária ou atendente responde a um cliente diretamente pelo celular, o bot detecta a mensagem e silencia a IA automaticamente para aquele cliente por 24h (ou até comando `MENU`), garantindo que a IA nunca interfira na conversa humana.
- **Serviço Embedded Signup (`src/services/meta-embedded-signup.js`)**: Realiza a troca segura do código de autorização OAuth por token de acesso da Meta e valida estritamente que o número conectado seja `+55 84 98189-6369`.
- **Armazenamento Seguro de Credenciais (`src/services/credentials-store.js`)**: Gerencia o WABA ID, Phone Number ID e status de coexistência no Supabase com isolamento por RLS.
- **Serviço de Webhook (`src/whatsapp-webhook.js`)**: Servidor HTTP com validação criptográfica HMAC-SHA256 (`X-Hub-Signature-256`), rotas de health-check, endpoints de Embedded Signup e tratamento de ecos.
- **Adaptadores de Mensageria (`src/adapters/`)**:
  - `MetaWhatsAppAdapter` (Oficial Meta Cloud API via Graph API v21.0 com suporte a ecos).
  - `EvolutionApiAdapter` (Opcional - instâncias Baileys auto-hospedadas).
  - `ZApiAdapter` (Opcional - gateway em nuvem).
- **Provedor de IA Contextual (`src/services/ai-service.js`)**: Integração com Groq (Llama 3.3 70B), OpenAI ou OpenRouter com fallback determinístico local.
- **Atendimento Humano (`src/services/human-handoff.js`)**: Disparo de alerta instantâneo via WhatsApp para o telefone do administrador.
- **Persistência (`Supabase`)**: Tabelas `box74_products`, `box74_orders`, `box74_conversations` e `box74_messages` com proteção por RLS e stored procedures.

---

## 2. Configuração no Meta for Developers e Meta Business

### Etapa 2.1 — Criar Aplicativo no Meta for Developers
1. Acesse o portal [developers.facebook.com](https://developers.facebook.com/) e faça login com a conta do Facebook da empresa.
2. Clique em **Meus Aplicativos** > **Criar Aplicativo**.
3. Selecione o tipo **Empresa (Business)** e avance.
4. Dê o nome ao app (ex: `BOX74 Atendimento WhatsApp`) e vincule à Conta Empresarial da BOX74 no Meta Business Manager.
5. No painel do aplicativo, adicione os produtos:
   - **WhatsApp** (clique em Configurar).
   - **Facebook Login for Business** (necessário para o Embedded Signup).

### Etapa 2.2 — Configurar o WhatsApp Embedded Signup
1. No menu do app, acesse **Facebook Login for Business** > **Configurações**:
   - Ative o fluxo de login via navegador / JavaScript SDK.
   - Adicione a URL do catálogo BOX74 nos domínios permitidos para redirecionamento OAuth.
2. Em **WhatsApp** > **Embedded Signup**:
   - Crie um **Configuration ID** (Identificador de Configuração).
   - Defina as permissões solicitadas: `whatsapp_business_management` e `whatsapp_business_messaging`.
   - Copie o **Configuration ID** gerado. Este valor irá para `META_EMBEDDED_CONFIG_ID`.

### Etapa 2.3 — Obter as Chaves do Aplicativo
1. Vá em **Configurações do Aplicativo** > **Básico**:
   - **ID do Aplicativo (App ID)**: copie o código numérico. Este valor irá para `META_APP_ID`.
   - **Chave Secreta do Aplicativo (App Secret)**: clique em "Mostrar" e copie. Este valor irá para `META_WA_APP_SECRET`. Ele é utilizado para autenticar a assinatura HMAC-SHA256 (`X-Hub-Signature-256`) em todas as mensagens recebidas.

### Etapa 2.4 — Modo de Coexistência com WhatsApp Business App
> **Importante:** A Meta introduziu o suporte oficial à coexistência entre o aplicativo WhatsApp Business no smartphone (Android/iOS) e a Cloud API para o mesmo número comercial:
- O número `+55 84 98189-6369` **NÃO precisa ser desconectado do celular** nem migrado de forma destrutiva.
- Ao realizar o onboarding via Embedded Signup com a opção de coexistência ativa, a Meta sincroniza as mensagens entre a Cloud API e o aplicativo móvel.
- Para habilitar os avisos de quando alguém responde pelo celular, é obrigatório marcar o campo de webhook `message_echoes`.

---

## 3. Configuração dos Webhooks na Meta

1. No painel do app na Meta, vá em **WhatsApp** > **Configuração** > seção **Webhook**:
   - **URL de Retorno de Chamada**: `https://seu-dominio.com/webhook` (deve ser HTTPS com certificado válido).
   - **Verificar Token**: digite o valor definido em `META_WA_VERIFY_TOKEN` (ex: `box74_webhook_token_seguro`).
2. Clique em **Verificar e Salvar** (o servidor BOX74 responderá com o `hub.challenge`).
3. Clique em **Gerenciar Campos** e assine obrigatoriamente:
   - **`messages`**: para receber as mensagens enviadas pelos clientes.
   - **`message_echoes`**: para detectar quando a atendente responde pelo celular e silenciar o bot.

---

## 3. Configuração do Servidor e Variáveis de Ambiente

No servidor de produção (VPS Linux, Docker ou Windows Server):

1. Clone ou transfira os arquivos do projeto para o diretório de destino:
   ```bash
   cd /caminho/para/catalogo-box74
   ```
2. Crie o arquivo `.env` a partir do modelo `.env.example`:
   ```bash
   cp .env.example .env
   ```
3. Abra o arquivo `.env` e preencha as variáveis:
   ```env
   NODE_ENV=production
   PORT=3000
   HOST=0.0.0.0

   # Supabase
   SUPABASE_URL=https://owzamemhgbmrqmwlkqcc.supabase.co
   SUPABASE_ANON_KEY=sua_chave_publica_aqui

   # Provedor Principal
   WA_PROVIDER=meta

   # Credenciais Meta Cloud API
   META_WA_TOKEN=EAA...seu_token_permanente...
   META_WA_PHONE_NUMBER_ID=105948392019482
   META_WA_APP_SECRET=seu_app_secret_aqui
   META_WA_VERIFY_TOKEN=box74_token_secreto_definido_por_voce
   META_WA_API_VERSION=v21.0

   # Inteligência Artificial Contextual (Opcional - Exemplo com Groq)
   AI_ENABLED=true
   AI_PROVIDER=groq
   AI_API_KEY=gsk_sua_chave_groq_aqui
   AI_MODEL=llama-3.3-70b-versatile

   # Atendimento Humano
   NOTIFICATION_ADMIN_PHONE=5585999999999
   ALERT_ON_HANDOFF=true

   # Chave Pix BOX74
   BOX74_PIX_KEY=5fbf536f-8dea-4ff2-9546-7f4e0e487e3d
   BOX74_PIX_OWNER=Adriana Maria de Lima Almeida
   ```

---

## 4. Configuração do Webhook na Meta

Para que a Meta envie as mensagens recebidas para o seu servidor, o webhook precisa estar acessível publicamente via HTTPS com certificado SSL válido:

1. Acesse o painel do aplicativo no **Meta for Developers**.
2. Vá em **WhatsApp** > **Configuração** > seção **Webhook**:
   - **URL de Retorno de Chamada**: `https://seu-dominio.com/webhook` (ou URL do Cloudflare Tunnel/ngrok).
   - **Verificar Token**: digite exatamente o mesmo valor definido em `META_WA_VERIFY_TOKEN` no `.env`.
3. Clique em **Verificar e Salvar**.
   - O servidor da Meta fará uma chamada `GET /webhook?hub.mode=subscribe&hub.challenge=...`. O servidor BOX74 responderá instantaneamente confirmando o handshake.
4. Após salvar, clique em **Gerenciar Campos** e marque o campo **`messages`**.

---

## 5. Hospedagem Permanente com PM2 (Recomendado)

O gerenciador de processos PM2 mantém a aplicação ativa continuamente, reinicia automaticamente em caso de reboot do servidor ou falha imprevista, e gerencia logs.

### Instalar PM2 e Iniciar Serviço:
```bash
# Instalação global do PM2 (se não estiver instalado)
npm install -g pm2

# Iniciar o agente com as configurações do ecosystem.config.js
npm run pm2:start

# Configurar inicialização automática no boot do sistema operacional
pm2 startup
pm2 save
```

### Comandos Úteis do PM2:
- Ver status da aplicação: `pm2 status`
- Monitorar uso de memória e CPU: `pm2 monit`
- Visualizar logs em tempo real: `npm run pm2:logs` ou `pm2 logs box74-whatsapp`
- Reiniciar o agente: `npm run pm2:restart`
- Parar o serviço: `npm run pm2:stop`

---

## 6. Configuração com Nginx e SSL (Let's Encrypt)

Exemplo de bloco de configuração do Nginx como proxy reverso para a porta 3000:

```nginx
server {
    server_name api-whatsapp.box74.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Hub-Signature-256 $http_x_hub_signature_256;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Para gerar certificado SSL gratuito:
```bash
sudo certbot --nginx -d api-whatsapp.box74.com.br
```

---

## 7. Testes e Validação em Produção

1. **Health Check do Servidor**:
   ```bash
   curl http://localhost:3000/health
   ```
   Retorno esperado:
   ```json
   {
     "status": "healthy",
     "service": "BOX74 WhatsApp AI Agent",
     "provider": "meta",
     "aiEnabled": true,
     "uptimeSeconds": 12,
     "memoryRssMb": 34
   }
   ```

2. **Teste Real no WhatsApp**:
   - Envie uma mensagem pelo WhatsApp para o número cadastrado da BOX74: *"Olá, bom dia!"*
   - O bot responderá com a saudação oficial.
   - Envie: *"Quanto custa o sabão clarilux?"*
   - O bot responderá com o valor oficial de R$ 19,00 e consultará o estoque.
   - Envie: *"Quero 2"* -> O produto é adicionado ao carrinho conversacional.
   - Envie: *"Falar com atendente"* -> O cliente recebe o aviso de transbordo e o número cadastrado em `NOTIFICATION_ADMIN_PHONE` recebe o alerta imediato.

---

## 8. Dados Externos que Devem ser Fornecidos ou Configurados pelo Proprietário da BOX74

Para concluir a ativação no número comercial da BOX74, o proprietário deve fornecer ou configurar no arquivo `.env` (ou autorizar através do Embedded Signup):

| Dado Necessário | Onde Obter | Variável no `.env` |
|---|---|---|
| **Número WhatsApp Comercial** | Linha telefônica oficial da loja | `+55 84 98189-6369` (5584981896369) |
| **Meta App ID** | Meta Developers > Painel do Aplicativo | `META_APP_ID` |
| **Meta App Secret** | Meta Developers > Configurações > Básico | `META_WA_APP_SECRET` |
| **Embedded Signup Config ID** | Meta Developers > WhatsApp > Embedded Signup | `META_EMBEDDED_CONFIG_ID` |
| **Meta Access Token Permanente** | Meta Business Manager > Usuários do Sistema | `META_WA_TOKEN` |
| **Phone Number ID** | Meta Developers > WhatsApp > Configuração da API | `META_WA_PHONE_NUMBER_ID` |
| **WABA ID (WhatsApp Business Account)** | Meta Developers > WhatsApp > Configuração da API | `META_WA_WABA_ID` |
| **Telefone do Atendente Humano** | Telefone do responsável para receber alertas de transbordo | `NOTIFICATION_ADMIN_PHONE` |
| **Chave de IA (Opcional)** | Painel Groq ([console.groq.com](https://console.groq.com)) ou OpenAI | `AI_API_KEY` |
