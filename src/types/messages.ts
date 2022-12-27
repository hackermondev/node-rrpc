import { MessageOps } from './ops';

export interface Packet {
    op: MessageOps;
    sequence?: number;
}

export type ICreateChannPacket = Packet & {
    id: string;
    name?: string;
};

export interface IChannelMessageData {
    messageType: 'object' | 'number' | 'buffer' | 'string';
}
export type IChannelMessage = Packet & {
    createdAt: string;
    data: string;
    id: string;
    messageData: IChannelMessageData;
};
