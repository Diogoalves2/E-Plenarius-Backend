// Testes ponta a ponta de segurança e votação. Rodam no CI (GitHub Actions) contra um
// Postgres descartável — NUNCA contra produção: votos e auditoria são imutáveis.
//
//   E2E_API=http://127.0.0.1:3001/api \
//   E2E_PSQL="psql postgresql://user:pass@localhost:5432/db" \
//   node test/e2e.mjs <superadminEmail> <superadminSenha>
import { execSync } from 'node:child_process';

const B = process.env.E2E_API ?? 'http://127.0.0.1:3001/api';
const WS = B.replace(/\/api\/?$/, '');
const PSQL = process.env.E2E_PSQL;
if (!PSQL) { console.error('Defina E2E_PSQL'); process.exit(2); }
const [, , SA_EMAIL, SA_PASS] = process.argv;

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}`); }
  else { fail++; console.log(`  ✘ ${label} ${extra}`); }
};
async function call(method, path, { token, body } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const psql = (sql) => {
  try {
    return { out: execSync(`${PSQL} -tAc ${JSON.stringify(sql)}`, { stdio: 'pipe' }).toString().trim(), err: null };
  } catch (e) { return { out: null, err: e.stderr.toString() }; }
};
const login = async (identifier, password) => (await call('POST', '/auth/login', { body: { identifier, password } })).data;
const KEY1 = 'k1'.padEnd(40, 'a'), KEY2 = 'k2'.padEnd(40, 'b');

console.log('\n[setup]');
const sa = await login(SA_EMAIL, SA_PASS);
ok(!!sa?.accessToken, 'login superadmin');
const A = (await call('POST', '/chambers/setup', { token: sa.accessToken, body: { name: 'Camara Alfa', city: 'Alfa', state: 'PB', presidenteName: 'Pres Alfa', presidenteEmail: 'pa@t.com', presidentePassword: 'senhaAlfa123' } })).data;
const Bc = (await call('POST', '/chambers/setup', { token: sa.accessToken, body: { name: 'Camara Beta', city: 'Beta', state: 'PB', presidenteName: 'Pres Beta', presidenteEmail: 'pb@t.com', presidentePassword: 'senhaBeta123' } })).data;
const chA = A.chamber.id, chB = Bc.chamber.id;
const pA = await login('pa@t.com', 'senhaAlfa123');
const pB = await login('pb@t.com', 'senhaBeta123');
ok(pA?.accessToken && pB?.accessToken, 'login presidentes A e B');

console.log('\n[isolamento entre câmaras]');
const mk = (n) => call('POST', '/users', { token: pA.accessToken, body: { chamberId: chA, name: `Ver ${n}`, email: `v${n}@t.com`, password: 'senhaVer123', role: 'vereador' } });
const v1 = (await mk(1)).data, v2 = (await mk(2)).data, v3 = (await mk(3)).data;
ok(v1?.id && v2?.id && v3?.id, 'presidente A cria 3 vereadores');
ok((await call('POST', '/users', { token: pB.accessToken, body: { chamberId: chA, name: 'Intruso', email: 'x@t.com', password: 'senhaVer123', role: 'vereador' } })).status === 403, 'presidente B não cria usuário na câmara A');
ok((await call('PATCH', `/users/${v1.id}`, { token: pB.accessToken, body: { name: 'hack' } })).status === 403, 'presidente B não edita vereador de A');
ok((await call('PATCH', `/users/${v1.id}`, { token: pA.accessToken, body: { role: 'superadmin' } })).status === 400, 'role superadmin rejeitado no PATCH');
ok((await call('PATCH', `/users/${v1.id}`, { token: pA.accessToken, body: { passwordHash: 'x' } })).status === 400, 'campo passwordHash rejeitado no PATCH');
ok((await call('GET', `/users/${v1.id}`, { token: pB.accessToken })).status === 403, 'presidente B não lê vereador de A');
const pubUsers = (await call('GET', `/users/chamber/${chA}`)).data;
ok(Array.isArray(pubUsers) && pubUsers.every(u => !('email' in u)), 'lista pública sem e-mail');

console.log('\n[PIN 6 dígitos]');
ok((await call('PATCH', `/users/${v1.id}/pin`, { token: pA.accessToken, body: { pin: '1234' } })).status === 400, 'PIN de 4 dígitos rejeitado');
ok((await call('PATCH', `/users/${v1.id}/pin`, { token: pA.accessToken, body: { pin: '111111' } })).status === 400, 'PIN repetido rejeitado');
ok((await call('PATCH', `/users/${v1.id}/pin`, { token: pA.accessToken, body: { pin: '123456' } })).status === 400, 'PIN sequencial rejeitado');
ok((await call('PATCH', `/users/${v1.id}/pin`, { token: pA.accessToken, body: { pin: '482913' } })).status === 200, 'PIN válido aceito');

console.log('\n[sessão]');
const sess = (await call('POST', '/sessions', { token: pA.accessToken, body: { chamberId: chA, number: 1, type: 'ordinaria', date: '2026-10-18' } })).data;
ok((await call('POST', '/sessions', { token: pB.accessToken, body: { chamberId: chA, number: 9, type: 'ordinaria', date: '2026-10-18' } })).status === 403, 'presidente B não cria sessão em A');
ok((await call('PATCH', `/sessions/${sess.id}/start`, { token: pB.accessToken })).status === 403, 'presidente B não inicia sessão de A');
ok((await call('PATCH', `/sessions/${sess.id}/start`, { token: pA.accessToken })).status === 200, 'presidente A inicia sessão');
ok((await call('GET', `/sessions/${sess.id}`)).data?.phase === 'abertura', 'sessão inicia na fase Abertura do roteiro');
ok((await call('POST', `/sessions/${sess.id}/presence`, { token: pA.accessToken })).status === 201, 'presidente A confirma presença (quórum)');
ok((await call('POST', `/expediente/sessions/${sess.id}/inscricoes/abrir/grande`, { token: pB.accessToken })).status === 403, 'presidente B não abre expediente de A');

console.log('\n[tablets]');
const ml = (pin, deviceKey) => call('POST', '/auth/mobile-login', { body: { userId: v1.id, pin, deviceKey, deviceName: 'Teste' } });
ok((await call('POST', '/auth/mobile-login', { body: { userId: v1.id, pin: '482913' } })).status === 400, 'login mobile sem deviceKey rejeitado (app antigo)');
ok((await ml('000000', KEY2)).status === 401, 'tablet novo + PIN errado = 401 (não registra)');
const r1 = await ml('482913', KEY1);
ok(r1.status === 403 && /código/i.test(r1.data?.message), 'tablet novo + PIN certo = pendente', JSON.stringify(r1.data));
const devs = (await call('GET', `/devices/chamber/${chA}`, { token: pA.accessToken })).data;
ok(devs?.length === 1 && devs[0].status === 'pendente' && !('keyHash' in devs[0]), 'presidente vê 1 tablet pendente (sem keyHash)');
ok((await call('GET', `/devices/chamber/${chA}`, { token: pB.accessToken })).status === 403, 'presidente B não vê tablets de A');
ok((await call('PATCH', `/devices/${devs[0].id}/approve`, { token: pB.accessToken, body: {} })).status === 403, 'presidente B não aprova tablet de A');
ok((await call('PATCH', `/devices/${devs[0].id}/approve`, { token: pA.accessToken, body: { label: 'Tablet 1' } })).status === 200, 'presidente A aprova tablet');
const mob = (await ml('482913', KEY1)).data;
ok(!!mob?.accessToken, 'login mobile com tablet aprovado');

console.log('\n[pauta + voto secreto]');
const item = (await call('POST', '/agenda', { token: pA.accessToken, body: { sessionId: sess.id, chamberId: chB, number: 'PL 1/2026', type: 'Projeto de Lei', title: 'Secreto', authorName: 'X', votingType: 'secreta', quorumMinimum: 1, orderIndex: 0 } })).data;
ok(item?.chamberId === chA, 'chamberId da pauta vem da sessão (spoof para B ignorado)');
ok((await call('PATCH', `/voting/open/${item.id}`, { token: pB.accessToken })).status === 403, 'presidente B não abre votação de A');
ok((await call('PATCH', `/voting/open/${item.id}`, { token: pA.accessToken })).status === 200, 'presidente A abre votação secreta');
ok((await call('POST', '/voting/cast', { token: mob.accessToken, body: { agendaItemId: item.id, choice: 'sim' } })).status === 403, 'voto sem presença bloqueado');
ok((await call('POST', `/sessions/${sess.id}/presence`, { token: mob.accessToken })).status === 201, 'v1 confirma presença');
const vote1 = await call('POST', '/voting/cast', { token: mob.accessToken, body: { agendaItemId: item.id, choice: 'sim' } });
ok(vote1.status === 201 && /^0x[0-9a-f]{16}$/.test(vote1.data?.hash), 'v1 vota (comprovante 0x+16hex)');
ok((await call('POST', '/voting/cast', { token: mob.accessToken, body: { agendaItemId: item.id, choice: 'nao' } })).status === 409, 'voto duplo = 409');
const w2 = await login('v2@t.com', 'senhaVer123'), w3 = await login('v3@t.com', 'senhaVer123');
await call('POST', `/sessions/${sess.id}/presence`, { token: w2.accessToken });
await call('POST', `/sessions/${sess.id}/presence`, { token: w3.accessToken });
const conc = await Promise.all([
  call('POST', '/voting/cast', { token: w2.accessToken, body: { agendaItemId: item.id, choice: 'nao' } }),
  call('POST', '/voting/cast', { token: w3.accessToken, body: { agendaItemId: item.id, choice: 'sim' } }),
  call('POST', '/voting/cast', { token: w3.accessToken, body: { agendaItemId: item.id, choice: 'sim' } }),
]);
ok(conc.filter(c => c.status === 201).length === 2 && conc.filter(c => c.status === 409).length === 1, 'votos simultâneos: 2 aceitos, duplicado 409', conc.map(c => c.status).join(','));
const pub = (await call('GET', `/agenda/${item.id}`)).data;
ok(pub.votesYes === null && pub.votesTotal === 3 && pub.countsHidden === true, 'placar secreto oculto durante votação (total=3)', JSON.stringify({ y: pub.votesYes, t: pub.votesTotal }));
const vl = (await call('GET', `/voting/item/${item.id}/votes`, { token: pA.accessToken })).data;
ok(vl.length === 3 && vl.every(v => v.choice === 'secreta'), 'lista de votos não revela escolha');
const dbChoices = psql(`SELECT string_agg(choice, ',') FROM votes WHERE "agendaItemId"='${item.id}'`).out;
ok(dbChoices === 'secreta,secreta,secreta', 'banco não guarda escolha individual secreta', dbChoices);
const closed = (await call('PATCH', `/voting/close/${item.id}`, { token: pA.accessToken })).data;
ok(closed.votesYes === 2 && closed.votesNo === 1 && closed.status === 'aprovado' && /^[0-9a-f]{64}$/.test(closed.resultHash), 'encerramento revela placar 2x1 + resultHash');
const ver = (await call('GET', `/voting/item/${item.id}/verify`, { token: pA.accessToken })).data;
ok(ver.valid === true, 'verificação da votação: íntegra', JSON.stringify(ver.problems));

console.log('\n[votação aberta]');
const item2 = (await call('POST', '/agenda', { token: pA.accessToken, body: { sessionId: sess.id, chamberId: chA, number: 'PL 2/2026', type: 'Projeto de Lei', title: 'Aberto', authorName: 'X', votingType: 'aberta', quorumMinimum: 1, orderIndex: 1 } })).data;
await call('PATCH', `/voting/open/${item2.id}`, { token: pA.accessToken });
await call('POST', '/voting/cast', { token: w2.accessToken, body: { agendaItemId: item2.id, choice: 'sim' } });
await call('POST', '/voting/cast', { token: w3.accessToken, body: { agendaItemId: item2.id, choice: 'abstencao' } });
const pub2 = (await call('GET', `/agenda/${item2.id}`)).data;
ok(pub2.votesYes === 1 && pub2.countsHidden === false, 'votação aberta mostra placar parcial');
await call('PATCH', `/voting/close/${item2.id}`, { token: pA.accessToken });
ok((await call('GET', `/voting/item/${item2.id}/verify`, { token: pA.accessToken })).data.valid === true, 'verificação votação aberta: íntegra');

console.log('\n[regimento: quórum, maiorias, presidente, PIN]');
const agendaItem = (fields) => call('POST', '/agenda', { token: pA.accessToken, body: { sessionId: sess.id, chamberId: chA, number: 'X', type: 'Projeto de Lei', title: 'T', authorName: 'X', votingType: 'aberta', quorumMinimum: 1, orderIndex: 9, ...fields } });
const rules0 = (await call('GET', `/chambers/${chA}/settings`, { token: pA.accessToken })).data;
ok(rules0.seats === 4 && rules0.defaultQuorum === 3 && rules0.sessionPhases.length === 7, 'regras padrão: 4 cadeiras (membros ativos), quórum 3, roteiro de 7 fases', JSON.stringify({ s: rules0.seats, q: rules0.defaultQuorum }));
ok((await call('PATCH', `/chambers/${chA}/settings`, { token: pB.accessToken, body: { totalSeats: 9 } })).status === 403, 'presidente B não altera regimento de A');
ok((await call('PATCH', `/chambers/${chA}/settings`, { token: pA.accessToken, body: { totalSeats: 99, majorityByType: { X: 'qualquer' } } })).status === 400, 'maioria inválida rejeitada');
const rules1 = (await call('PATCH', `/chambers/${chA}/settings`, { token: pA.accessToken, body: { totalSeats: 5, presidentVoteRule: 'tie_only', majorityByType: { 'Emenda à Lei Orgânica': 'dois_tercos' } } })).data;
ok(rules1.seats === 5 && rules1.presidentVoteRule === 'tie_only', 'presidente A configura 5 cadeiras e voto do presidente só no desempate');

const qItem = (await agendaItem({ title: 'Quórum alto', quorumMinimum: 9 })).data;
const qOpen = await call('PATCH', `/voting/open/${qItem.id}`, { token: pA.accessToken });
ok(qOpen.status === 400 && /Quórum insuficiente/.test(qOpen.data?.message), 'votação sem quórum não abre', qOpen.data?.message);

const eItem = (await agendaItem({ type: 'Emenda à Lei Orgânica', title: 'Emenda' })).data;
ok(eItem.majority === 'dois_tercos', 'maioria padrão por tipo de matéria (Emenda → 2/3)');
await call('PATCH', `/voting/open/${eItem.id}`, { token: pA.accessToken });
for (const t of [mob, w2, w3]) await call('POST', '/voting/cast', { token: t.accessToken, body: { agendaItemId: eItem.id, choice: 'sim' } });
const eClosed = (await call('PATCH', `/voting/close/${eItem.id}`, { token: pA.accessToken })).data;
ok(eClosed.status === 'rejeitado' && eClosed.requiredVotes === 4 && /exige 4 de 5/.test(eClosed.resultExplanation), '3 SIM não aprovam 2/3 de 5 cadeiras (exige 4)', eClosed.resultExplanation);

const tItem = (await agendaItem({ title: 'Empate' })).data;
await call('PATCH', `/voting/open/${tItem.id}`, { token: pA.accessToken });
await call('POST', '/voting/cast', { token: w2.accessToken, body: { agendaItemId: tItem.id, choice: 'sim' } });
const presEarly = await call('POST', '/voting/cast', { token: pA.accessToken, body: { agendaItemId: tItem.id, choice: 'sim' } });
ok(presEarly.status === 403 && /empate/.test(presEarly.data?.message), 'presidente não vota sem empate (regra tie_only)', presEarly.data?.message);
await call('POST', '/voting/cast', { token: w3.accessToken, body: { agendaItemId: tItem.id, choice: 'nao' } });
const tieClose = await call('PATCH', `/voting/close/${tItem.id}`, { token: pA.accessToken });
ok(tieClose.status === 409 && tieClose.data?.code === 'TIE_NEEDS_PRESIDENT', 'empate exige voto do presidente antes de encerrar', JSON.stringify(tieClose.data));
ok((await call('POST', '/voting/cast', { token: pA.accessToken, body: { agendaItemId: tItem.id, choice: 'sim' } })).status === 201, 'presidente desempata');
const tClosed = (await call('PATCH', `/voting/close/${tItem.id}`, { token: pA.accessToken })).data;
ok(tClosed.status === 'aprovado' && tClosed.votesYes === 2, 'aprovado 2x1 após desempate');
ok((await call('GET', `/voting/item/${tItem.id}/verify`, { token: pA.accessToken })).data.valid === true, 'verificação com maioria/requiredVotes no hash: íntegra');

console.log('\n[vice-presidente]');
const vp = (await call('POST', '/users', { token: pA.accessToken, body: { chamberId: chA, name: 'Vice Alfa', email: 'vp@t.com', password: 'senhaVice123', role: 'vice_presidente' } })).data;
ok(vp?.role === 'vice_presidente', 'presidente cadastra vice-presidente');
await call('PATCH', `/users/${v3.id}`, { token: pA.accessToken, body: { title: '1º Secretário(a)' } });
const ordem = (await call('GET', `/users/chamber/${chA}`, { token: pA.accessToken })).data.map(u => u.name);
ok(ordem.slice(0, 5).join(',') === 'Pres Alfa,Vice Alfa,Ver 3,Ver 1,Ver 2', 'painel: Mesa Diretora primeiro, depois ordem alfabética', ordem.join(','));
const ordemTablet = (await call('GET', '/chambers/by-slug/camara-alfa/vereadores')).data.map(u => u.name);
ok(ordemTablet.join(',') === 'Pres Alfa,Vice Alfa,Ver 3,Ver 1,Ver 2', 'tablet: Mesa Diretora primeiro, depois ordem alfabética', ordemTablet.join(','));
const wVp = await login('vp@t.com', 'senhaVice123');
ok(!!wVp?.accessToken, 'vice entra no painel');
ok((await call('PATCH', `/chambers/${chA}/settings`, { token: wVp.accessToken, body: { totalSeats: 7 } })).status === 403, 'vice não altera regras do regimento');
ok((await call('POST', '/users', { token: wVp.accessToken, body: { chamberId: chA, name: 'X', email: 'x2@t.com', password: 'senhaX12345', role: 'vereador' } })).status === 403, 'vice não cadastra membros');
ok((await call('POST', '/sessions', { token: wVp.accessToken, body: { chamberId: chA, number: 5, type: 'ordinaria', date: '2026-10-18' } })).status === 403, 'vice não cria sessão');
await call('POST', `/sessions/${sess.id}/presence`, { token: wVp.accessToken });
ok((await call('DELETE', '/sessions/leave', { token: pA.accessToken })).status === 200, 'presidente sai da sessão (vice passa a presidir)');
const vItem = (await agendaItem({ title: 'Vice preside' })).data;
ok((await call('PATCH', `/voting/open/${vItem.id}`, { token: wVp.accessToken })).status === 200, 'vice abre votação');
await call('POST', '/voting/cast', { token: w2.accessToken, body: { agendaItemId: vItem.id, choice: 'sim' } });
const vpEarly = await call('POST', '/voting/cast', { token: wVp.accessToken, body: { agendaItemId: vItem.id, choice: 'sim' } });
ok(vpEarly.status === 403 && /quem preside/.test(vpEarly.data?.message), 'vice presidindo segue a regra do desempate', vpEarly.data?.message);
await call('POST', '/voting/cast', { token: w3.accessToken, body: { agendaItemId: vItem.id, choice: 'nao' } });
const vTie = await call('PATCH', `/voting/close/${vItem.id}`, { token: wVp.accessToken });
ok(vTie.status === 409 && vTie.data?.code === 'TIE_NEEDS_PRESIDENT', 'empate exige voto de quem preside (vice)');
ok((await call('POST', '/voting/cast', { token: wVp.accessToken, body: { agendaItemId: vItem.id, choice: 'nao' } })).status === 201, 'vice desempata');
ok((await call('PATCH', `/voting/close/${vItem.id}`, { token: wVp.accessToken })).data?.status === 'rejeitado', 'vice encerra a votação (rejeitado 1x2)');
ok((await call('PATCH', `/sessions/${sess.id}/phase`, { token: wVp.accessToken, body: { phase: 'ordem_do_dia' } })).status === 200, 'vice conduz o roteiro');
ok((await call('POST', `/sessions/${sess.id}/presence`, { token: pA.accessToken })).status === 201, 'presidente volta à sessão');
const vItem2 = (await agendaItem({ title: 'Vice vota como membro' })).data;
await call('PATCH', `/voting/open/${vItem2.id}`, { token: pA.accessToken });
ok((await call('POST', '/voting/cast', { token: wVp.accessToken, body: { agendaItemId: vItem2.id, choice: 'sim' } })).status === 201, 'com o presidente presente, vice vota normalmente');
await call('PATCH', `/voting/close/${vItem2.id}`, { token: pA.accessToken });

await call('PATCH', `/chambers/${chA}/settings`, { token: pA.accessToken, body: { requirePinToVote: true } });
const pItem = (await agendaItem({ title: 'PIN' })).data;
await call('PATCH', `/voting/open/${pItem.id}`, { token: pA.accessToken });
const noPin = await call('POST', '/voting/cast', { token: mob.accessToken, body: { agendaItemId: pItem.id, choice: 'sim' } });
ok(noPin.status === 400 && noPin.data?.code === 'PIN_REQUIRED', 'câmara exige PIN: voto sem PIN recusado');
ok((await call('POST', '/voting/cast', { token: mob.accessToken, body: { agendaItemId: pItem.id, choice: 'sim', pin: '000000' } })).status === 401, 'PIN errado recusado');
ok((await call('POST', '/voting/cast', { token: mob.accessToken, body: { agendaItemId: pItem.id, choice: 'sim', pin: '482913' } })).status === 201, 'voto confirmado com PIN correto');
await call('PATCH', `/voting/close/${pItem.id}`, { token: pA.accessToken });
await call('PATCH', `/chambers/${chA}/settings`, { token: pA.accessToken, body: { requirePinToVote: false, presidentVoteRule: 'always' } });

console.log('\n[roteiro + expediente]');
ok((await call('PATCH', `/sessions/${sess.id}/phase`, { token: pB.accessToken, body: { phase: 'ordem_do_dia' } })).status === 403, 'presidente B não muda fase de A');
ok((await call('PATCH', `/sessions/${sess.id}/phase`, { token: pA.accessToken, body: { phase: 'inexistente' } })).status === 400, 'fase fora do roteiro recusada');
ok((await call('PATCH', `/sessions/${sess.id}/phase`, { token: pA.accessToken, body: { phase: 'grande_expediente' } })).data?.phase === 'grande_expediente', 'presidente avança para Grande Expediente');
await call('POST', `/expediente/sessions/${sess.id}/inscricoes/abrir/grande`, { token: pA.accessToken });
ok((await call('POST', `/expediente/sessions/${sess.id}/inscrever`, { token: w3.accessToken, body: { tipo: 'grande' } })).status === 201, 'vereador se inscreve no expediente');
const insc = (await call('GET', `/expediente/sessions/${sess.id}/inscritos`, { token: pA.accessToken })).data;
ok((await call('POST', `/expediente/sessions/${sess.id}/liberar/${insc[0].id}`, { token: pA.accessToken })).status === 201, 'presidente libera a fala');
await new Promise(r => setTimeout(r, 1200));
ok((await call('POST', `/expediente/sessions/${sess.id}/encerrar`, { token: pA.accessToken })).status === 200, 'presidente encerra a fala');
await call('PATCH', `/sessions/${sess.id}/phase`, { token: pA.accessToken, body: { phase: 'ordem_do_dia' } });

console.log('\n[socket: placar secreto]');
const { io } = await import('socket.io-client');
const sItem = (await call('POST', '/agenda', { token: pA.accessToken, body: { sessionId: sess.id, chamberId: chA, number: 'PL 3/2026', type: 'Projeto de Lei', title: 'Socket secreto', authorName: 'X', votingType: 'secreta', quorumMinimum: 1, orderIndex: 2 } })).data;
const events = [];
const sock = io(`${WS}/voting`, { transports: ['websocket'] }); // visitante (telão)
await new Promise(r => sock.on('connect', r));
sock.emit('session:join', { sessionId: sess.id });
for (const ev of ['voting:opened', 'vote:cast', 'voting:closed']) sock.on(ev, d => events.push([ev, d]));
await new Promise(r => setTimeout(r, 300));
await call('PATCH', `/voting/open/${sItem.id}`, { token: pA.accessToken });
await call('POST', '/voting/cast', { token: w3.accessToken, body: { agendaItemId: sItem.id, choice: 'nao' } });
const late = io(`${WS}/voting`, { transports: ['websocket'] }); // entra no meio da votação
const lateState = await new Promise(r => { late.on('connect', () => late.emit('session:join', { sessionId: sess.id })); late.on('voting:state', r); });
await call('PATCH', `/voting/close/${sItem.id}`, { token: pA.accessToken });
await new Promise(r => setTimeout(r, 800));
const sCast = events.find(e => e[0] === 'vote:cast')?.[1];
const sClosed = events.find(e => e[0] === 'voting:closed')?.[1];
ok(events.find(e => e[0] === 'voting:opened')?.[1]?.agendaItem?.countsHidden === true, 'voting:opened marca countsHidden');
ok(sCast && sCast.counts === null && sCast.totalVotes === 1 && sCast.choice === 'secreta', 'vote:cast secreto sem placar nem escolha');
ok(lateState.counts === null && lateState.item?.votesYes === null && lateState.totalVotes === 1, 'quem entra no meio não vê placar secreto');
ok(sClosed?.counts?.nao === 1 && /^[0-9a-f]{64}$/.test(sClosed?.resultHash ?? ''), 'voting:closed revela placar + resultHash');
sock.close(); late.close();

console.log('\n[imutabilidade + detecção de adulteração]');
const up = psql(`UPDATE votes SET choice='nao' WHERE "agendaItemId"='${item2.id}'`);
ok(up.err && /imutável/.test(up.err), 'UPDATE em votes bloqueado pelo banco');
const del = psql(`DELETE FROM audit_logs`);
ok(del.err && /imutável/.test(del.err), 'DELETE em audit_logs bloqueado pelo banco');
const tr = psql(`TRUNCATE votes CASCADE`);
ok(tr.err && /imutável/.test(tr.err), 'TRUNCATE em votes bloqueado');
psql(`UPDATE agenda_items SET "votesYes" = 9 WHERE id='${item.id}'`);
const ver2 = (await call('GET', `/voting/item/${item.id}/verify`, { token: pA.accessToken })).data;
ok(ver2.valid === false && ver2.problems.length > 0, 'placar adulterado no banco é detectado', JSON.stringify(ver2.problems));
psql(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable; UPDATE audit_logs SET detail = '{"choice":"x"}' WHERE id = (SELECT id FROM audit_logs WHERE "chamberId"='${chA}' ORDER BY seq LIMIT 1 OFFSET 2); ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable;`);
const av = (await call('GET', `/audit/chamber/${chA}/verify`, { token: pA.accessToken })).data;
ok(av.valid === false && /alterado/.test(av.reason), 'auditoria adulterada (com trigger desligado) é detectada', JSON.stringify(av));
ok((await call('GET', `/audit/chamber/${chA}/verify`, { token: pB.accessToken })).status === 403, 'presidente B não lê auditoria de A');
const avB = (await call('GET', `/audit/chamber/${chB}/verify`, { token: pB.accessToken })).data;
ok(avB.valid === true, 'cadeia de auditoria da câmara B íntegra', JSON.stringify(avB));

