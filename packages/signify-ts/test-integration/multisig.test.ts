import { assert, beforeAll, test, describe, expect } from 'vitest';
import signify, {
    SignifyClient,
    Serder,
    HabState,
    CredentialResult,
} from '#signify-ts';
import { resolveEnvironment } from './utils/resolve-env.ts';
import {
    assertNotifications,
    assertOperations,
    createIdentifier,
    createTimestamp,
    getOrCreateClient,
    resolveOobi,
    waitAndMarkNotification,
    waitOperation,
} from './utils/test-util.ts';
import {
    acceptMultisigIncept,
    acceptRotation,
    addEndRoleMultisig,
    multisigIssue,
    multisigRevoke,
    rotate,
    startMultisigIncept,
} from './utils/multisig-utils.ts';
import { retry } from './utils/retry.ts';

const { vleiServerUrl, witnessIds: WITNESS_AIDS } = resolveEnvironment();

const SCHEMA_SAID = 'EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao';
const SCHEMA_OOBI = `${vleiServerUrl}/oobi/${SCHEMA_SAID}`;
const vcdata = {
    LEI: '5493001KJTIIGC8Y1R17',
};

const wits = WITNESS_AIDS.slice(1);
let client1: SignifyClient;
let client2: SignifyClient;
let client3: SignifyClient;
let client4: SignifyClient;

let aid1: HabState;
let aid2: HabState;
let aid3: HabState;
let aid4: HabState;
let oobi1: { oobis: string[] };
let oobi2: { oobis: string[] };
let oobi3: { oobis: string[] };
let oobi4: { oobis: string[] };
let smids: string[];
let groupPrefix: string;

let regk: string;

beforeAll(async () => {
    await signify.ready();
});

test('Create clients', async () => {
    [client1, client2, client3, client4] = await Promise.all([
        getOrCreateClient(),
        getOrCreateClient(),
        getOrCreateClient(),
        getOrCreateClient(),
    ]);
});

test('Create aids', async () => {
    [aid1, aid2, aid3, aid4] = await Promise.all([
        createIdentifier(client1, 'member1', { toad: 1, wits }),
        createIdentifier(client2, 'member2', { toad: 1, wits }),
        createIdentifier(client3, 'member3', { toad: 1, wits }),
        createIdentifier(client4, 'holder', { toad: 1, wits }),
    ]);

    smids = [aid1.prefix, aid2.prefix, aid3.prefix];
});

test('Create oobis', async () => {
    [oobi1, oobi2, oobi3, oobi4] = await Promise.all([
        client1.oobis().get('member1', 'agent'),
        client2.oobis().get('member2', 'agent'),
        client3.oobis().get('member3', 'agent'),
        client4.oobis().get('holder', 'agent'),
    ]);
});

test('Resolve oobis for member 1', async () => {
    await resolveOobi(client1, oobi2.oobis[0], 'member2');
    await resolveOobi(client1, oobi3.oobis[0], 'member3');
    await resolveOobi(client1, SCHEMA_OOBI, 'schema');
    await resolveOobi(client1, oobi4.oobis[0], 'holder');
});

test('Resolve oobis for member 2', async () => {
    await resolveOobi(client2, oobi1.oobis[0], 'member1');
    await resolveOobi(client2, oobi3.oobis[0], 'member3');
    await resolveOobi(client2, SCHEMA_OOBI, 'schema');
    await resolveOobi(client2, oobi4.oobis[0], 'holder');
});

test('Resolve oobis for member 3', async () => {
    await resolveOobi(client3, oobi1.oobis[0], 'member1');
    await resolveOobi(client3, oobi2.oobis[0], 'member2');
    await resolveOobi(client3, SCHEMA_OOBI, 'schema');
    await resolveOobi(client3, oobi4.oobis[0], 'holder');
});

test('Resolve oobis for holder', async () => {
    await resolveOobi(client4, oobi1.oobis[0], 'member1');
    await resolveOobi(client4, oobi2.oobis[0], 'member2');
    await resolveOobi(client4, oobi3.oobis[0], 'member3');
    await resolveOobi(client4, SCHEMA_OOBI, 'schema');
});

