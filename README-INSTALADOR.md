# WRB-TV Player - Instalador Windows

Esta versão gera somente o instalador NSIS do WRB-TV Player.

## Gerar

Execute `BUILD-INSTALADOR-WINDOWS.bat`.

O arquivo final será:

`release/WRB-TV-Player-Setup-2.0.18-x64.exe`

## O instalador

- instala o aplicativo no Windows;
- cria atalho na Área de Trabalho;
- cria atalho no Menu Iniciar;
- inicia o aplicativo ao concluir a instalação;
- mantém os dados de acesso salvos pelo aplicativo;
- não remove os dados do aplicativo durante a desinstalação.

A aplicação continua usando o servidor local integrado do Electron. O usuário não precisa abrir CMD ou instalar Node.js separadamente.
