import { assert, test } from 'vitest';
import { HabState, Serder, SignifyClient } from '#signify-ts';
import {
    createClient,
    createIdentifier,
    resolveOobi,
    waitOperation,
} from './utils/test-util.ts';
import { resolveEnvironment } from './utils/resolve-env.ts';

let client1: SignifyClient;
let client2: SignifyClient;
let aid1: HabState;
let aid2: HabState;
const env = resolveEnvironment();

test('Create clients ', async () => {
    [client1, client2] = await Promise.all([createClient(), createClient()]);
});

test('challenge', async () => {});

test('Create identifiers', async () => {
    aid1 = await createIdentifier(client1, 'alice', {
        toad: Math.abs(env.witnessIds.length - 1),
        wits: env.witnessIds,
    });

    aid2 = await createIdentifier(client2, 'bob', {
        toad: Math.abs(env.witnessIds.length - 1),
        wits: env.witnessIds,
    });
});

test('Resolve oobis', async () => {
    const oobi1 = await client1.oobis().get('alice', 'agent');
    const oobi2 = await client2.oobis().get('bob', 'agent');

    await resolveOobi(client1, oobi2.oobis[0], 'bob');
    await resolveOobi(client2, oobi1.oobis[0], 'alice');
});

test('Challenge', async () => {
    const challenge1_small = await client1.challenges().generate(128);
    assert.equal(challenge1_small.words.length, 12);

    const challenge1_big = await client1.challenges().generate(256);
    assert.equal(challenge1_big.words.length, 24);

    const contacts1 = await client1.contacts().list();
    const bobContact = contacts1.find((contact) => contact.alias === 'bob');
    assert.equal(bobContact?.alias, 'bob');
    assert(Array.isArray(bobContact?.challenges));
    assert.strictEqual(bobContact.challenges.length, 0);

    await client2
        .challenges()
        .respond('bob', aid1.prefix, challenge1_small.words);

    const verifyOperation = await waitOperation(
        client1,
        await client1.challenges().verify(aid2.prefix, challenge1_small.words)
    );

    const verifyResponse = verifyOperation.response as {
        exn: Record<string, unknown>;
    };
    const exn = new Serder(verifyResponse.exn);

    await client1.challenges().responded(aid2.prefix, exn.sad.d);
});

test('Check contact status', async () => {
    const contacts = await client1.contacts().list();
    const bobContact = contacts.find((contact) => contact.alias === 'bob');

    assert(Array.isArray(bobContact?.challenges));
    assert.strictEqual(bobContact?.challenges[0].authenticated, true);
});
