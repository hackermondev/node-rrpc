import { Redis } from 'ioredis';
import { RRPCBase } from './Base';
import { ICreateChannPacket } from '../types/messages';
import { MessageOps } from '../types/ops';
import { Channel } from './Channel';

export class RRPCClient extends RRPCBase {
    private _channel?: Channel;
    constructor(serverName: string, redis: Redis, baseName = 'rrpc') {
        super(baseName, redis);
        this.server_name = serverName;
    }

    get channel() {
        if (!this._channel) throw new Error('client not connected yet, no channel');
        return this._channel;
    }

    async start(channelType: 'oneway' | 'stream' = 'stream') {
        if (this._channel) throw new Error('Client channel for service already exists');

        const Channel0 = `${this.name}/${this.server_name}/channel0`;
        const rand = Math.floor(Math.random() * 50000);
        const message: ICreateChannPacket & { op: MessageOps } = {
            op: MessageOps.CreateChannelRequest,
            id: rand.toString(),
            type: channelType,
        };

        this.redis2.publish(Channel0, this.parseOutgoingMessage(message));
        this.debug('created channel');

        const channel = new Channel(channelType, this, 'client');
        this._channel = channel;
        await channel.connect(message);

        return channel;
    }
}
