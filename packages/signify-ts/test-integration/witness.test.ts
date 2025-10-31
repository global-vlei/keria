import { assert, beforeAll, test } from 'vitest';
import { resolveEnvironment } from './utils/resolve-env.ts';
import { createClient, resolveOobi, waitOperation } from './utils/test-util.ts';
import { HabState, ready, SignifyClient } from '#signify-ts';

const {
    witnessUrls: [WITNESS_URL],
    witnessIds: [WITNESS_AID],
} = resolveEnvironment();

let client: SignifyClient;
let hab: HabState;

beforeAll(async () => {
    await ready();
});

test('Setup', async () => {
    client = await createClient();
});

test('Resolve witness oobi', async () => {
    await resolveOobi(client, WITNESS_URL + `/oobi/${WITNESS_AID}`, 'wit');
});

test('Create aid', async () => {
    const result = await client.identifiers().create('aid1', {
        toad: 1,
        wits: [WITNESS_AID],
    });

    await waitOperation(client, await result.op());
});

test("Verify aid's witness", async () => {
    hab = await client.identifiers().get('aid1');
    assert.equal(hab.state.b.length, 1);
    assert.equal(hab.state.b[0], WITNESS_AID);
});

test('Rotate', async () => {
    const result = await client.identifiers().rotate('aid1');
    await waitOperation(client, await result.op());

    hab = await client.identifiers().get('aid1');

    assert.equal(hab.state.b.length, 1);
    assert.equal(hab.state.b[0], WITNESS_AID);
});

test('Rotate out witness', async () => {
    const result = await client
        .identifiers()
        .rotate('aid1', { cuts: [WITNESS_AID] });

    await waitOperation(client, await result.op());

    hab = await client.identifiers().get('aid1');
    assert.equal(hab.state.b.length, 0);
});

test('Rotate in witness again', async () => {
    const result = await client
        .identifiers()
        .rotate('aid1', { adds: [WITNESS_AID] });

    await waitOperation(client, await result.op());
    hab = await client.identifiers().get('aid1');

    assert.equal(hab.state.b.length, 1);
    assert.equal(hab.state.b.length, 1);
    assert.equal(hab.state.b[0], WITNESS_AID);
});
