# Guia simples de instalação — passo a passo

Este guia destina-se a quem não costuma instalar aplicações. Não precisa de programar: precisa apenas de criar três contas gratuitas e copiar ficheiros e códigos.

Reserve cerca de **45 a 60 minutos** e tenha o ZIP da aplicação num computador com internet.

Vai utilizar:

1. **GitHub** — para guardar o código;
2. **Supabase** — para guardar os dados;
3. **Cloudflare** — para colocar a aplicação online.

Não introduza dados reais antes de terminar os testes finais deste guia.

## 1. Extrair a aplicação

1. Clique com o botão direito em `Gestao_Frota_Bicicletas_Parques_Tejo_v1.zip`.
2. Escolha **Extrair tudo**.
3. Abra a pasta extraída.
4. Confirme que vê `package.json`, `README.md` e as pastas `src`, `functions` e `supabase`.

## 2. Criar a base de dados no Supabase

### Criar o projeto

1. Abra [supabase.com](https://supabase.com/) e clique em **Start your project**.
2. Crie uma conta ou inicie sessão.
3. Clique em **New project**. Se for pedido, crie primeiro uma organização chamada `Parques Tejo`.
4. Preencha:
   - **Name:** `frota-bicicletas`;
   - **Database Password:** crie uma palavra-passe forte e guarde-a;
   - **Region:** escolha uma região europeia;
   - **Plan:** Free.
5. Clique em **Create new project** e aguarde pela conclusão.

### Criar as tabelas

Execute os ficheiros pela ordem indicada:

1. No menu esquerdo, entre em **SQL Editor** e clique em **New query**.
2. No computador, abra `supabase/migrations/001_initial.sql` com o Bloco de Notas.
3. Prima `Ctrl + A`, depois `Ctrl + C`.
4. Volte ao Supabase, cole o texto na caixa grande e clique em **Run**.
5. Depois da mensagem de sucesso, abra uma nova query e repita com `supabase/migrations/002_operations.sql`.
6. Abra uma nova query e execute também `supabase/migrations/003_bike_types.sql`.
7. Por fim, execute `supabase/migrations/004_support_locations.sql`.
8. Execute também `supabase/migrations/005_maintenance_role.sql`.
9. Execute `supabase/migrations/006_daily_closures.sql`, que cria os fechos diários e o armazenamento privado dos talões.
10. Execute `supabase/migrations/007_rental_corrections.sql`, que permite corrigir alugueres em aberto e comunicar discrepâncias.
11. Abra uma nova query e execute `supabase/seed.sql`.

Se surgir uma mensagem vermelha, pare e guarde uma captura do erro. Não execute os ficheiros repetidamente.

### Copiar o endereço e a chave

1. Abra **Project Settings** e entre em **API Keys**, ou utilize o botão **Connect**.
2. Copie o **Project URL**, semelhante a `https://abcdefgh.supabase.co`.
3. Na área **Secret keys**, copie uma chave que começa por `sb_secret_`.
4. Se apenas aparecerem chaves antigas, abra **Legacy API Keys** e copie `service_role`.

Guarde estes dois valores temporariamente. A chave é confidencial: não a envie por email, não a coloque no GitHub e não a partilhe com funcionários.

## 3. Colocar a aplicação no GitHub

1. Abra [github.com](https://github.com/) e crie uma conta ou inicie sessão.
2. No canto superior direito, clique em **+** e depois em **New repository**.
3. Escreva `frota-bicicletas` no nome.
4. Selecione **Private**.
5. Não assinale opções para criar README, `.gitignore` ou licença.
6. Clique em **Create repository**.
7. Na página seguinte, clique em **uploading an existing file**.
8. Abra a pasta extraída no passo 1 e selecione **todo o conteúdo dentro da pasta**.
9. Arraste tudo para a área de upload do GitHub.
10. Aguarde, escreva `Versão inicial` e clique em **Commit changes**.

Na página principal devem aparecer diretamente `package.json`, `src`, `functions` e `supabase`. Se aparecer apenas uma pasta exterior, os ficheiros ficaram no nível errado.

## 4. Publicar no Cloudflare

### Criar a aplicação

1. Abra [dash.cloudflare.com](https://dash.cloudflare.com/) e crie uma conta ou inicie sessão.
2. Entre em **Workers & Pages**.
3. Clique em **Create application**.
4. Escolha **Pages** e **Connect to Git**.
5. Autorize a ligação ao GitHub e selecione `frota-bicicletas`.
6. Preencha:
   - **Project name:** `frota-bicicletas`;
   - **Production branch:** `main`;
   - **Framework preset:** `Vite` ou `React (Vite)`;
   - **Build command:** `npm run build`;
   - **Build output directory:** `dist`.
7. Clique em **Save and Deploy**.

### Adicionar as configurações secretas

1. Abra o projeto criado no Cloudflare.
2. Entre em **Settings → Variables and Secrets**. Em algumas versões aparece como **Environment variables**.
3. Adicione no ambiente **Production**:

| Nome | Valor | Tipo |
|---|---|---|
| `SUPABASE_URL` | O Project URL copiado do Supabase | Variable |
| `SUPABASE_SECRET_KEY` | A chave que começa por `sb_secret_` | Secret |
| `SESSION_SECRET` | Um código aleatório com pelo menos 40 caracteres | Secret |
| `BOOTSTRAP_TOKEN` | Outro código aleatório com pelo menos 40 caracteres | Secret |
| `APP_ORIGIN` | O endereço da aplicação atribuído pelo Cloudflare | Variable |

Se copiou a chave antiga `service_role`, crie `SUPABASE_SERVICE_ROLE_KEY` em vez de `SUPABASE_SECRET_KEY`.

Para gerar cada um dos dois códigos aleatórios no Windows:

1. Abra o menu Iniciar e procure **PowerShell**.
2. Cole a linha seguinte e carregue em Enter:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

3. Copie o resultado para `SESSION_SECRET`.
4. Execute novamente e copie o novo resultado para `BOOTSTRAP_TOKEN`.
5. Guarde temporariamente o `BOOTSTRAP_TOKEN`.

### Publicar novamente

1. Abra **Deployments** no Cloudflare.
2. No último deployment, escolha **Retry deployment** ou **Redeploy**.
3. Aguarde até aparecer **Success**.
4. Abra o endereço apresentado, semelhante a `https://frota-bicicletas.pages.dev`.

## 5. Criar o primeiro administrador

1. Acrescente `/configurar` ao endereço da aplicação.
2. Exemplo: `https://frota-bicicletas.pages.dev/configurar`.
3. Preencha:
   - o `BOOTSTRAP_TOKEN` no código temporário;
   - o nome completo do administrador;
   - um nome de utilizador;
   - uma palavra-passe com pelo menos 6 caracteres.
4. Clique em **Criar administrador**.
5. Volte ao endereço principal e confirme que consegue entrar.

Depois de entrar com sucesso:

1. Volte a **Cloudflare → Settings → Variables and Secrets**.
2. Elimine apenas `BOOTSTRAP_TOKEN`.
3. Guarde e volte a publicar, se for solicitado.

## 6. Fazer o teste final

Antes de inserir dados reais:

1. Confirme que aparecem 20 bicicletas, de `001` a `020`.
2. Confirme os quiosques Praia da Torre e Terrapleno de Algés.
3. Crie um funcionário de teste.
4. Inicie um aluguer com duas bicicletas.
5. Devolva apenas uma e confirme que o aluguer continua aberto.
6. Devolva a segunda com uma anomalia.
7. Confirme que passa para **Avariada** e deixa de poder ser alugada.
8. Desative o funcionário de teste e confirme que deixa de conseguir entrar.
9. Entre com o funcionário, abra **Fecho diário**, confirme os totais automáticos, anexe um talão de teste e submeta.
10. Entre como administrador, confirme que consegue consultar, exportar e reabrir o fecho.

## O que nunca deve fazer

- Não partilhe as chaves secretas por email ou WhatsApp.
- Não coloque chaves no GitHub.
- Não torne o repositório público.
- Não partilhe uma única conta de administrador por várias pessoas.
- Não volte a executar os ficheiros SQL depois de a aplicação estar em utilização sem apoio técnico.

## Quando pedir ajuda ao IT

Peça apoio se surgir um erro vermelho no Supabase, `Build failed` no Cloudflare, a aplicação não conseguir guardar dados, uma chave for divulgada, ou se pretender um domínio próprio, backups automáticos ou alojamento num servidor interno.

Ao pedir ajuda, envie uma captura do erro, mas confirme primeiro que a imagem não mostra nenhuma chave secreta.
