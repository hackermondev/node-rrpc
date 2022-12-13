/* eslint-env jest */

import { RRPCServer, RRPCClient } from '../src';
import Redis from 'ioredis-mock';

// Use the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

test('should be able to send and recieve and simple oneway hello world data', (done) => {
    (async () => {
        const server = new RRPCServer('hello-world-service', redis1);
        const client = new RRPCClient('hello-world-service', redis2);

        const now = new Date().getTime();
        const nowFn = () => new Date().getTime() - now;

        await server.run();

        client.start('oneway');
        if (!client.channel) throw new Error('no client.channel');

        client.channel.on('connect', () => {
            console.debug('client connected after', nowFn());
            client.channel?.send('hello world');
        });

        client.channel.on('message', (data) => {
            console.debug('client recieved message after', nowFn());
            if (data.toString() == 'hello world') done();
        });

        server.on('connection', (channel) => {
            channel.on('connect', () => console.debug('server connected after', nowFn()));
            channel.on('message', () => {
                console.debug('server recieved message after', nowFn());
                channel.send('hello world');
            });
        });
    })();
});
