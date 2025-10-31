import { assert, beforeAll, test } from 'vitest';
import signify, { HabState, Operation, SignifyClient } from '#signify-ts';
import {
    assertNotifications,
    assertOperations,
    createClient,
    createIdentifier,
    createTimestamp,
    getOrCreateContact,
    resolveOobi,
    waitAndMarkNotification,
    waitForNotifications,
    waitOperation,
} from './utils/test-util.ts';
import {
    acceptMultisigIncept,
    addEndRoleMultisig,
    delegateMultisig,
    startMultisigIncept,
} from './utils/multisig-utils.ts';

const delegatorGroupName = 'delegator_group';
const delegateeGroupName = 'delegatee_group';
const delegator1Name = 'delegator1';
const delegator2Name = 'delegator2';
const delegatee1Name = 'delegatee1';
const delegatee2Name = 'delegatee2';

let delegator1Client: SignifyClient;
let delegator2Client: SignifyClient;
let delegatee1Client: SignifyClient;
let delegatee2Client: SignifyClient;

let delegator1Aid: HabState;
let delegator2Aid: HabState;
let delegatee1Aid: HabState;
let delegatee2Aid: HabState;
let delegator: HabState;
let delegatee: HabState;

let delegator1Oobi: { oobis: string[]; role: string };
let delegator2Oobi: { oobis: string[]; role: string };
let delegatee1Oobi: { oobis: string[]; role: string };
let delegatee2Oobi: { oobis: string[]; role: string };
let delegatorGroupNameOobi: string;

let delegateOperation1: Operation;
let delegateOperation2: Operation;

beforeAll(async () => {
    await signify.ready();
});

test('Create clients', async () => {
    [delegator1Client, delegator2Client, delegatee1Client, delegatee2Client] =
        await Promise.all([
            createClient(),
            createClient(),
            createClient(),
            createClient(),
        ]);
});

test('Create identifiers', async () => {
    [delegator1Aid, delegator2Aid, delegatee1Aid, delegatee2Aid] =
        await Promise.all([
            createIdentifier(delegator1Client, delegator1Name),
            createIdentifier(delegator2Client, delegator2Name),
            createIdentifier(delegatee1Client, delegatee1Name),
            createIdentifier(delegatee2Client, delegatee2Name),
        ]);
});

test('Getting OOBIs before resolving...', async () => {
    [delegator1Oobi, delegator2Oobi, delegatee1Oobi, delegatee2Oobi] =
        await Promise.all([
            delegator1Client.oobis().get(delegator1Name, 'agent'),
            delegator2Client.oobis().get(delegator2Name, 'agent'),
            delegatee1Client.oobis().get(delegatee1Name, 'agent'),
            delegatee2Client.oobis().get(delegatee2Name, 'agent'),
        ]);
});

test('Resolving OOBIs', async () => {
    await Promise.all([
        resolveOobi(delegator1Client, delegator2Oobi.oobis[0], delegator2Name),
        resolveOobi(delegator2Client, delegator1Oobi.oobis[0], delegator1Name),
        resolveOobi(delegatee1Client, delegatee2Oobi.oobis[0], delegatee2Name),
        resolveOobi(delegatee2Client, delegatee1Oobi.oobis[0], delegatee1Name),
    ]);
});

test('Create delegator group AID', async () => {
    const op1 = await startMultisigIncept(delegator1Client, {
        groupName: delegatorGroupName,
        localMemberName: delegator1Aid.name,
        participants: [delegator1Aid.prefix, delegator2Aid.prefix],
        isith: 2,
        nsith: 2,
    });

    const notifications = await waitForNotifications(
        delegator2Client,
        '/multisig/icp'
    );
    await Promise.all(
        notifications.map((note) =>
            delegator2Client.notifications().mark(note.i)
        )
    );
    const msgSaid = notifications[notifications.length - 1].a.d;
    assert(msgSaid, 'msgSaid not defined');
    const op2 = await acceptMultisigIncept(delegator2Client, {
        localMemberName: delegator2Aid.name,
        groupName: delegatorGroupName,
        msgSaid,
    });

    await Promise.all([
        waitOperation(delegator1Client, op1),
        waitOperation(delegator2Client, op2),
    ]);
});

test('Authorize multisig end roles', async () => {
    const stamp = createTimestamp();

    const ghab1 = await delegator1Client.identifiers().get(delegatorGroupName);
    const ops1 = await addEndRoleMultisig(delegator1Client, ghab1, stamp);

    const ghab2 = await delegator2Client.identifiers().get(delegatorGroupName);
    const ops2 = await addEndRoleMultisig(delegator2Client, ghab2, stamp);

    for (const op of ops1) {
        await delegator1Client.operations().wait(op);
    }

    for (const op of ops2) {
        await delegator2Client.operations().wait(op);
    }
});