describe('MFA Challenge for members', () => {
    let words: string[];

    test('Create challenge', async () => {
        words = (await client1.challenges().generate(128)).words;
    });

    test('Member 1 verifies member 2', { concurrent: true }, async () => {
        const op1 = await client1.challenges().verify(aid2.prefix, words);
        const result = await waitOperation(client1, op1);

        assert(result.response);
        assert(typeof result.response === 'object');
        assert('exn' in result.response);
        assert(typeof result.response.exn === 'object');
        assert(result.response.exn);
        assert('d' in result.response.exn);
        assert(typeof result.response.exn.d === 'string');

        await client1
            .challenges()
            .responded(aid2.prefix, result.response.exn.d);
    });

    test('Member 1 verifies member 3', { concurrent: true }, async () => {
        const op1 = await client1.challenges().verify(aid3.prefix, words);
        const result = await waitOperation(client1, op1);

        assert(result.response);
        assert(typeof result.response === 'object');
        assert('exn' in result.response);
        assert(typeof result.response.exn === 'object');
        assert(result.response.exn);
        assert('d' in result.response.exn);
        assert(typeof result.response.exn.d === 'string');

        await client1
            .challenges()
            .responded(aid3.prefix, result.response.exn.d);
    });

    test('Member 2 respond', { concurrent: true }, async () => {
        await client2.challenges().respond('member2', aid1.prefix, words);
    });

    test('Member 3 respond', { concurrent: true }, async () => {
        await client3.challenges().respond('member3', aid1.prefix, words);
    });
});

describe('Multisig inception', () => {
    test('Member 1', { concurrent: true }, async () => {
        const op1 = await startMultisigIncept(client1, {
            groupName: 'multisig',
            localMemberName: 'member1',
            participants: [aid1.prefix, aid2.prefix, aid3.prefix],
            isith: 2,
            nsith: 2,
            toad: aid1.state.b.length,
            wits: aid1.state.b,
        });

        await waitOperation(client1, op1);
    });

    test('Member 2', { concurrent: true }, async () => {
        const said = await waitAndMarkNotification(client2, '/multisig/icp');
        const op2 = await acceptMultisigIncept(client2, {
            localMemberName: 'member2',
            groupName: 'multisig',
            msgSaid: said,
        });

        await waitOperation(client2, op2);
    });

    test('Member 3', { concurrent: true }, async () => {
        const said = await waitAndMarkNotification(client3, '/multisig/icp');
        const op3 = await acceptMultisigIncept(client3, {
            localMemberName: 'member3',
            groupName: 'multisig',
            msgSaid: said,
        });

        await waitOperation(client3, op3);
    });

    test('Check group prefix', async () => {
        const group1 = await client1.identifiers().get('multisig');
        const group2 = await client1.identifiers().get('multisig');
        const group3 = await client1.identifiers().get('multisig');

        assert.equal(group1.prefix, group2.prefix);
        assert.equal(group1.prefix, group3.prefix);
        groupPrefix = group1.prefix;
    });
});

test('Clear notifications', async () => {
    await assertNotifications(client1);
    await assertNotifications(client2);
    await assertNotifications(client3);
});

test('Clear operations', async () => {
    await assertOperations(client1);
    await assertOperations(client2);
    await assertOperations(client3);
});

test('Verify multisig group', async () => {
    const identifiers1 = await client1.identifiers().list();
    assert.equal(identifiers1.aids.length, 2);
    assert.equal(identifiers1.aids[0].name, 'member1');
    assert.equal(identifiers1.aids[1].name, 'multisig');

    const identifiers2 = await client2.identifiers().list();
    assert.equal(identifiers2.aids.length, 2);
    assert.equal(identifiers2.aids[0].name, 'member2');
    assert.equal(identifiers2.aids[1].name, 'multisig');

    const identifiers3 = await client3.identifiers().list();
    assert.equal(identifiers3.aids.length, 2);
    assert.equal(identifiers3.aids[0].name, 'member3');
    assert.equal(identifiers3.aids[1].name, 'multisig');
});

