# Gestão da Frota de Bicicletas — Parques Tejo

Aplicação interna para os Quiosques de Mobilidade da Praia da Torre e do Terrapleno de Algés. O frontend é React/TypeScript, a API corre em Cloudflare Pages Functions e os dados são guardados em PostgreSQL/Supabase.

**Se não tem experiência técnica, comece pelo ficheiro `GUIA_INSTALACAO_SIMPLES.md`.**

## Arquitetura

```mermaid
flowchart LR
  U[Funcionário] -->|HTTPS| P[Cloudflare Pages]
  P --> F[Pages Function / API]
  F -->|Service role, só no servidor| S[(Supabase PostgreSQL)]
```

O navegador nunca recebe a `service_role` nem contacta diretamente a base de dados. A API valida a sessão, o token CSRF, as permissões e os dados. As operações com várias bicicletas são efetuadas por funções PostgreSQL numa única transação.

## Modelo de dados

| Entidade | Finalidade |
|---|---|
| `kiosks` | Dois quiosques e respetivo estado |
| `users` / `sessions` | Utilizadores sem email, perfis e sessões por hash |
| `bikes` / `bike_status_history` | Ficha, estado, localização e histórico da bicicleta |
| `rentals` / `rental_items` | Aluguer e bicicletas incluídas; suporta devolução parcial |
| `faults` | Ocorrências de avaria |
| `maintenance_interventions` | Uma ou várias intervenções por avaria |
| `audit_log` | Registo imutável das ações críticas |
| `login_attempts` | Limitação de tentativas repetidas de autenticação |
| `daily_closures` | Fechos diários, totais automáticos, receita declarada e referência ao talão privado |
| `rental_discrepancies` | Divergências comunicadas durante a correção de alugueres |

## Funcionalidades implementadas

- Autenticação exclusiva por nome de utilizador e palavra-passe, sem email.
- PBKDF2-SHA-256 com salt individual e 100.000 iterações, o limite suportado pelo runtime do Cloudflare; sessões opacas armazenadas por hash.
- Cookies `HttpOnly`, `Secure` e `SameSite=Strict`, proteção CSRF e limitação a cinco tentativas em 15 minutos.
- Perfis Administrador e Funcionário, validados no backend.
- Dashboard com estados reais, distribuição por quiosque, alugueres em aberto, devoluções recentes e avarias pendentes.
- Frota, filtros, criação e alteração administrativa, desativação sem apagar histórico.
- Aluguer de uma ou várias bicicletas, transacional e sem campos financeiros.
- Devoluções parciais, mudança de quiosque e criação automática de avaria.
- Avarias, passagem para manutenção e conclusão com escolha explícita do estado final.
- Funcionários podem comunicar uma avaria sem consultar ocorrências, reparações ou histórico de manutenção; a gestão fica reservada a administradores e manutenção.
- Histórico de estados e auditoria das ações críticas.
- Fecho diário integrado, com vigilante e quiosque pré-preenchidos, contagem automática de alugueres e bicicletas por tipologia, rascunho, submissão, talão privado e observações.
- Consulta global, filtros, exportação CSV e reabertura de fechos para administradores.
- Correção de alugueres em aberto, com adição ou remoção de bicicletas e comunicação de discrepâncias.
- Inventário unificado de bicicletas elétricas, convencionais e infantis, capacetes, cadeados e carrinhos de bebé.
- Vista operacional dos funcionários limitada aos itens localizados nos quiosques de aluguer.
- Dashboard administrativo com atividade diária, semanal e mensal, receita declarada, os três últimos relatórios de final de dia de cada quiosque, inventário operacional disponível/alugado, ocorrências, observações, comparação temporal e exportação CSV.
- Matriz da frota por localização, tipologia e estado, permitindo consultar diretamente quantas bicicletas elétricas, convencionais e infantis e quantos acessórios existem em cada situação.
- Interface responsiva e em português de Portugal.
- Seed com os dois quiosques e bicicletas 001–020.

## Instalação local

Requisitos: Node.js 20 ou superior, npm, uma conta gratuita Supabase e uma conta gratuita Cloudflare.

1. Crie um projeto no Supabase e abra **SQL Editor**.
2. Execute, por ordem:
   - `supabase/migrations/001_initial.sql`
   - `supabase/migrations/002_operations.sql`
   - `supabase/migrations/003_bike_types.sql`
   - `supabase/migrations/004_support_locations.sql`
   - `supabase/migrations/005_maintenance_role.sql`
   - `supabase/migrations/006_daily_closures.sql`
   - `supabase/migrations/007_rental_corrections.sql`
   - `supabase/migrations/008_children_and_accessories.sql`
   - `supabase/seed.sql`
