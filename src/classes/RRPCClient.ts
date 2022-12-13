import { Redis } from 'ioredis';
import { RRPCBase } from './Base';
import { ICreateChannMessage, MessageOPs } from '../types/messages';
import { Channel } from './Channel';

export class RRPCClient extends RRPCBase {
    public channel?: Channel;
    constructor(serverName: string, redis: Redis, baseName = 'rrpc') {
        super(baseName, redis);
        this.server_name = serverName;
    }

    start(channelType: 'oneway' | 'stream' = 'stream') {
        if(this.channel) throw new Error('Client channel for service already exists');

        const Channel0 = `${this.name}/${this.server_name}/channel0`;
        const rand = Math.floor(Math.random() * 50000);
        const message: ICreateChannMessage & { op: MessageOPs } = {
            op: 'createchan',
            id: rand.toString(),
            type: channelType,
        };

        this.redis2.publish(Channel0, this.parseOutgoingMessage(message));
        this.debug('created channel');

        const channel = new Channel(channelType, this, 'client');
        channel.connect(message);

        this.channel = channel;
        return channel;
    }
}