console.log('\n[tokens]');
const rf = await call('POST', '/auth/refresh', { body: { refreshToken: mob.refreshToken } });
ok(rf.status === 200, 'refresh mobile ok');
const payload = JSON.parse(Buffer.from(rf.data.accessToken.split('.')[1], 'base64url').toString());
ok(!!payload.mobileDevice && !!payload.device, 'token renovado mantém vínculo com tablet');
ok((await call('POST', '/auth/refresh', { body: { refreshToken: mob.refreshToken } })).status === 401, 'reuso de refresh token = 401');
ok((await call('POST', '/auth/refresh', { body: { refreshToken: rf.data.refreshToken } })).status === 401, 'após reuso, toda a família é revogada');
const mob2 = (await ml('482913', KEY1)).data;
ok((await call('GET', '/users/me', { token: mob2.accessToken })).status === 200, 'novo login mobile ok');
await call('PATCH', `/devices/${devs[0].id}/revoke`, { token: pA.accessToken });
ok((await call('GET', '/users/me', { token: mob2.accessToken })).status === 401, 'tablet bloqueado derruba token na hora');
ok((await ml('482913', KEY1)).status === 403, 'tablet bloqueado não loga');
await call('PATCH', `/users/${v2.id}`, { token: pA.accessToken, body: { isActive: false } });
ok((await call('GET', '/users/me', { token: w2.accessToken })).status === 401, 'conta desativada perde acesso na hora');
const tokRow = psql(`SELECT length(token) FROM refresh_tokens LIMIT 1`).out;
ok(tokRow === '64', 'refresh token guardado como hash sha256', tokRow);

