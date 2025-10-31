import { assert, expect, test } from 'vitest';
import signify, {
    SignifyClient,
    Operation,
    CredentialData,
    HabState,
} from '#signify-ts';
import { resolveEnvironment } from './utils/resolve-env.ts';
import {
    createIdentifier,
    getOrCreateClient,
    resolveOobi,
    waitAndMarkNotification,
    waitOperation,
} from './utils/test-util.ts';
import {
    acceptMultisigIncept,
    addEndRoleMultisig,
    startMultisigIncept,
} from './utils/multisig-utils.ts';
import { retry } from './utils/retry.ts';

const { vleiServerUrl } = resolveEnvironment();

const SCHEMA_SAID = 'EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao';
const SCHEMA_OOBI = `${vleiServerUrl}/oobi/${SCHEMA_SAID}`;

const TIME = createTimestamp();

let client1: SignifyClient;
let client2: SignifyClient;
let client3: SignifyClient;
let aid1: HabState;
let aid2: HabState;
let aid3: HabState;
let oobi1: string;
let oobi2: string;
let oobi3: string;

test('multisig', async () => {
    await signify.ready();
    [client1, client2, client3] = await Promise.all([
        getOrCreateClient(),
        getOrCreateClient(),
        getOrCreateClient(),
    ]);
});

test('Create identifiers', async () => {
    [aid1, aid2, aid3] = await Promise.all([
        createIdentifier(client1, 'member1'),
        createIdentifier(client2, 'member2'),
        createIdentifier(client3, 'issuer'),
    ]);

    expect(aid1).toBeDefined();
    expect(aid2).toBeDefined();
    expect(aid3).toBeDefined();
});

test('Create registry', async () => {
    await createRegistry(client3, 'issuer', 'issuer-reg');
});

test('Generate oobis', async () => {
    [
        {
            oobis: [oobi1],
        },
        {
            oobis: [oobi2],
        },
        {
            oobis: [oobi3],
        },
    ] = await Promise.all([
        client1.oobis().get('member1', 'agent'),
        client2.oobis().get('member2', 'agent'),
        client3.oobis().get('issuer', 'agent'),
    ]);

    expect(oobi1).toBeDefined();
    expect(oobi2).toBeDefined();
    expect(oobi3).toBeDefined();
});

test('Resolve oobis for member1', async () => {
    await resolveOobi(client1, oobi2, 'member2');
    await resolveOobi(client1, oobi3, 'issuer');
    await resolveOobi(client1, SCHEMA_OOBI, 'schema');
});

test('Resolve oobis for member2', async () => {
    await resolveOobi(client2, oobi1, 'member1');
    await resolveOobi(client2, oobi3, 'issuer');
    await resolveOobi(client2, SCHEMA_OOBI, 'schema');
});

test('Resolve oobis for issuer', async () => {
    await resolveOobi(client3, oobi1, 'member1');
    await resolveOobi(client3, oobi2, 'member2');
    await resolveOobi(client3, SCHEMA_OOBI, 'schema');
});

test('Create multisig holder', async () => {
    const op1 = await startMultisigIncept(client1, {
        groupName: 'holder',
        localMemberName: aid1.name,
        isith: 2,
        nsith: 2,
        toad: aid1.state.b.length,
        wits: aid1.state.b,
        participants: [aid1.prefix, aid2.prefix],
    });

    const msgSaid = await waitAndMarkNotification(client2, '/multisig/icp');
    const op2 = await acceptMultisigIncept(client2, {
        groupName: 'holder',
        localMemberName: aid2.name,
        msgSaid,
    });

    await waitOperation(client1, op1);
    await waitOperation(client2, op2);

    const identifiers1 = await client1.identifiers().list();
    assert.equal(identifiers1.aids.length, 2);

    const identifiers2 = await client2.identifiers().list();
    assert.equal(identifiers2.aids.length, 2);
});

test('Authorize multisig end roles', async () => {
    const stamp = createTimestamp();

    const ghab1 = await client1.identifiers().get('holder');
    const ops1 = await addEndRoleMultisig(client1, ghab1, stamp);

    const ghab2 = await client2.identifiers().get('holder');
    const ops2 = await addEndRoleMultisig(client2, ghab2, stamp);

    for (const op of ops1) {
        await client1.operations().wait(op);
    }

    for (const op of ops2) {
        await client2.operations().wait(op);
    }
});

// test('Clear notifications', async () => {
//     await retry(async () => {
//         const notes = await client1.notifications().list();
//         expect(notes.length).toBeGreaterThan(0);
//     });
//     // await waitAndMarkNotification(client1, '/multisig/rpy');
//     // await waitAndMarkNotification(client2, '/multisig/rpy');
// }, { timeout: 30});

test('Resolve multisig oobi', async () => {
    const oobisRes = await client1.oobis().get('holder', 'agent');
    const oobiMultisig = oobisRes.oobis[0].split('/agent/')[0];

    const op3 = await client3.oobis().resolve(oobiMultisig, 'holder');
    await waitOperation(client3, op3);
});

