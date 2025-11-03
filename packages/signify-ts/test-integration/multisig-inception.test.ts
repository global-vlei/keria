import signify, { HabState, SignifyClient } from '#signify-ts';
import {
    createClient,
    createIdentifier,
    resolveOobi,
    waitForNotifications,
    waitOperation,
} from './utils/test-util.ts';
import {
    acceptMultisigIncept,
    startMultisigIncept,
} from './utils/multisig-utils.ts';
import { assert, test } from 'vitest';
import { resolveEnvironment } from './utils/resolve-env.ts';

let client1: SignifyClient;
let client2: SignifyClient;
let aid1: HabState;
let aid2: HabState;
const env = resolveEnvironment();
const groupName = 'multisig';

test('Create clients ', async () => {
    await signify.ready();

    [client1, client2] = await Promise.all([createClient(), createClient()]);
});

test('Create member 1', async () => {
    aid1 = await createIdentifier(client1, 'member1');
});

test('Create member 2', async () => {
    aid2 = await createIdentifier(client2, 'member2');
});

test('Resolve oobis', async () => {
    const oobi1 = await client1.oobis().get('member1', 'agent');
    const oobi2 = await client2.oobis().get('member2', 'agent');

    await Promise.all([
        resolveOobi(client1, oobi2.oobis[0], 'member2'),
        resolveOobi(client2, oobi1.oobis[0], 'member1'),
    ]);
});

test('Create multisig group', async () => {
    const op1 = await startMultisigIncept(client1, {
        groupName,
        localMemberName: 'member1',
        participants: [aid1.prefix, aid2.prefix],
        toad: Math.abs(env.witnessIds.length - 1),
        isith: 2,
        nsith: 2,
        wits: env.witnessIds,
    });

    const notifications = await waitForNotifications(client2, '/multisig/icp');
    await Promise.all(
        notifications.map((note) => client2.notifications().mark(note.i))
    );
    const msgSaid = notifications[notifications.length - 1].a.d;
    assert(msgSaid, 'msgSaid not defined');
    const op2 = await acceptMultisigIncept(client2, {
        localMemberName: 'member2',
        groupName,
        msgSaid,
    });

    await Promise.all([
        waitOperation(client1, op1),
        waitOperation(client2, op2),
    ]);
});

test('Verify multisig group', async () => {
    const multisig1 = await client1.identifiers().get(groupName);
    const multisig2 = await client2.identifiers().get(groupName);
    assert.strictEqual(multisig1.prefix, multisig2.prefix);
    const members = await client1.identifiers().members(groupName);
    assert.strictEqual(members.signing.length, 2);
    assert.strictEqual(members.rotation.length, 2);
    assert.strictEqual(members.signing[0].aid, aid1.prefix);
    assert.strictEqual(members.signing[1].aid, aid2.prefix);
    assert.strictEqual(members.rotation[0].aid, aid1.prefix);
    assert.strictEqual(members.rotation[1].aid, aid2.prefix);
});