console.log('\n[brute force PIN]');
await call('PATCH', `/users/${v3.id}/pin`, { token: pA.accessToken, body: { pin: '739154' } });
const st = [];
for (let i = 0; i < 6; i++) st.push((await call('POST', '/auth/mobile-login', { body: { userId: v3.id, pin: '000000', deviceKey: KEY2, deviceName: 'x' } })).status);
ok(st.slice(0, 5).every(s => s === 401) && st[5] === 429, 'bloqueio após 5 PINs errados', st.join(','));

console.log('\n[ata automática]');
ok((await call('PATCH', `/sessions/${sess.id}/end`, { token: pA.accessToken })).status === 200, 'presidente encerra a sessão');
const ata1 = (await call('GET', `/sessions/${sess.id}/ata`)).data;
const ata2 = (await call('GET', `/sessions/${sess.id}/ata`)).data;
ok(/^[0-9a-f]{64}$/.test(ata1.documentHash) && ata1.documentHash === ata2.documentHash, 'ata com hash do documento estável');
ok(ata1.roteiro.some(r => r.evento === 'Abertura da sessão') && ata1.roteiro.some(r => r.evento === 'Grande Expediente') && ata1.roteiro.some(r => r.evento === 'Encerramento da sessão'), 'ata registra o roteiro com horários');
ok(ata1.falas.some(f => f.evento === 'fala:iniciada') && ata1.falas.some(f => f.evento === 'fala:encerrada' && f.detalhe.motivo === 'encerrado_presidente'), 'ata registra falas do expediente');
ok(ata1.presentes.some(p => p.name === 'Pres Alfa') && ata1.ausentes.length === 0, 'ata lista presentes e ausentes');
const ataTie = ata1.votacoes.find(v => v.title === 'Empate');
ok(ataTie?.nominal?.length === 3 && ataTie.explanation && ataTie.resultHash, 'ata traz votação nominal, explicação e hash do resultado');
const ataSecret = ata1.votacoes.find(v => v.title === 'Secreto');
ok(ataSecret && ataSecret.nominal === null && ataSecret.votantes.length === 3, 'ata de votação secreta lista só quem votou');

