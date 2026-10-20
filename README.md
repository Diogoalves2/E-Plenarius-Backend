# Âncoras da auditoria do E-Plenarius

Cópia diária do último elo da cadeia de auditoria de cada câmara (`GET /api/public/ancoras`),
gravada pelo workflow `ancoras.yml` da branch master. O horário do commit é do GitHub.
Se o histórico for reescrito no servidor, o hash da posição `seq` deixa de bater e o workflow falha.