test('Authorize agent end roles', async () => {
    const stamp = createTimestamp();

    const ghab1 = await client1.identifiers().get('multisig');
    const ops1 = await addEndRoleMultisig(client1, ghab1, stamp);

    const ghab2 = await client2.identifiers().get('multisig');
    const ops2 = await addEndRoleMultisig(client2, ghab2, stamp);

    const ghab3 = await client3.identifiers().get('multisig');
    const ops3 = await addEndRoleMultisig(client3, ghab3, stamp);

    for (const op of ops1) {
        await client1.operations().wait(op);
    }

    for (const op of ops2) {
        await client2.operations().wait(op);
    }

    for (const op of ops3) {
        await client3.operations().wait(op);
    }

    await waitAndMarkNotification(client2, '/multisig/rpy');
    await waitAndMarkNotification(client3, '/multisig/rpy');
});

test('Clear notifications', async () => {
    await assertNotifications(client1);
    await assertNotifications(client2);
    await assertNotifications(client3);
});

test('Create multisig OOBI', async () => {
    const oobimultisig = await client1.oobis().get('multisig', 'agent');
    expect(oobimultisig.oobis.length).toBeGreaterThan(0);
    const oobiurl = oobimultisig.oobis[0].split('/agent/')[0];
    await resolveOobi(client4, oobiurl, 'multisig');
});

describe('Multisig interaction', () => {
    const data = {
        i: 'EBgew7O4yp8SBle0FU-wwN3GtnaroI0BQfBGAj33QiIG',
        s: '0',
        d: 'EBgew7O4yp8SBle0FU-wwN3GtnaroI0BQfBGAj33QiIG',
    };

    test('Member 1', { concurrent: true }, async () => {
        const ixn1 = await client1.identifiers().interact('multisig', data);
        const op1 = await ixn1.op();

        const ims1 = signify.d(
            signify.messagize(
                ixn1.serder,
                ixn1.sigs.map((sig) => new signify.Siger({ qb64: sig }))
            )
        );

        for (const smid of smids) {
            await client1.exchanges().send(
                'member1',
                'multisig',
                aid1,
                '/multisig/ixn',
                { gid: ixn1.serder.pre, smids: smids, rmids: smids },
                {
                    ixn: [ixn1.serder, ims1.substring(ixn1.serder.size)],
                },
                smid
            );
        }

        await waitOperation(client1, op1);
    });

    test('Member 2 ', { concurrent: true }, async () => {
        const msgSaid2 = await waitAndMarkNotification(
            client2,
            '/multisig/ixn'
        );
        const res2 = await client2.groups().getRequest(msgSaid2);

        const ixn2 = await client2
            .identifiers()
            .interact('multisig', res2[0].exn.e.ixn.a);
        const op2 = await ixn2.op();

        const ims2 = signify.d(
            signify.messagize(
                ixn2.serder,
                ixn2.sigs.map((sig) => new signify.Siger({ qb64: sig }))
            )
        );

        for (const smid of smids) {
            await client2.exchanges().send(
                'member2',
                'multisig',
                aid2,
                '/multisig/ixn',
                { gid: ixn2.serder.pre, smids: smids, rmids: smids },
                {
                    ixn: [ixn2.serder, ims2.substring(ixn2.serder.size)],
                },
                smid
            );
        }

        await waitOperation(client2, op2);
    });

    test('Member 3 joins', { concurrent: true }, async () => {
        const msgSaid3 = await waitAndMarkNotification(
            client3,
            '/multisig/ixn'
        );

        const res3 = await client3.groups().getRequest(msgSaid3);

        const ixn3 = await client3
            .identifiers()
            .interact('multisig', res3[0].exn.e.ixn.a);
        const op3 = await ixn3.op();

        const ims3 = signify.d(
            signify.messagize(
                ixn3.serder,
                ixn3.sigs.map((sig) => new signify.Siger({ qb64: sig }))
            )
        );

        for (const smid of smids) {
            await client3.exchanges().send(
                'member3',
                'multisig',
                aid3,
                '/multisig/ixn',
                { gid: ixn3.serder.pre, smids: smids, rmids: smids },
                {
                    ixn: [ixn3.serder, ims3.substring(ixn3.serder.size)],
                },
                smid
            );
        }

        await waitOperation(client3, op3);
    });
});