console.log('\n[portal de transparência]');
const sum = (await call('GET', `/public/chambers/${chA}`)).data;
const presA = sum.membros?.find(m => m.name === 'Pres Alfa');
ok(sum.totais?.sessoes === 1 && presA?.taxaPresenca === 100 && !('email' in presA), 'resumo público: presença por membro, sem e-mail');
const pubList = (await call('GET', `/public/chambers/${chA}/votacoes`)).data;
ok(Array.isArray(pubList) && pubList.length >= 5 && pubList.every(v => ['aprovado', 'rejeitado'].includes(v.status)), 'lista pública só de votações encerradas');
const pubOpen = (await call('GET', `/public/votacoes/${item2.id}`)).data;
ok(pubOpen.nominal?.length === 2 && pubOpen.verificacao.valid === true, 'votação aberta: nominal + verificação pública íntegra');
const pubSecret = (await call('GET', `/public/votacoes/${item.id}`)).data;
ok(pubSecret.nominal === null && pubSecret.verificacao.valid === false, 'votação secreta sem nominal; adulteração aparece na verificação pública');
ok((await call('GET', `/public/votacoes/${qItem.id}`)).status === 404, 'votação não encerrada não aparece no portal');
const prof = (await call('GET', `/public/chambers/${chA}/vereadores/${v3.id}`)).data;
ok(Array.isArray(prof.votos) && prof.votos.every(v => v.choice !== 'secreta'), 'perfil do vereador: só votos de votação aberta');
const csvRes = await fetch(`${B}/public/chambers/${chA}/dados/votacoes.csv`);
const csvTxt = await csvRes.text();
ok(/text\/csv/.test(csvRes.headers.get('content-type')) && csvTxt.includes('sessao;data_sessao;numero'), 'dados abertos em CSV');
ok((await fetch(`${B}/public/chambers/${chA}/dados/senhas.csv`)).status === 404, 'CSV inexistente = 404');

console.log('\n[headers]');
const h = await fetch(B + '/health');
ok(h.headers.get('x-frame-options') === 'DENY' && h.headers.get('x-content-type-options') === 'nosniff' && !h.headers.get('x-powered-by'), 'headers de segurança na API');

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