3. Copie `.env.example` para `.dev.vars` e preencha os valores. Nunca publique `.dev.vars`.
4. Instale e execute:

```bash
npm install
npx wrangler pages dev --proxy 5173 -- npm run dev
```

Em alternativa, execute `npm run dev` para o frontend e `npx wrangler pages dev dist --port 8788` para a API, ajustando o proxy do Vite se necessário.

## Primeiro administrador

Com `BOOTSTRAP_TOKEN` temporariamente configurado, execute uma única vez:

```bash
curl -X POST http://localhost:8788/api/bootstrap \
  -H "Content-Type: application/json" \
  -H "X-Bootstrap-Token: O_SEU_TOKEN_TEMPORARIO" \
  -d '{"full_name":"Administrador","username":"admin","password":"UMA_SENHA_LONGA_E_UNICA"}'
```

Depois de confirmar o acesso, remova `BOOTSTRAP_TOKEN` das variáveis locais e do Cloudflare. O endpoint recusa nova configuração quando já existe qualquer utilizador.

## Publicação no Cloudflare Pages

1. Coloque o projeto num repositório Git privado.
2. No Cloudflare Pages, escolha esse repositório.
3. Defina o comando de build como `npm run build` e a pasta de saída como `dist`.
4. Em **Settings → Environment variables**, configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `APP_ORIGIN` e, apenas no primeiro arranque, `BOOTSTRAP_TOKEN`.
5. Não defina `COOKIE_SECURE=false` em produção. Use sempre o domínio HTTPS do Pages em `APP_ORIGIN`.
6. Publique, crie o administrador pelo endpoint `/api/bootstrap` e remova imediatamente `BOOTSTRAP_TOKEN`.

Os planos gratuitos eram adequados à arquitetura à data de preparação, mas os limites e termos dos fornecedores podem mudar e devem ser confirmados antes da publicação institucional.

## Fotografias e documentos

Os talões de fecho diário são guardados num bucket privado do Supabase Storage, criado pela migração `006_daily_closures.sql`. O acesso é sempre efetuado através da API autenticada; o bucket não deve ser tornado público.

## Backup e recuperação

- No painel Supabase, use os backups disponibilizados no plano em vigor.
- Para uma cópia manual regular, utilize `pg_dump` com a connection string do projeto, guardando o ficheiro cifrado e com acesso restrito:

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner --file=frota_$(date +%F).dump
```

- Teste a recuperação periodicamente num projeto separado:

```bash
pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_DATABASE_URL" frota_DATA.dump
```

- Antes de restaurar produção, interrompa temporariamente a utilização e valide o ponto de restauro. A recuperação substitui dados e deve ser autorizada pelo responsável.

## Testes

```bash
npm test
npm run build
```

Os testes cobrem autenticação/conta inativa, permissões, indisponibilidade, duplicação em aluguer aberto, aluguer múltiplo, devolução parcial e total, anomalias, mudança de localização, conclusão de avaria e auditoria. A base de dados reforça as regras com índice único parcial, bloqueios transacionais e restrições.

## Segurança e operação

- Gere `SESSION_SECRET` e `BOOTSTRAP_TOKEN` com pelo menos 32 bytes aleatórios.
- Rode a chave `service_role` se esta for exposta e revogue todas as sessões.
- Reveja periodicamente utilizadores ativos e o `audit_log`.
- Configure retenção/anonimização dos nomes de clientes segundo a política interna. A coluna `customer_ref` pode ser substituída por `Anonimizado` pelo administrador sem remover as métricas do aluguer; deve ser acrescentado um botão específico quando a política de retenção estiver definida.
- Limpe periodicamente sessões expiradas e tentativas antigas com uma tarefa SQL agendada ou manutenção manual.

## Limitações conhecidas

- O upload privado está implementado para os talões de fecho diário; outros anexos continuam sem interface própria.
- O registo de intervenções dispõe da tabela completa, mas a interface inicial atualiza o estado da ocorrência; um formulário detalhado de intervenção é evolução imediata recomendada.
- Os filtros avançados por data/funcionário estão representados nos dados, mas a interface inicial privilegia pesquisa operacional simples.
- Não existe modo offline. A aplicação depende de ligação à internet e dos limites gratuitos dos fornecedores.
- A limitação de login usa a base de dados; para maior escala, pode ser complementada por Cloudflare Turnstile ou Rate Limiting.

## Evoluções futuras — não implementadas

- Upload privado de fotografias e documentos.
- Ecrã detalhado da bicicleta com cronologia agregada.
- Formulário completo para intervenções e custos de manutenção.
- Anonimização automática por prazo de retenção definido.
- Exportações CSV/PDF e indicadores estatísticos.
- Notificações externas e reservas.
- Migração para servidor próprio mantendo PostgreSQL e a mesma API.