describe('Multisig key rotation', () => {
    test('Member key rotation', async (s) => {
        const rot1 = await client1.identifiers().rotate('member1');
        await waitOperation(client1, await rot1.op(), s.signal);
        aid1 = await client1.identifiers().get('member1');

        const rot2 = await client2.identifiers().rotate('member2');
        await waitOperation(client2, await rot2.op(), s.signal);
        aid2 = await client2.identifiers().get('member2');

        const rot3 = await client3.identifiers().rotate('member3');
        await waitOperation(client3, await rot3.op(), s.signal);
        aid3 = await client3.identifiers().get('member3');
    });

    test('Update new key states', async (s) => {
        await Promise.all([
            waitOperation(
                client1,
                await client1.keyStates().query(aid2.prefix, '1'),
                s.signal
            ),
            waitOperation(
                client1,
                await client1.keyStates().query(aid3.prefix, '1'),
                s.signal
            ),
            waitOperation(
                client2,
                await client2.keyStates().query(aid1.prefix, '1'),
                s.signal
            ),
            waitOperation(
                client2,
                await client2.keyStates().query(aid3.prefix, '1'),
                s.signal
            ),
            waitOperation(
                client3,
                await client3.keyStates().query(aid1.prefix, '1'),
                s.signal
            ),
            waitOperation(
                client3,
                await client3.keyStates().query(aid2.prefix, '1'),
                s.signal
            ),
            waitOperation(
                client4,
                await client4.keyStates().query(aid1.prefix, '1'),
                s.signal
            ),
            waitOperation(
                client4,
                await client4.keyStates().query(aid2.prefix, '1'),
                s.signal
            ),
            waitOperation(
                client4,
                await client4.keyStates().query(aid3.prefix, '1'),
                s.signal
            ),
        ]);
    });

    test('Member 1 initiate rotation', { concurrent: true }, async () => {
        const op1 = await rotate(client1, {
            group: await client1.identifiers().get('multisig'),
            smids: [aid1.prefix, aid2.prefix, aid3.prefix],
            rmids: [aid1.prefix, aid2.prefix, aid3.prefix],
        });

        await waitOperation(client1, op1);
    });

    test('Member 2 joins rotation', { concurrent: true }, async () => {
        const said = await waitAndMarkNotification(client2, '/multisig/rot');
        const op = await acceptRotation(client2, { said });
        await waitOperation(client2, op);
    });

    test('Member 3 joins rotation', { concurrent: true }, async () => {
        const said = await waitAndMarkNotification(client3, '/multisig/rot');
        const op = await acceptRotation(client3, { said });
        await waitOperation(client3, op);
    });

    test('Verify multisig group after rotation', async () => {
        const group = await client2.identifiers().get('multisig');

        assert.equal(group.state.k.length, 3);
        assert.equal(group.state.k[0], aid1.state.k[0]);
        assert.equal(group.state.k[1], aid2.state.k[0]);
        assert.equal(group.state.k[2], aid3.state.k[0]);

        assert.equal(group.state.n.length, 3);
        assert.equal(group.state.n[0], aid1.state.n[0]);
        assert.equal(group.state.n[1], aid2.state.n[0]);
        assert.equal(group.state.n[2], aid3.state.n[0]);
    });

    test('Ensure no pending operations', async () => {
        await assertOperations(client1);
        await assertOperations(client2);
        await assertOperations(client3);
    });

    test('Ensure no unread notifications', async () => {
        await assertNotifications(client1);
        await assertNotifications(client2);
        await assertNotifications(client3);
    });
});