test('Clear notifications', async () => {
    await waitAndMarkNotification(delegator2Client, '/multisig/rpy', {
        timeout: 10000,
    });
});

test('Add and resolve delegator OOBI', async () => {
    const [oobis1, oobis2] = await Promise.all([
        delegator1Client.oobis().get(delegatorGroupName, 'agent'),
        delegator2Client.oobis().get(delegatorGroupName, 'agent'),
    ]);

    assert.equal(oobis1.role, oobis2.role);
    assert.equal(oobis1.oobis[0], oobis2.oobis[0]);

    delegatorGroupNameOobi = oobis1.oobis[0];
    delegator = await delegator1Client.identifiers().get(delegatorGroupName);
});

test('Resolve oobi', async () => {
    const oobiGtor = delegatorGroupNameOobi.split('/agent/')[0];
    await Promise.all([
        getOrCreateContact(delegatee1Client, delegatorGroupName, oobiGtor),
        getOrCreateContact(delegatee2Client, delegatorGroupName, oobiGtor),
    ]);
});

test('Create delegatee group', async () => {
    delegateOperation1 = await startMultisigIncept(delegatee1Client, {
        groupName: delegateeGroupName,
        localMemberName: delegatee1Aid.name,
        participants: [delegatee1Aid.prefix, delegatee2Aid.prefix],
        isith: 2,
        nsith: 2,
        delpre: delegator.prefix,
    });

    const notifications = await waitForNotifications(
        delegatee2Client,
        '/multisig/icp'
    );
    await Promise.all(
        notifications.map((note) =>
            delegatee2Client.notifications().mark(note.i)
        )
    );
    const msgSaid = notifications[notifications.length - 1].a.d;
    assert(msgSaid, 'msgSaid not defined');

    delegateOperation2 = await acceptMultisigIncept(delegatee2Client, {
        localMemberName: delegatee2Aid.name,
        groupName: delegateeGroupName,
        msgSaid,
    });

    const agtee1 = await delegatee1Client.identifiers().get(delegateeGroupName);
    const agtee2 = await delegatee2Client.identifiers().get(delegateeGroupName);
    delegatee = agtee1;
    assert.equal(agtee1.prefix, agtee2.prefix);
    assert.equal(agtee1.name, agtee2.name);
});

test('delegator anchors/approves delegation', async () => {
    const anchor = {
        i: delegatee.prefix,
        s: '0',
        d: delegatee.prefix,
    };

    const op1 = await delegateMultisig(
        delegator1Client,
        await delegator1Client.identifiers().get(delegatorGroupName),
        anchor
    );
    const op2 = await delegateMultisig(
        delegator2Client,
        await delegator2Client.identifiers().get(delegatorGroupName),
        anchor
    );

    const [dresult1, dresult2] = await Promise.all([
        waitOperation(delegator1Client, op1),
        waitOperation(delegator2Client, op2),
    ]);

    assert.equal(dresult1.response, dresult2.response);
});

test('Clear notifications', async () => {
    await waitAndMarkNotification(delegator2Client, '/multisig/ixn', {
        timeout: 10000,
    });
});

test('Final validation', async () => {
    const queryOp1 = await delegator1Client
        .keyStates()
        .query(delegator.prefix, '1');
    const queryOp2 = await delegator2Client
        .keyStates()
        .query(delegator.prefix, '1');

    await waitOperation(delegator1Client, queryOp1);
    await waitOperation(delegator2Client, queryOp2);

    const ksteetor1 = await delegatee1Client
        .keyStates()
        .query(delegator.prefix, '1');
    const ksteetor2 = await delegatee2Client
        .keyStates()
        .query(delegator.prefix, '1');

    await waitOperation(delegatee1Client, ksteetor1);
    await waitOperation(delegatee2Client, ksteetor2);

    await waitOperation(delegatee1Client, delegateOperation1);
    await waitOperation(delegatee2Client, delegateOperation2);
});

test('Assert operations', async () => {
    await assertOperations(delegator1Client);
    await assertOperations(delegator2Client);
    await assertOperations(delegatee1Client);
    await assertOperations(delegatee2Client);
});

test('Assert operations and notifications', async () => {
    await assertNotifications(delegator1Client);
    await assertNotifications(delegator2Client);
    await assertNotifications(delegatee1Client);
    await assertNotifications(delegatee2Client);
});
