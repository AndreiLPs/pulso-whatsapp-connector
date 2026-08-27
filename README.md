# Conector descartável do WhatsApp

Serviço auxiliar do Pulso Comercial para vincular temporariamente um dispositivo, carregar conversas em modo leitura e apagar a sessão após a análise.

Variáveis obrigatórias:

- `CONNECTOR_SHARED_SECRET`: segredo longo compartilhado apenas com o backend do Pulso.
- `PORT`: porta HTTP, padrão `8080`.
- `SESSION_TTL_MINUTES`: vida máxima da sessão, padrão `10`.

O serviço não possui rota de envio. As chaves ficam em uma pasta temporária exclusiva, nunca são gravadas no Pulso e são apagadas no cancelamento, na expiração ou depois da análise. Para produção, publique este diretório em um serviço Docker sempre ativo com HTTPS.