describe('Multisig registry creation', () => {
    test('Member 1', { concurrent: true }, async () => {
        const group = await client1.identifiers().get('multisig');

        const vcp1 = await client1.registries().create({
            name: 'multisig',
            registryName: 'vLEI Registry',
            nonce: 'AHSNDV3ABI6U8OIgKaj3aky91ZpNL54I5_7-qwtC6q2s',
        });

        const op1 = await vcp1.op();
        const ims1 = signify.d(
            signify.messagize(
                vcp1.serder,
                vcp1.sigs.map((sig) => new signify.Siger({ qb64: sig }))
            )
        );

        await Promise.all(
            smids.map(async (smid) =>
                client1.exchanges().send(
                    'member1',
                    'registry',
                    aid1,
                    '/multisig/vcp',
                    { gid: group.prefix, usage: 'Issue vLEIs' },
                    {
                        vcp: [vcp1.regser, ''],
                        anc: [vcp1.serder, ims1.substring(vcp1.serder.size)],
                    },
                    smid
                )
            )
        );

        await waitOperation(client1, op1);
    });

    test('Member 2', { concurrent: true }, async () => {
        const group = await client2.identifiers().get('multisig');
        // Member2 check for notifications and join the create registry event
        const msgSaid2 = await waitAndMarkNotification(
            client2,
            '/multisig/vcp'
        );

        // TODO: Get nonce from exn
        await client2.groups().getRequest(msgSaid2);

        const vcp2 = await client2.registries().create({
            name: 'multisig',
            registryName: 'vLEI Registry',
            nonce: 'AHSNDV3ABI6U8OIgKaj3aky91ZpNL54I5_7-qwtC6q2s',
        });

        const op2 = await vcp2.op();
        const ims2 = signify.d(
            signify.messagize(
                vcp2.serder,
                vcp2.sigs.map((sig) => new signify.Siger({ qb64: sig }))
            )
        );

        await Promise.all(
            smids.map(async (smid) =>
                client2.exchanges().send(
                    'member2',
                    'registry',
                    aid2,
                    '/multisig/vcp',
                    { gid: group.prefix, usage: 'Issue vLEIs' },
                    {
                        vcp: [vcp2.regser, ''],
                        anc: [vcp2.serder, ims2.substring(vcp2.serder.size)],
                    },
                    smid
                )
            )
        );

        await waitOperation(client2, op2);
    });

    test('Member 3', { concurrent: true }, async () => {
        const group = await client3.identifiers().get('multisig');

        // Member3 check for notifications and join the create registry event
        const msgSaid3 = await waitAndMarkNotification(
            client3,
            '/multisig/vcp'
        );

        // TODO: Get nonce from exn
        await client3.groups().getRequest(msgSaid3);

        const vcp3 = await client3.registries().create({
            name: 'multisig',
            registryName: 'vLEI Registry',
            nonce: 'AHSNDV3ABI6U8OIgKaj3aky91ZpNL54I5_7-qwtC6q2s',
        });

        const op3 = await vcp3.op();
        const ims3 = signify.d(
            signify.messagize(
                vcp3.serder,
                vcp3.sigs.map((sig) => new signify.Siger({ qb64: sig }))
            )
        );

        await Promise.all(
            smids.map(async (smid) =>
                client3.exchanges().send(
                    'member3',
                    'registry',
                    aid3,
                    '/multisig/vcp',
                    { gid: group.prefix, usage: 'Issue vLEIs' },
                    {
                        vcp: [vcp3.regser, ''],
                        anc: [vcp3.serder, ims3.substring(vcp3.serder.size)],
                    },
                    smid
                )
            )
        );

        await waitOperation(client3, op3);
    });

    test('Verify registry created', async () => {
        const registry = await retry(async () => {
            const [registry] = await client1.registries().list('multisig');
            expect(registry.regk).toBeDefined();

            return registry;
        });

        regk = registry.regk;
    });

    test('Ensure no pending operations', async () => {
        await assertOperations(client1);
        await assertOperations(client2);
        await assertOperations(client3);
    });

    test('Ensure no unread notifications', async () => {
        await assertNotifications(client1);
        await assertNotifications(client2);
        await assertNotifications(client3);
    });
});

describe('Multisig credential issuance', () => {
    const TIME = new Date().toISOString().replace('Z', '000+00:00');

    test('Member 1', { concurrent: true }, async () => {
        const iss1 = await client1.credentials().issue('multisig', {
            ri: regk,
            s: SCHEMA_SAID,
            a: {
                i: aid4.prefix,
                dt: TIME,
                ...vcdata,
            },
        });

        await multisigIssue(client1, 'multisig', iss1);
        await waitOperation(client1, iss1.op);
    });

    test('Member 2', { concurrent: true }, async () => {
        const msgSaid2 = await waitAndMarkNotification(
            client2,
            '/multisig/iss'
        );
        const res2 = await client2.groups().getRequest(msgSaid2);
        const exn2 = res2[0].exn;

        const iss2 = await client2.credentials().issue('multisig', exn2.e.acdc);

        await multisigIssue(client2, 'multisig', iss2);
        await waitOperation(client2, iss2.op);
    });

    test('Member 3', { concurrent: true }, async () => {
        const msgSaid3 = await waitAndMarkNotification(
            client3,
            '/multisig/iss'
        );

        const res3 = await client3.groups().getRequest(msgSaid3);
        const exn3 = res3[0].exn;

        const iss3 = await client3.credentials().issue('multisig', exn3.e.acdc);

        await multisigIssue(client3, 'multisig', iss3);
        await waitOperation(client3, iss3.op);
    });
});

