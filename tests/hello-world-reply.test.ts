/* eslint-env jest */

import { RRPCServer, RRPCClient } from '../src';
import Redis from 'ioredis-mock';

// Using the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

test('should be able to send and recieve and simple oneway hello world data with reply feature', (done) => {
    (async () => {
        const server = new RRPCServer('hello-world-service', redis1);
        const client = new RRPCClient('hello-world-service', redis2);
        await server.run();

        client.start();
        client.channel.on('connect', async () => {
            const { data } = await client.channel.reply('hello world');
            if (data.toString() == 'hello world') {
                done();
            }
        });

        client.channel.on('message', (data) => {
            if (data.toString() == 'hello world') done();
        });

        server.on('connection', (channel) => {
            channel.on('message', (_, packet) => {
                channel.send('hello world', { packet_id: packet.id });
            });
        });
    })();
});