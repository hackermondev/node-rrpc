/* eslint-disable no-param-reassign */
import { EventEmitter } from 'stream';
import { RRPCBase } from './Base';
import {
    IChannelMessage,
    IChannelMessageData,
    ICreateChannPacket,
    Packet,
} from '../types/messages';
import { MessageOps } from '../types/ops';
import Queue, { ProcessFunctionCb } from 'better-queue';

export enum ChannelState {
    Disconnected = 0,
    Connecting = 1,
    FullyConnected = 3,
}

export declare interface Channel {
    on(event: 'connect', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'close-ack', listener: () => void): this;
    on(event: 'message-ack', listener: () => void): this;
    on(event: 'pong', listener: (ref: string) => void): this;
    on(event: 'message', listener: (data: number | string | Buffer | object) => void): this;
}

export class Channel extends EventEmitter {
    public id: string;
    public state: ChannelState;
    private lastRecievedSequence: number;
    private messageSequence: number;
    private readonly base: RRPCBase;
    private readonly isServer: boolean;
    private readonly queue: Queue;
    _pingInterval?: NodeJS.Timer;
    pingInterval: number;

    private redisPrefix: string;
    private redisPubName?: string;
    private redisSubName?: string;

    constructor(
        base: RRPCBase,
        as: 'client' | 'server',
        { pingInterval } = {
            pingInterval: 3 * 1000,
        },
    ) {
        super();
        this.id = '';
        this.queue = new Queue({ concurrent: 1, process: this.processMessageCallback.bind(this) });
        this.state = ChannelState.Connecting;
        this.base = base;

        this.lastRecievedSequence = -1;
        this.messageSequence = 0;
        this.isServer = as == 'server';
        this.redisPrefix = `rrpc:${this.base.name}/${base.server_name}`;
        this.pingInterval = pingInterval;
    }

    private async processMessageCallback(message: Packet, callback: ProcessFunctionCb<boolean>) {
        switch (message.op) {
            /* Initial connection */
            // Server -> Client
            case MessageOps.Hello: {
                const helloAck = { op: MessageOps.HelloAck } as Packet;
                await this.sendPacket(helloAck);

                this.state = ChannelState.FullyConnected;
                this.emit('connect');
                break;
            }

            // Client -> Server
            case MessageOps.HelloAck: {
                this.state = ChannelState.FullyConnected;
                this.emit('connect');
                break;
            }

            /* Connection keepalive */
            case MessageOps.Ping: {
                this.emit('ping');
                const pongPacket = { op: MessageOps.Pong } as Packet;
                this.sendPacket(pongPacket);
                break;
            }

            case MessageOps.Pong: {
                this.emit('pong');
                break;
            }

            /* Handling service messages */
            case MessageOps.Message: {
                const packet = message as IChannelMessage;

                const decoded = Buffer.from(packet.data, 'base64');
                let result: null | (number | string | Buffer | object) = null;

                if (packet.messageData.messageType == 'number')
                    result = parseInt(decoded.toString());
                else if (packet.messageData.messageType == 'object')
                    result = JSON.parse(decoded.toString());
                else if (packet.messageData.messageType == 'string') result = decoded.toString();
                else if (packet.messageData.messageType == 'buffer') result = decoded;

                const messageAckPacket: Packet = { op: MessageOps.MessageAck };
                await this.sendPacket(messageAckPacket);
                this.emit('message', result);
                break;
            }

            case MessageOps.MessageAck: {
                this.emit('message-ack');
                break;
            }

            case MessageOps.ChannelCloseReq: {
                const ack = { op: MessageOps.ChannelCloseAck } as Packet;

                await this.sendPacket(ack);
                await this._close();
                break;
            }

            case MessageOps.ChannelCloseAck: {
                this.emit('close-ack');
                break;
            }
        }

        callback(null, true);
    }

    async sendPacket(packet: Packet, { messageSequence }: { messageSequence?: number } = {}) {
        if (!this.redisPubName) throw new Error('not connected');
        if (this.state == ChannelState.Disconnected) throw new Error('not connected');

        if (messageSequence != undefined) packet.sequence = messageSequence;
        else packet.sequence = this.messageSequence;

        this.base.debug(
            'message sequence',
            packet.sequence,
            this.isServer ? 'server' : 'client',
            packet.op,
        );
        const parsed = this.base.parseOutgoingMessage(packet);

        if (messageSequence == undefined) this.messageSequence += 1;
        await this.base.redis2.publish(this.redisPubName, parsed);
    }