test('Ensure no pending operations', async () => {
    await assertOperations(client1);
    await assertOperations(client2);
    await assertOperations(client3);
});

test('Ensure no unread notifications', async () => {
    await assertNotifications(client1);
    await assertNotifications(client2);
    await assertNotifications(client3);
});

test('Grant credential', async () => {
    const stamp = new Date().toISOString().replace('Z', '000+00:00');
    const [credential] = await client1.credentials().list({
        filter: {
            '-a-i': aid4.prefix,
        },
    });

    expect(credential).toBeDefined();

    const [grant1, gsigs1, gend1] = await client1.ipex().grant({
        senderName: 'multisig',
        acdc: new Serder(credential.sad),
        anc: new Serder(credential.anc),
        iss: new Serder(credential.iss),
        recipient: aid4.prefix,
        datetime: stamp,
    });

    const op1 = await client1
        .ipex()
        .submitGrant('multisig', grant1, gsigs1, gend1, [aid4.prefix]);

    const ghab1 = await client1.identifiers().get('multisig');
    const gstate1 = ghab1['state'];
    const seal1 = [
        'SealEvent',
        {
            i: ghab1['prefix'],
            s: gstate1['ee']['s'],
            d: gstate1['ee']['d'],
        },
    ];
    const sigers1 = gsigs1.map((sig) => new signify.Siger({ qb64: sig }));
    const gims1 = signify.d(signify.messagize(grant1, sigers1, seal1));

    for (const smid of smids) {
        await client1
            .exchanges()
            .send(
                'member1',
                'multisig',
                aid1,
                '/multisig/exn',
                { gid: ghab1['prefix'] },
                { exn: [grant1, gims1.substring(grant1.size) + gend1] },
                smid
            );
    }

    // Member 2
    const msgSaid2 = await waitAndMarkNotification(client2, '/multisig/exn');

    await client2.groups().getRequest(msgSaid2); // TODO:
    const [grant2, gsigs2, gend2] = await client2.ipex().grant({
        senderName: 'multisig',
        recipient: aid4.prefix,
        acdc: new Serder(credential.sad),
        anc: new Serder(credential.anc),
        iss: new Serder(credential.iss),
        datetime: stamp,
    });

    const op2 = await client2
        .ipex()
        .submitGrant('multisig', grant2, gsigs2, gend2, [aid4.prefix]);

    const ghab2 = await client2.identifiers().get('multisig');
    const gstate2 = ghab2['state'];
    const seal2 = [
        'SealEvent',
        {
            i: ghab2['prefix'],
            s: gstate2['ee']['s'],
            d: gstate2['ee']['d'],
        },
    ];
    const sigers2 = gsigs2.map((sig) => new signify.Siger({ qb64: sig }));
    const gims2 = signify.d(signify.messagize(grant2, sigers2, seal2));

    for (const smid of smids) {
        await client2
            .exchanges()
            .send(
                'member2',
                'multisig',
                aid2,
                '/multisig/exn',
                { gid: ghab2['prefix'] },
                { exn: [grant2, gims2.substring(grant2.size) + gend2] },
                smid
            );
    }

    // Member 3
    const msgSaid3 = await waitAndMarkNotification(client3, '/multisig/exn');

    await client3.groups().getRequest(msgSaid3); // TODO: Get data from exn
    const [grant3, gsigs3, gend3] = await client3.ipex().grant({
        senderName: 'multisig',
        recipient: aid4.prefix,
        acdc: new Serder(credential.sad),
        anc: new Serder(credential.anc),
        iss: new Serder(credential.iss),
        datetime: stamp,
    });

    const op3 = await client3
        .ipex()
        .submitGrant('multisig', grant3, gsigs3, gend3, [aid4.prefix]);

    const ghab3 = await client3.identifiers().get('multisig');
    const gstate3 = ghab3['state'];
    const seal3 = [
        'SealEvent',
        {
            i: ghab3['prefix'],
            s: gstate3['ee']['s'],
            d: gstate3['ee']['d'],
        },
    ];
    const sigers3 = gsigs3.map((sig) => new signify.Siger({ qb64: sig }));
    const gims3 = signify.d(signify.messagize(grant3, sigers3, seal3));

    for (const smid of smids) {
        await client3
            .exchanges()
            .send(
                'member3',
                'multisig',
                aid3,
                '/multisig/exn',
                { gid: ghab3['prefix'] },
                { exn: [grant3, gims3.substring(grant3.size) + gend3] },
                smid
            );
    }

    await waitOperation(client1, op1);
    await waitOperation(client2, op2);
    await waitOperation(client3, op3);
});

