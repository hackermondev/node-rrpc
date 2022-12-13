/* eslint-env jest */

import { RRPCServer, RRPCClient } from '../src';
import Redis from 'ioredis-mock';

// Using the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

test('should be able to send and recieve and simple oneway hello world data', (done) => {
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

        client.start('oneway');
        if (!client.channel) throw new Error('no client.channel');

        client.channel.on('connect', () => {
            timings.clientConnected = nowFn();
            client.channel?.send('hello world');
        });

        client.channel.on('message', (data) => {
            timings.clientRecievedMessage = nowFn();
            if (data.toString() == 'hello world') {
                console.debug(
                    // eslint-disable-next-line max-len
                    `Timings: client_connected (${timings.clientConnected}ms), server_connected (${timings.serverConnected}ms), client_first_message (${timings.clientRecievedMessage}ms), server_first_message (${timings.serverRecievedMessage}ms)`,
                );
                done();
            }
        });

        server.on('connection', (channel) => {
            channel.on('connect', () => (timings.serverConnected = nowFn()));
            channel.on('message', () => {
                timings.serverRecievedMessage = nowFn();
                channel.send('hello world');
            });
        });
    })();
});