test('Multisig holder credential issuance flow', async () => {
    const holderAid = await client1.identifiers().get('holder');
    aid1 = await client1.identifiers().get('member1');
    aid2 = await client2.identifiers().get('member2');

    const registires = await client3.registries().list('issuer');
    await issueCredential(client3, 'issuer', {
        ri: registires[0].regk,
        s: SCHEMA_SAID,
        a: {
            i: holderAid['prefix'],
            LEI: '5493001KJTIIGC8Y1R17',
        },
    });
});

test('Multisig holder admit credential', async () => {
    const grantMsgSaid = await waitAndMarkNotification(
        client1,
        '/exn/ipex/grant'
    );

    const exn1 = await client1.exchanges().get(grantMsgSaid);

    const op1 = await multisigAdmitCredential(
        client1,
        'holder',
        'member1',
        exn1.exn.d,
        exn1.exn.i
    );

    const grantMsgSaid2 = await waitAndMarkNotification(
        client2,
        '/exn/ipex/grant'
    );
    const exn2 = await client2.exchanges().get(grantMsgSaid2);

    assert.equal(grantMsgSaid, grantMsgSaid2);

    const op2 = await multisigAdmitCredential(
        client2,
        'holder',
        'member2',
        exn2.exn.d,
        exn2.exn.i
    );

    await waitOperation(client1, op1);
    await waitOperation(client2, op2);
});

test('Verify multisig holder 1 credential', async () => {
    await retry(async () => {
        const creds = await client1.credentials().list();
        assert.equal(creds.length, 1);
        assert.equal(creds[0].status.et, 'iss');
        assert.equal(creds[0].status.s, '0');
    });
});

test('Verify multisig holder 2 credential', async () => {
    await retry(async () => {
        const creds = await client2.credentials().list();
        assert.equal(creds.length, 1);
        assert.equal(creds[0].status.et, 'iss');
        assert.equal(creds[0].status.s, '0');
    });
});

test('Verify all operations are done', async () => {
    for (const client of [client1, client2, client3]) {
        const operations = await client.operations().list();
        for (const op of operations) {
            assert.equal(op.done, true);
        }
    }
});

async function createRegistry(
    client: SignifyClient,
    name: string,
    registryName: string
) {
    const result = await client.registries().create({ name, registryName });
    const op = await result.op();
    await client.operations().wait(op);

    return await retry(
        async () => {
            const registries = await client.registries().list(name);
            assert.equal(registries.length, 1);
            assert.equal(registries[0].name, registryName);
            return registries[0];
        },
        { timeout: 10000 }
    );
}

async function issueCredential(
    client: SignifyClient,
    name: string,
    data: CredentialData
) {
    const result = await client.credentials().issue(name, data);

    await waitOperation(client, result.op);

    const creds = await client.credentials().list();
    assert.equal(creds.length, 1);
    assert.equal(creds[0].sad.s, data.s);
    assert.equal(creds[0].status.s, '0');

    const dt = createTimestamp();

    if (data.a.i) {
        const [grant, gsigs, end] = await client.ipex().grant({
            senderName: name,
            recipient: data.a.i,
            datetime: dt,
            acdc: result.acdc,
            anc: result.anc,
            iss: result.iss,
        });

        const op = await client
            .ipex()
            .submitGrant(name, grant, gsigs, end, [data.a.i]);
        await waitOperation(client, op);
    }

    return creds[0];
}

function createTimestamp() {
    const dt = new Date().toISOString().replace('Z', '000+00:00');
    return dt;
}

async function multisigAdmitCredential(
    client: SignifyClient,
    groupName: string,
    memberAlias: string,
    grantSaid: string,
    issuerPrefix: string
): Promise<Operation> {
    const mHab = await client.identifiers().get(memberAlias);
    const gHab = await client.identifiers().get(groupName);

    const [admit, sigs, end] = await client.ipex().admit({
        senderName: groupName,
        message: '',
        grantSaid: grantSaid,
        recipient: issuerPrefix,
        datetime: TIME,
    });

    const op = await client
        .ipex()
        .submitAdmit(groupName, admit, sigs, end, [issuerPrefix]);

    const mstate = gHab['state'];
    const seal = [
        'SealEvent',
        { i: gHab['prefix'], s: mstate['ee']['s'], d: mstate['ee']['d'] },
    ];
    const sigers = sigs.map((sig: string) => new signify.Siger({ qb64: sig }));
    const ims = signify.d(signify.messagize(admit, sigers, seal));
    let atc = ims.substring(admit.size);
    atc += end;
    const gembeds = {
        exn: [admit, atc],
    };

    await client
        .exchanges()
        .send(
            mHab.name,
            'multisig',
            mHab,
            '/multisig/exn',
            { gid: gHab['prefix'] },
            gembeds,
            gHab['prefix']
        );

    return op;
}
