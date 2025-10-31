import signify, { HabState, Serder, SignifyClient } from '#signify-ts';
import {
    acceptMultisigIncept,
    acceptRotation,
    rotate,
    startMultisigIncept,
} from './utils/multisig-utils.ts';
import {
    createClient,
    createIdentifier,
    resolveOobi,
    waitAndMarkNotification,
    waitOperation,
} from './utils/test-util.ts';
import { assert, beforeAll, expect, test } from 'vitest';

const nameMember1 = 'member1';
const nameMember2 = 'member2';
const nameMember3 = 'member3';
const multisigName = 'multisigGroup';

let client1: SignifyClient;
let client2: SignifyClient;
let client3: SignifyClient;
let aid1: HabState;
let aid2: HabState;
let aid3: HabState;

beforeAll(async () => {
    await signify.ready();
});

test('Create clients', async () => {
    [client1, client2, client3] = await Promise.all([
        createClient(),
        createClient(),
        createClient(),
    ]);
});

test('Create single sig members', async () => {
    [aid1, aid2] = await Promise.all([
        createIdentifier(client1, nameMember1),
        createIdentifier(client2, nameMember2),
    ]);
});

test('Resolve oobis for single sig members', async () => {
    const [oobi1, oobi2] = await Promise.all([
        client1.oobis().get(nameMember1, 'agent'),
        client2.oobis().get(nameMember2, 'agent'),
    ]);

    await resolveOobi(client1, oobi2.oobis[0], nameMember2);
    await resolveOobi(client2, oobi1.oobis[0], nameMember1);
});

test('should create multisig', async () => {
    const op1 = await startMultisigIncept(client1, {
        groupName: multisigName,
        localMemberName: aid1.name,
        participants: [aid1.prefix, aid2.prefix],
        isith: 1,
        nsith: 1,
        toad: aid1.state.b.length,
        wits: aid1.state.b,
    });

    const msgSaid = await waitAndMarkNotification(client2, '/multisig/icp');
    await acceptMultisigIncept(client2, {
        groupName: multisigName,
        localMemberName: aid2.name,
        msgSaid,
    });

    await waitOperation(client1, op1);
});

test('should add agent end roles to multisig', async () => {
    const members1 = await client1.identifiers().members(multisigName);
    const members2 = await client2.identifiers().members(multisigName);
    const eid1 = Object.keys(members1.signing[0].ends.agent)[0];
    const eid2 = Object.keys(members2.signing[1].ends.agent)[0];

    const [endRoleOperation1, endRoleOperation2] = await Promise.all([
        client1.identifiers().addEndRole(multisigName, 'agent', eid1),
        client2.identifiers().addEndRole(multisigName, 'agent', eid2),
    ]);

    await waitOperation(client1, await endRoleOperation1.op());
    await waitOperation(client2, await endRoleOperation2.op());
});

test('should add member3 to multisig', async () => {
    aid3 = await createIdentifier(client3, nameMember3);
});

test('Resolve oobis', async () => {
    const [oobi1, oobi2, oobi3, oobi4] = await Promise.all([
        client1.oobis().get(nameMember1, 'agent'),
        client2.oobis().get(nameMember2, 'agent'),
        client3.oobis().get(nameMember3, 'agent'),
        client1.oobis().get(multisigName, 'agent'),
    ]);

    const oobiMultisig = oobi4.oobis[0].split('/agent/')[0];

    const [opOobi1, opOobi2, opOobi3, opOobi4, opOobi5] = await Promise.all([
        client1.oobis().resolve(oobi3.oobis[0], nameMember3),
        client2.oobis().resolve(oobi3.oobis[0], nameMember3),
        client3.oobis().resolve(oobi1.oobis[0], nameMember1),
        client3.oobis().resolve(oobi2.oobis[0], nameMember2),
        client3.oobis().resolve(oobiMultisig, multisigName),
    ]);

    await Promise.all([
        waitOperation(client1, opOobi1),
        waitOperation(client2, opOobi2),
        waitOperation(client3, opOobi3),
        waitOperation(client3, opOobi4),
        waitOperation(client3, opOobi5),
    ]);
});

test('Rotate to get member1 and member2 to current keys', async () => {
    const [rotateResult1, rotateResult2] = await Promise.all([
        client1.identifiers().rotate(nameMember1),
        client2.identifiers().rotate(nameMember2),
    ]);

    await Promise.all([
        waitOperation(client1, await rotateResult1.op()),
        waitOperation(client2, await rotateResult2.op()),
    ]);

    [aid1, aid2] = await Promise.all([
        client1.identifiers().get(nameMember1),
        client2.identifiers().get(nameMember2),
    ]);

    assert.equal(aid1.state.s, '1');
    assert.equal(aid2.state.s, '1');
});

test("Rotate multisig to get member1 and member2's current keys", async () => {
    const updates = await Promise.all([
        client1.keyStates().query(aid2.prefix, '1'),
        client1.keyStates().query(aid3.prefix, '0'),
        client2.keyStates().query(aid1.prefix, '1'),
        client2.keyStates().query(aid3.prefix, '0'),
        client3.keyStates().query(aid1.prefix, '1'),
        client3.keyStates().query(aid2.prefix, '1'),
    ]);

    await Promise.all([
        waitOperation(client1, updates[0]),
        waitOperation(client1, updates[1]),
        waitOperation(client2, updates[2]),
        waitOperation(client2, updates[3]),
        waitOperation(client3, updates[4]),
        waitOperation(client3, updates[5]),
    ]);

    await rotate(client1, {
        group: await client1.identifiers().get(multisigName),
        smids: [aid1.prefix, aid2.prefix],
        rmids: [aid1.prefix, aid2.prefix, aid3.prefix],
    });
});

