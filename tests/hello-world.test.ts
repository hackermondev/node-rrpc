/* eslint-env jest */

import { RRPCServer, RRPCClient } from '../src';
import Redis from 'ioredis-mock';

// Use the same Redis instance can cause issues so we can two
const redis1 = new Redis();
const redis2 = new Redis();

//@ts-ignore
test('should be able to send and recieve and simple oneway hello world data', (done) => {
    (async () => {
        //@ts-ignore
        const server = new RRPCServer('hello-world-service', redis1);
        //@ts-ignore
        const client = new RRPCClient('hello-world-service', redis2);

        const now = new Date().getTime();
        const nowFn = () => new Date().getTime() - now;

        await server.run();
        const channel = client.start('oneway');
        console.debug('running');
        channel.on('connect', () => {
            console.debug('client connected after', nowFn());
            channel.send('hello world');
        });
        channel.on('message', (data) => {
            console.debug('client recieved message after', nowFn());
            if(data.toString() == 'hello world') done();
        });

        server.on('channel', (channel) => {
            channel.on('connect', () => console.debug('server connected after', nowFn()));
            channel.on('message', () => {
                console.debug('server recieved message after', nowFn());
                channel.send('hello world');
            });
        });
    })();
})