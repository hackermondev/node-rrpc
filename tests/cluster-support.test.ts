/* eslint-env jest */

import { RRPCClient, RRPCServer } from '../src';
import Redis from 'ioredis-mock';

// Using the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

test('client should error if no available servers for service', (done) => {
    (async () => {
        const client = new RRPCClient('calculator-service', redis2);
        const result = await client.start().catch((err) => err);

        if (result instanceof Error) {
            done();
        } else {
            fail();
        }
    })();
});

test('client should be able to connect when at least one server is available in cluster', (done) => {
    (async () => {
        const client = new RRPCClient('calculator-service', redis2);
        const server = new RRPCServer('calculator-service', redis1);

        await server.run();
        const result = await client.start().catch((err) => err);

        if (result instanceof Error) {
            fail();
        } else {
            done();
        }
    })();
});

test('client should be able to choose between random servers for a service when available', (done) => {
    (async () => {
        jest.setTimeout(15_000);
        const server1 = new RRPCServer('calculator-service', redis1);
        const server2 = new RRPCServer('calculator-service', redis1);

        await server1.run();
        await server2.run();

        const tries = 50;
        const finished = { server1: false, server2: false };
        for (let i = 0; i < tries; i++) {
            const client = new RRPCClient('calculator-service', redis2);
            await client.start();
            if (client._clusterId == server1.id) finished.server1 = true;
            if (client._clusterId == server2.id) finished.server2 = true;

            if (finished.server1 && finished.server2) {
                done();
                break;
            }
        }
    })();
});
