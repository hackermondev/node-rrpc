/* eslint-env jest */

import { RRPCServer, RRPCClient } from '../src';
import Redis from 'ioredis';

// Using the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

afterAll(() => {
    redis1.disconnect();
    redis2.disconnect();
});

jest.setTimeout(20_000);
test('should be able to send and recieve (simple hello world service)', (done) => {
    (async () => {
        const server = new RRPCServer('hello-world-service', redis1);
        const client = new RRPCClient('hello-world-service', redis2);

        const now = new Date().getTime();
        const nowFn = () => new Date().getTime() - now;
        const timings = {
            clientConnected: 0,
            serverConnected: 0,
            clientRecievedMessage: 0,
            serverRecievedMessage: 0,
        };

        await server.run();
        server.on('connection', (channel) => {
            channel.on('connect', () => (timings.serverConnected = nowFn()));
            channel.on('message', (message) => {
                timings.serverRecievedMessage = nowFn();
                message.reply('hello world');
            });
        });

        await client.start();
        timings.clientConnected = nowFn();
        const result = await client.channel.send('hello world');
        if (result.content == 'hello world') {
            console.debug(
                // eslint-disable-next-line max-len
                `Timings: client_connected (${timings.clientConnected}ms), server_connected (${timings.serverConnected}ms), client_first_message (${timings.clientRecievedMessage}ms), server_first_message (${timings.serverRecievedMessage}ms)`,
            );

            done();
        }
    })();
});

test('should be able to send and recieve json data (and data should stay json)', (done) => {
    (async () => {
        const server = new RRPCServer('hello-world-service2', redis1);
        const client = new RRPCClient('hello-world-service2', redis2);

        await server.run();
        server.on('connection', (channel) => {
            channel.on('message', (message) => {
                message.reply({ hi: true });
            });
        });

        await client.start();
        const result = await client.channel.send('hello world');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((result.content as any).hi) {
            client.channel.close();
            done();
        } else {
            throw new Error(`data returned as ${typeof result.content}`);
        }
    })();
});
