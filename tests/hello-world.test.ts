/* eslint-env jest */

import { RRPCServer, RRPCClient } from '../src';
import Redis from 'ioredis-mock';

// Using the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

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

            redis1.quit();
            redis2.quit();
            done();
        }
    })();
});
