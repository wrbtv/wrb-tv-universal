# WRB-TV iPhone (PWA)

Esta é uma versão web instalável do WRB-TV, baseada na interface do aplicativo Android e adaptada para Safari/iPhone. É independente dos arquivos Android e não exige publicação na App Store nem cadastro no Apple Developer Program.

## Como instalar no iPhone

1. Publique esta pasta como um site HTTPS no Netlify.
2. Abra a URL publicada no Safari do iPhone.
3. Toque em **Compartilhar** > **Adicionar à Tela de Início**.
4. Deixe **Abrir como App da Web** ativado, se essa opção aparecer, e toque em **Adicionar**.

O ícone WRB-TV aparecerá na tela inicial e abrirá em modo de aplicativo web.

## Publicação no Netlify

Esta branch contém apenas os arquivos da versão iPhone na raiz. Importe a branch `iphone-pwa` como um novo site Netlify e use o diretório raiz como base. O arquivo `netlify.toml` configura o site estático e a função serverless `netlify/functions/api.mjs`.

A função implementa:
- API JSON de autenticação, categorias, filmes e séries;
- suporte aos códigos de servidor 0022 e PFAST e à lista de servidores alternativos;
- proxy same-origin para streams, incluindo reescrita dos caminhos em playlists HLS.

## Limitações do iOS

- Esta versão é uma PWA, não um IPA nativo. Não há instalação de executável nem publicação na App Store.
- O iOS pode bloquear reprodução automática de áudio/vídeo até o toque do usuário. O player continua mostrando a interface e permite iniciar a reprodução.
- A reprodução depende do formato do conteúdo e da compatibilidade do stream com Safari/iOS.
- A sessão é mantida no `localStorage` do mesmo domínio; mudar de domínio cria uma origem nova e requer login novamente.
- O backend de mídia precisa ficar publicado no mesmo domínio do app para o proxy `/api/stream` funcionar.

## Privacidade

As credenciais IPTV são enviadas à função serverless apenas para autenticar no provedor informado e são armazenadas no armazenamento local do navegador do usuário. Não há um sistema de contas WRB-TV adicional nesta PWA. Use somente credenciais e listas que você está autorizado a acessar.
