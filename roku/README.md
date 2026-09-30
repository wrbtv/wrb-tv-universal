# WRB-PLAY-ROKU

Aplicativo Roku TV do ecossistema WRB-TV.

## Integração com WRB-TV Business

Antes do login o aplicativo consulta:
https://wrb-tv-business.netlify.app/api/v1/device/check

Durante o uso envia heartbeat para:
https://wrb-tv-business.netlify.app/api/v1/device/heartbeat

O ID é obtido por roDeviceInfo.GetChannelClientId() e enviado como ROKU-XXXXXXXXXXXX.

O aplicativo informa ao painel:
app_id = WRB-PLAY-ROKU
platform = Roku TV
version = 1.0.0

## Login

Suporta Xtream Codes e os códigos 0022 e PFAST usados nas versões atuais do WRB-TV.

## Sideload

O workflow cria o pacote WRB-PLAY-ROKU.zip para instalação em Roku Developer Mode.
