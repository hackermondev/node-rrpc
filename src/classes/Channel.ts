/* eslint-disable no-param-reassign */
import { EventEmitter } from 'stream';
import { RRPCBase } from './Base';
import {
    ChannType,
    IChannelCloseRequest,
    IChannelMessage,
    IChannelPing,
    ICheckConnectionPacket,
    ICreateChannPacket,
} from '../types/messages';
import { MessageOps } from '../types/ops';
import { customAlphabet } from 'nanoid/async';

export enum ChannelState {
    Disconnected = 0,
    Connecting = 1,
    PartiallyConnected = 2, // Server is connected but client is not connected
    FullyConnected = 3, // Server & client are connected
}

interface IChannelMessage2 {
    createdAt: string;
    data: Buffer;
    id: string;
    to: 'client' | 'server';
}
const nanoid = customAlphabet('1234567890abcdef', 10);
export declare interface Channel {
    on(event: 'connect', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'pong', listener: (ref: string) => void): this;
    on(
        event: 'message',
        listener: (data: Buffer, message: IChannelMessage, messageCount: number) => void,
    ): this;
}

export class Channel extends EventEmitter {
    public readonly type: ChannType;
    public id: string;
    public state: ChannelState;
    public recievedMessagesCount: number;
    private readonly base: RRPCBase;
    private readonly isServer: boolean;
    private readonly _interval: NodeJS.Timeout;
    private readonly connectionTimeout: number;
    private redisPubName: string;

    constructor(
        type: ChannType,
        server: RRPCBase,
        as: 'client' | 'server',
        { pingInterval, connectionTimeout } = {
            pingInterval: 3 * 1000,
            connectionTimeout: 3 * 1000,
        },
    ) {
        super();
        this.id = '';
        this.type = type;
        this.state = ChannelState.Disconnected;
        this.base = server;
        this.connectionTimeout = connectionTimeout;

        this.recievedMessagesCount = 0;
        this.isServer = as == 'server';
        this.redisPubName = `${this.base.name}/${server.server_name}`;

        this._interval = setInterval(async () => {
            if (this.state != ChannelState.FullyConnected) return;

            const recievedPong = await this.ping();
            if (!recievedPong && this.state == ChannelState.FullyConnected) return this.close(true);
        }, pingInterval);
        this._interval.unref();
    }

    async connect(createChann: ICreateChannPacket) {
        this.redisPubName = `${this.redisPubName}/chann${createChann.id}`;
        const redis = this.base.redis;
        const name = this.redisPubName;

        this.state = ChannelState.Connecting;
        const c: ICheckConnectionPacket & { op: MessageOps } = {
            connected: this.isServer ? 'server' : 'client',
            waitingForOtherConnection: true,
            op: MessageOps.ConnectionCheck,
        };

        const messageCallback = (channel: string, raw: string) => {
            if (channel != name) return;
            const data = this.base.parseIncomingMessage(Buffer.from(raw));

            this.base.debug(channel, data);
            if (data.op == MessageOps.ConnectionCheck) {
                // Connection check
                const packet = data as ICheckConnectionPacket;
                if (packet.connected == (this.isServer ? 'client' : 'server')) {
                    if (packet.waitingForOtherConnection) {
                        c.waitingForOtherConnection = false;
                        this.base.redis2.publish(name, this.base.parseOutgoingMessage(c));
                    }

                    this.state = ChannelState.FullyConnected;
                    this.emit('connect');
                }
            } else if (data.op == MessageOps.Message) {
                // Channel message
                const packet = data as IChannelMessage;
                if (packet.to == (this.isServer ? 'client' : 'server')) return;
                if (this.state != ChannelState.FullyConnected)
                    this.state = ChannelState.FullyConnected;
                this.base.debug(this.id, 'recieved chann message', packet, this.isServer);

                this.recievedMessagesCount += 1;
                this.emit(
                    'message',
                    Buffer.from(packet.data, 'base64'),
                    data,
                    this.recievedMessagesCount,
                );

                if (
                    !this.isServer &&
                    this.type == 'oneway' &&
                    this.state == ChannelState.FullyConnected &&
                    this.recievedMessagesCount == 1
                ) {
                    this.base.debug('closing channel because one-way message finished');
                    this.close();
                }
            } else if (data.op == MessageOps.ChannelCloseReq) {
                const packet = data as IChannelMessage;
                if (packet.to == (this.isServer ? 'server' : 'client')) return;

                this.base.debug(this.id, 'recieved close chann request', packet);
                this.state = ChannelState.Disconnected;

                this.emit('close');
                this.base.redis.unsubscribe(this.redisPubName);
                this.base.debug(this.id, 'unsubscribed');

                redis.removeListener('message', messageCallback);
            } else if (data.op == MessageOps.Ping || data.op == MessageOps.Pong) {
                const packet = data as IChannelPing;
                if (packet.to == (this.isServer ? 'client' : 'server')) return;

                if (data.op == MessageOps.Pong) return this.emit('pong', packet.ref);

                const pong: IChannelPing & { op: MessageOps } = {
                    op: MessageOps.Pong,
                    ref: packet.ref,
                    to: this.isServer ? 'client' : 'server',
                };

                this.base.redis2.publish(this.redisPubName, this.base.parseOutgoingMessage(pong));
            }
        };

        this.state = ChannelState.PartiallyConnected;
        redis.on('message', messageCallback);
        await redis.subscribe(name);
        await this.base.redis2.publish(name, this.base.parseOutgoingMessage(c));

        this.base.debug('connected to channel, subscribed redis to', name);

        await new Promise((resolve, reject) => {
            this.on('connect', () => resolve(1));
            setTimeout(() => {
                if (this.state == ChannelState.PartiallyConnected) {
                    reject(new Error('Connection timeout'));
                }
            }, this.connectionTimeout);
        });
    }

