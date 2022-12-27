import _ from 'lodash';
import { Channel } from './Channel';

export type MessageContentType = number | string | Buffer | object;
export class Message {
    public readonly content: MessageContentType;
    public reply: (content: MessageContentType) => Message;
    private readonly channel: Channel;

    constructor(content: MessageContentType, channel: Channel, messageId: string) {
        this.content = content;
        this.channel = channel;

        this.reply = _.bind(this.channel.send, this.channel, _, { messageId, waitForReply: false });
    }
}