test('Member 2 joins', async () => {
    const said = await waitAndMarkNotification(client2, '/multisig/rot');
    const op = await acceptRotation(client2, { said });
    await waitOperation(client2, op);

    const multisigAid = await client2.identifiers().get(multisigName);

    assert.equal(multisigAid.state.k.length, 2);
    assert.equal(multisigAid.state.k[0], aid1.state.k[0]);
    assert.equal(multisigAid.state.k[1], aid2.state.k[0]);

    assert.equal(multisigAid.state.n.length, 3);
    assert.equal(multisigAid.state.n[0], aid1.state.n[0]);
    assert.equal(multisigAid.state.n[1], aid2.state.n[0]);
    assert.equal(multisigAid.state.n[2], aid3.state.n[0]);
});

test('Member 3 joins', async () => {
    const said = await waitAndMarkNotification(client3, '/multisig/rot');

    const response = await client3.groups().getRequest(said);
    const exn = response[0].exn;

    const serder = new Serder(exn.e.rot);
    const keeper = client3.manager!.get(aid3);
    const sigs = await keeper.sign(signify.b(serder.raw));

    const op = await client3
        .groups()
        .join(multisigName, serder, sigs, exn.a.gid, exn.a.smids, exn.a.rmids);

    await waitOperation(client3, op);

    const multisigAid = await client3.identifiers().get(multisigName);

    assert.equal(multisigAid.state.k.length, 2);
    assert.equal(multisigAid.state.k[0], aid1.state.k[0]);
    assert.equal(multisigAid.state.k[1], aid2.state.k[0]);

    assert.equal(multisigAid.state.n.length, 3);
    assert.equal(multisigAid.state.n[0], aid1.state.n[0]);
    assert.equal(multisigAid.state.n[1], aid2.state.n[0]);
    assert.equal(multisigAid.state.n[2], aid3.state.n[0]);
});

test('Rotate again to get aid3 to current signing keys and join', async () => {
    const [rotateResult1, rotateResult2, rotateResult3] = await Promise.all([
        client1.identifiers().rotate(nameMember1),
        client2.identifiers().rotate(nameMember2),
        client3.identifiers().rotate(nameMember3),
    ]);

    await Promise.all([
        waitOperation(client1, await rotateResult1.op()),
        waitOperation(client2, await rotateResult2.op()),
        waitOperation(client3, await rotateResult3.op()),
    ]);

    [aid1, aid2, aid3] = await Promise.all([
        client1.identifiers().get(nameMember1),
        client2.identifiers().get(nameMember2),
        client3.identifiers().get(nameMember3),
    ]);

    const updates = await Promise.all([
        await client1.keyStates().query(aid2.prefix, '2'),
        await client1.keyStates().query(aid3.prefix, '1'),
        await client2.keyStates().query(aid1.prefix, '2'),
        await client2.keyStates().query(aid3.prefix, '1'),
        await client3.keyStates().query(aid1.prefix, '2'),
        await client3.keyStates().query(aid2.prefix, '2'),
    ]);

    await Promise.all([
        waitOperation(client1, updates[0]),
        waitOperation(client1, updates[1]),
        waitOperation(client2, updates[2]),
        waitOperation(client2, updates[3]),
        waitOperation(client3, updates[4]),
        waitOperation(client3, updates[5]),
    ]);
});

test('Member 1 rotates', async () => {
    const op = await rotate(client1, {
        group: await client1.identifiers().get(multisigName),
        smids: [aid1.prefix, aid2.prefix, aid3.prefix],
        rmids: [aid1.prefix, aid2.prefix, aid3.prefix],
    });

    await waitOperation(client1, op);
});

test('Member 2 joins rotation', async () => {
    const said = await waitAndMarkNotification(client2, '/multisig/rot');
    const op = await acceptRotation(client2, { said });
    await waitOperation(client2, op);
});

test('Member 3 joins rotation', async () => {
    const said = await waitAndMarkNotification(client3, '/multisig/rot');
    const op = await acceptRotation(client3, { said });
    await waitOperation(client3, op);

    const group = await client3.identifiers().get(multisigName);
    assert.equal(group.state.s, '2');

    assert.equal(group.state.k.length, 3);
    assert.equal(group.state.k[0], aid1.state.k[0]);
    assert.equal(group.state.k[1], aid2.state.k[0]);
    assert.equal(group.state.k[2], aid3.state.k[0]);

    assert.equal(group.state.n.length, 3);
    assert.equal(group.state.n[0], aid1.state.n[0]);
    assert.equal(group.state.n[1], aid2.state.n[0]);
    assert.equal(group.state.n[2], aid3.state.n[0]);

    const members = await client3.identifiers().members(multisigName);

    expect(members.signing[0].aid).toEqual(aid1.prefix);
    expect(members.signing[1].aid).toEqual(aid2.prefix);
    expect(members.signing[2].aid).toEqual(aid3.prefix);
    expect(members.rotation[0].aid).toEqual(aid1.prefix);
    expect(members.rotation[1].aid).toEqual(aid2.prefix);
    expect(members.rotation[2].aid).toEqual(aid3.prefix);
});

test('Add agent end role for member3', async () => {
    const members = await client3.identifiers().members(multisigName);

    const eid = Object.keys(members.signing[2].ends.agent)[0];
    const endRoleOperation = await client3
        .identifiers()
        .addEndRole(multisigName, 'agent', eid);

    await waitOperation(client3, await endRoleOperation.op());
});