    async connect(createChann: ICreateChannPacket) {
        const to = this.isServer ? 'client' : 'server';
        const from = this.isServer ? 'server' : 'client';

        const redisPubName = `${this.redisPrefix}/chann${createChann.id}/${to}-events`;
        const redisSubName = `${this.redisPrefix}/chann${createChann.id}/${from}-events`;

        this.redisPubName = redisPubName;
        this.redisSubName = redisSubName;

        const redis = this.base.redis;
        this.state = ChannelState.Connecting;

        const messageCallback = (channel: string, raw: string) => {
            if (channel != redisSubName) return;
            const data = this.base.parseIncomingMessage(Buffer.from(raw));

            this.base.debug(data);
            if (
                (data.sequence != undefined &&
                    (data.sequence - this.lastRecievedSequence > 1 ||
                        data.sequence - this.lastRecievedSequence < 1)) ||
                data.sequence == undefined
            ) {
                if (data.sequence == undefined) {
                    this.base.debug('no message sequence sent', data);
                    return;
                }

                this.base.debug(
                    'got message early',
                    data,
                    `(last recieved: ${this.lastRecievedSequence}, message seq: ${data.sequence})`,
                    data.sequence - this.lastRecievedSequence,
                );

                // process.nextTick(() => messageCallback(channel, raw));
                return 1;
            }

            this.lastRecievedSequence = data.sequence;
            this.queue.push(data);
            this.base.debug('added', data.op, 'to queue');
            this.base.debug(`${channel} <-`, data);
        };

        redis.on('message', messageCallback);
        await redis.subscribe(this.redisSubName);

        this.base.debug('connected to channel, subscribed redis to', redisSubName);
        if (this.isServer) {
            const packet = { op: MessageOps.Hello } as Packet;

            await new Promise((resolve, reject) => {
                let tries = 1;
                this.on('connect', () => {
                    clearInterval(helloInterval);
                    resolve(1);
                });

                this.sendPacket(packet);
                const helloInterval = setInterval(() => {
                    if (tries > 20) {
                        clearInterval(helloInterval);
                        return reject(new Error('Connection timeout'));
                    }

                    // HELLO packet should always be message sequence 0
                    this.sendPacket(packet, { messageSequence: 0 });
                    tries += 1;
                }, 500);
            });
        } else {
            await new Promise((resolve) => {
                this.on('connect', () => resolve(1));
            });
        }

        /* Ping */
        const callback: () => Promise<unknown> = async () => {
            if (this.state != ChannelState.FullyConnected) return;

            const recievedPong = await this.ping();
            if (!recievedPong) {
                this.base.debug('no respond to ping request');
                return this._close();
            }

            return setTimeout(callback, this.pingInterval).unref();
        };
        this._pingInterval = setTimeout(callback, this.pingInterval).unref();
    }

    private async _close() {
        this.state = ChannelState.Disconnected;
        this.emit('close');

        this.base.debug(this.state, this.isServer);
        if (this.redisSubName) await this.base.redis.unsubscribe(this.redisSubName);
        await new Promise((resolve) => this.queue.destroy(() => resolve(1)));
        return 1;
    }

    close({ timeout } = { timeout: 5_000 }) {
        if (this.state != ChannelState.FullyConnected) throw new Error('Not fully connected');
        const packet = { op: MessageOps.ChannelCloseReq } as Packet;

        this.base.debug('sent close request');
        this.sendPacket(packet);
        return new Promise((resolve, reject) => {
            this.once('close-ack', async () => {
                await this._close();
                resolve(1);
                clearTimeout(timeout_);
            });

            const timeout_ = setTimeout(() => {
                reject(new Error('Close request timeouted'));
            }, timeout);
        });
    }

    private async ping(timeout = 10 * 1000): Promise<boolean> {
        this.base.debug('(ping)', 'state', this.state, this.isServer);
        const ping = { op: MessageOps.Ping } as Packet;
        return await new Promise((resolve) => {
            const callback = () => {
                clearInterval(timeoutInterval);
                this.removeListener('pong', callback);
                resolve(true);
            };

            this.on('pong', callback);
            const timeoutInterval = setTimeout(() => {
                this.removeListener('pong', callback);
                resolve(false);
            }, timeout).unref();
            this.sendPacket(ping);
        });
    }

    async send(raw: Buffer | string | object) {
        if (this.state != ChannelState.FullyConnected) throw new Error('Not fully connected');

        const messageData = { messageType: 'buffer' } as IChannelMessageData;
        if (typeof raw == 'object' && !Buffer.isBuffer(raw)) {
            raw = JSON.stringify(raw);
            messageData.messageType = 'object';
        }

        if (typeof raw == 'string') messageData.messageType = 'string';
        if (typeof raw == 'number') messageData.messageType = 'number';
        if (Buffer.isBuffer(raw)) messageData.messageType = 'buffer';

        if (typeof raw != 'string' && typeof raw != 'object') raw = (raw as number).toString();

        const packet = {
            op: MessageOps.Message,
            createdAt: new Date().toString(),
            data: Buffer.from(raw).toString('base64'),
            messageData,
        } as IChannelMessage;

        return await new Promise((resolve) => {
            this.on('message-ack', () => resolve(true));
            this.sendPacket(packet);
        });
    }
}
