/* eslint-disable no-param-reassign */
import { EventEmitter } from 'stream';
import { RRPCBase } from './Base';
import {
    ChannType,
    IChannelCloseRequest,
    IChannelMessage,
    ICheckConnectionMessage,
    ICreateChannMessage,
    Message,
} from '../types/messages';
import { MessageOps } from '../types/ops';
import { customAlphabet } from 'nanoid/async';

export enum ChannelState {
    Disconnected = 0,
    Connecting = 1,
    PartiallyConnected = 2, // Server is connected but client is not connected
    FullyConnected = 3, // Server & client are connected
}

const nanoid = customAlphabet('1234567890abcdef', 10);
export declare interface Channel {
    on(event: 'connect', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(
        event: 'message',
        listener: (data: Buffer, message: Message, messageCount: number) => void,
    ): this;
}

export class Channel extends EventEmitter {
    public readonly type: ChannType;
    public id: string;
    public state: ChannelState;
    public recievedMessagesCount: number;
    private readonly base: RRPCBase;
    private readonly isServer: boolean;
    private redisPubName: string;

    constructor(type: ChannType, server: RRPCBase, as: 'client' | 'server') {
        super();
        this.id = '';
        this.type = type;
        this.state = ChannelState.Disconnected;
        this.base = server;

        this.recievedMessagesCount = 0;
        this.isServer = as == 'server';
        this.redisPubName = `${this.base.name}/${server.server_name}`;
    }

    async connect(createChann: ICreateChannMessage) {
        this.redisPubName = `${this.redisPubName}/chann${createChann.id}`;
        const redis = this.base.redis;
        const name = this.redisPubName;

        this.state = ChannelState.Connecting;
        const c: ICheckConnectionMessage & { op: MessageOps } = {
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
                const message = data as ICheckConnectionMessage;
                if (message.connected == (this.isServer ? 'client' : 'server')) {
                    if (message.waitingForOtherConnection) {
                        c.waitingForOtherConnection = false;
                        this.base.redis2.publish(name, this.base.parseOutgoingMessage(c));
                    }

                    this.state = ChannelState.FullyConnected;
                    this.emit('connect');
                }
            } else if (data.op == MessageOps.Message) {
                // Channel message
                const message = data as IChannelMessage;
                if (message.to == (this.isServer ? 'client' : 'server')) return;
                this.base.debug(this.id, 'recieved chann message', message, this.isServer);

                this.recievedMessagesCount += 1;
                this.emit(
                    'message',
                    Buffer.from(message.data, 'base64'),
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
                const message = data as IChannelMessage;
                if (message.to == (this.isServer ? 'server' : 'client')) return;

                this.base.debug(this.id, 'recieved close chann request', message);
                this.state = ChannelState.Disconnected;

                this.emit('close');
                this.base.redis.unsubscribe(this.redisPubName);
                this.base.debug(this.id, 'unsubscribed');

                redis.removeListener('message', messageCallback);
            }
        };

        redis.on('message', messageCallback);
        await redis.subscribe(name);
        await this.base.redis2.publish(name, this.base.parseOutgoingMessage(c));

        this.base.debug('connected to channel, subscribed redis to', name);
        this.state = ChannelState.PartiallyConnected;
    }

    close() {
        if (this.state != ChannelState.FullyConnected) throw new Error('Not fully connected');
        const message: IChannelCloseRequest & { op: MessageOps } = {
            op: MessageOps.ChannelCloseReq,
            to: this.isServer ? 'client' : 'server',
        };
        this.base.debug('send close request');
        return this.base.redis2.publish(this.redisPubName, this.base.parseOutgoingMessage(message));
    }

    async send(raw: Buffer | string | object, waitForResponse = true) {
        if (this.state != ChannelState.FullyConnected) throw new Error('Not fully connected');

        if (typeof raw == 'object' && !Buffer.isBuffer(raw)) raw = JSON.stringify(raw);
        if (typeof raw != 'string' && typeof raw != 'object') raw = (raw as number).toString();

        const data = Buffer.from(raw);
        const message: IChannelMessage & { op: MessageOps } = {
            op: MessageOps.Message,
            createdAt: new Date().getTime(),
            data: data.toString('base64'),
            id: await nanoid(),
            to: this.isServer ? 'client' : 'server',
        };
        return await this.base.redis2.publish(
            this.redisPubName,
            this.base.parseOutgoingMessage(message),
        );
    }
}
