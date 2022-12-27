/* eslint-env jest */

import { RRPCServer, RRPCClient } from '../src';
import Redis from 'ioredis';

// Using the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

jest.setTimeout(20 * 1000);
afterAll(() => {
    redis1.disconnect();
    redis2.disconnect();
});

test("the client should disconnect when the server doesn't respond to ping requests", (done) => {
    (async () => {
        const server = new RRPCServer('hello-world-service2', redis1);
        const client = new RRPCClient('hello-world-service2', redis2);
        server.on('connection', async (channel) => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            //@ts-ignore
            await channel._close();
        });

        await server.run();
        await client.start();
        client.channel.pingInterval = 50;
        client.channel.on('close', () => {
            done();
        });
    })();
});
