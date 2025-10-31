import { assert, test } from 'vitest';
import {
    assertOperations,
    createClient,
    waitOperation,
} from './utils/test-util.ts';
import { Algos, Diger, MtrDex, Serder, SignifyClient } from '#signify-ts';

let client: SignifyClient;

test('create client', async () => {
    client = await createClient();
});

test('randy', async () => {
    let icpResult = await client
        .identifiers()
        .create('aid1', { algo: Algos.randy });
    let op = await waitOperation(client, await icpResult.op());
    assert.equal(op['done'], true);
    let aid = op['response'];
    const icp = new Serder(aid);
    assert.equal(icp.verfers.length, 1);
    assert.equal(icp.digers.length, 1);
    assert.equal(icp.sad['kt'], '1');
    assert.equal(icp.sad['nt'], '1');

    let aids = await client.identifiers().list();
    assert.equal(aids.aids.length, 1);
    aid = aids.aids[0];
    assert.equal(aid.name, 'aid1');
    assert.equal(aid.prefix, icp.pre);

    icpResult = await client.identifiers().interact('aid1', [icp.pre]);
    op = await waitOperation(client, await icpResult.op());
    let ked = op['response'];
    const ixn = new Serder(ked);
    assert.equal(ixn.sad['s'], '1');
    assert.deepEqual([...ixn.sad['a']], [icp.pre]);

    aids = await client.identifiers().list();
    assert.equal(aids.aids.length, 1);
    aid = aids.aids[0];

    const events = client.keyEvents();
    let log = await events.get(aid['prefix']);
    assert.equal(log.length, 2);

    icpResult = await client.identifiers().rotate('aid1');
    op = await waitOperation(client, await icpResult.op());
    ked = op['response'];
    const rot = new Serder(ked);
    assert.equal(rot.sad['s'], '2');
    assert.equal(rot.verfers.length, 1);
    assert.equal(rot.digers.length, 1);
    assert.notEqual(rot.verfers[0].qb64, icp.verfers[0].qb64);
    assert.notEqual(rot.digers[0].qb64, icp.digers[0].qb64);
    const dig = new Diger({ code: MtrDex.Blake3_256 }, rot.verfers[0].qb64b);
    assert.equal(dig.qb64, icp.digers[0].qb64);
    log = await events.get(aid['prefix']);
    assert.equal(log.length, 3);

    await assertOperations(client);
}, 30000);
