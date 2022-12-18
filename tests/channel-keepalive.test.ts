/* eslint-env jest */

import { RRPCServer, RRPCClient } from '../src';
import Redis from 'ioredis-mock';

// Using the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

test("the client should disconnect when the server doesn't respond to ping requests", (done) => {
    (async () => {
        jest.setTimeout(20 * 1000);
        const server = new RRPCServer('hello-world-service', redis1);
        const client = new RRPCClient('hello-world-service', redis2);
        await server.run();

        await client.start();
        client.channel.on('close', () => {
            redis1.quit();
            redis2.quit();
            done();
        });

        await server.close({ closeAllActiveChannels: true, forceCloseChannels: true });
    })();
});
