import { Redis } from 'ioredis';
import _ from 'lodash';
import { RRPCBase } from './Base';
import { ICreateChannPacket } from '../types/messages';
import { MessageOps } from '../types/ops';
import { Channel } from './Channel';

export class RRPCClient extends RRPCBase {
    private _channel?: Channel;
    public _clusterId?: string;
    constructor(serverName: string, redis: Redis, baseName = 'rrpc') {
        super(baseName, redis);
        this.server_name = serverName;
    }

    get channel() {
        if (!this._channel) throw new Error('client not connected yet, no channel');
        return this._channel;
    }

    async start() {
        if (this._channel) throw new Error('Client channel for service already exists');

        const clusters = await this.redis.keys(
            `rrpc:${this.name}/${this.server_name}/subscription/*`,
        );
        if (clusters.length == 0) throw new Error('No available clusters');

        this.debug('possible clusters', clusters);
        const cluster = _.sample(clusters) as string;
        const clusterId = cluster.split('/')[3];

        this.debug('picked cluster', clusterId);
        this._clusterId = clusterId;
        const Channel0 = `rrpc:${this.name}/${this.server_name}/${clusterId}/channel0`;
        const rand = Math.floor(Math.random() * 50000);
        const message: ICreateChannPacket & { op: MessageOps } = {
            op: MessageOps.CreateChannelRequest,
            id: rand.toString(),
        };

        this.redis2.publish(Channel0, this.parseOutgoingMessage(message));
        this.debug('created channel');

        const channel = new Channel(this, 'client');
        this._channel = channel;
        const result = await channel.connect(message).catch((err) => err);

        if (result instanceof Error) throw result;
        return channel;
    }
}