    close(force?: boolean) {
        if (this.state != ChannelState.FullyConnected) throw new Error('Not fully connected');
        const packet: IChannelCloseRequest & { op: MessageOps } = {
            op: MessageOps.ChannelCloseReq,
            to: this.isServer ? 'client' : 'server',
        };

        if (force == true) {
            this.base.debug('forcing close request');
            packet.to = this.isServer ? 'server' : 'client';
            return this.base.redis2.publish(
                this.redisPubName,
                this.base.parseOutgoingMessage(packet),
            );
        }

        this.base.debug('send close request');
        return this.base.redis2.publish(this.redisPubName, this.base.parseOutgoingMessage(packet));
    }

    async ping(timeout = 10 * 1000): Promise<boolean> {
        const ref = await nanoid();
        const ping: IChannelPing & { op: MessageOps } = {
            op: MessageOps.Pong,
            ref,
            to: this.isServer ? 'client' : 'server',
        };

        this.base.redis2.publish(this.redisPubName, this.base.parseOutgoingMessage(ping));
        return await new Promise((resolve) => {
            const callback = (id: string) => {
                if (id == ref) {
                    clearInterval(timeoutInterval);
                    this.removeListener('pong', callback);
                    resolve(true);
                }
            };

            this.on('pong', callback);
            const timeoutInterval = setTimeout(() => {
                this.removeListener('pong', callback);
                resolve(false);
            }, timeout).unref();
        });
    }

    async send(raw: Buffer | string | object, options: { packet_id?: string } = {}) {
        if (this.state != ChannelState.FullyConnected) throw new Error('Not fully connected');

        if (typeof raw == 'object' && !Buffer.isBuffer(raw)) raw = JSON.stringify(raw);
        if (typeof raw != 'string' && typeof raw != 'object') raw = (raw as number).toString();

        const data = Buffer.from(raw);
        const packet: IChannelMessage & { op: MessageOps } = {
            op: MessageOps.Message,
            createdAt: new Date().toString(),
            data: data.toString('base64'),
            id: options.packet_id || (await nanoid()),
            to: this.isServer ? 'client' : 'server',
        };

        await this.base.redis2.publish(this.redisPubName, this.base.parseOutgoingMessage(packet));
        return packet;
    }

    async reply(raw: Buffer | string | object, packet_id?: string): Promise<IChannelMessage2> {
        const id = packet_id || (await nanoid());
        return await new Promise((resolve) => {
            const messageCallback: (data: Buffer, packet2: IChannelMessage) => void = (
                data,
                packet2,
            ) => {
                if (packet2.id != id) return;
                const p: IChannelMessage2 = { ...packet2, data };
                resolve(p);

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                //@ts-ignore
                this.removeListener('message', messageCallback);
            };

            this.on('message', messageCallback);
            this.send(raw, { packet_id: id });
        });
    }
}