test('Ensure no pending operations', async () => {
    await assertOperations(client1);
    await assertOperations(client2);
    await assertOperations(client3);
});

test('Admit credential', async () => {
    const msgSaid = await waitAndMarkNotification(client4, '/exn/ipex/grant');

    const res = await client4.exchanges().get(msgSaid);
    const recipient = res.exn.i;
    expect(recipient).toEqual(groupPrefix);

    const [admit, asigs, aend] = await client4.ipex().admit({
        senderName: 'holder',
        message: '',
        grantSaid: res.exn.d,
        recipient: res.exn.i,
    });

    const op4 = await client4
        .ipex()
        .submitAdmit('holder', admit, asigs, aend, [res.exn.i]);

    await waitOperation(client4, op4);

    const creds = await client4.credentials().list();
    expect(creds).toHaveLength(1);
    expect(creds[0].sad).toMatchObject({ a: vcdata });
});

test('Clear grant notifications for members', async () => {
    await waitAndMarkNotification(client1, '/exn/ipex/grant');
    await waitAndMarkNotification(client2, '/exn/ipex/grant');
    await waitAndMarkNotification(client3, '/exn/ipex/grant');
});

test('Verify admit notifications for members', async () => {
    await waitAndMarkNotification(client1, '/exn/ipex/admit');
    await waitAndMarkNotification(client2, '/exn/ipex/admit');
    await waitAndMarkNotification(client3, '/exn/ipex/admit');
});

test('Ensure no pending operations', async () => {
    await assertOperations(client1);
    await assertOperations(client2);
    await assertOperations(client3);
    await assertOperations(client4);
});

test('Ensure no unread notifications', async () => {
    await assertNotifications(client1);
    await assertNotifications(client2);
    await assertNotifications(client3);
    await assertNotifications(client4);
});

describe('Multisig credential revocation', () => {
    const REVTIME = new Date().toISOString().replace('Z', '000+00:00');
    let credential: CredentialResult;

    beforeAll(async () => {
        [credential] = await client1.credentials().list({
            filter: {
                '-a-i': aid4.prefix,
            },
        });
    });

    test('Member 1', { concurrent: true }, async () => {
        const rev1 = await client1
            .credentials()
            .revoke('multisig', credential.sad.d, REVTIME);

        await multisigRevoke(client1, 'multisig', rev1.rev, rev1.anc);
        await waitOperation(client1, rev1.op);
    });

    test('Member 2', { concurrent: true }, async () => {
        const msgSaid2 = await waitAndMarkNotification(
            client2,
            '/multisig/rev'
        );
        await client2.groups().getRequest(msgSaid2);

        const rev2 = await client2
            .credentials()
            .revoke('multisig', credential.sad.d, REVTIME);

        await multisigRevoke(client2, 'multisig', rev2.rev, rev2.anc);
        await waitOperation(client2, rev2.op);
    });

    test('Member 3', { concurrent: true }, async () => {
        const msgSaid3 = await waitAndMarkNotification(
            client3,
            '/multisig/rev'
        );
        await client3.groups().getRequest(msgSaid3);

        const rev3 = await client3
            .credentials()
            .revoke('multisig', credential.sad.d, REVTIME);

        await multisigRevoke(client3, 'multisig', rev3.rev, rev3.anc);
        await waitOperation(client3, rev3.op);
    });
});
