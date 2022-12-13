import { MessageOps } from './ops';

export type ChannType = 'oneway' | 'stream';
export interface ICreateChannPacket {
    id: string;
    type: ChannType;
    name?: string;
}
export interface ICheckConnectionPacket {
    connected: 'client' | 'server';
    waitingForOtherConnection: boolean;
}
export interface IChannelMessage {
    createdAt: string;
    data: string;
    id: string;
    to: 'client' | 'server';
}
export interface IChannelCloseRequest {
    to: 'client' | 'server';
}

export type Message = (
    | ICreateChannPacket
    | ICheckConnectionPacket
    | IChannelMessage
    | IChannelCloseRequest
) & { op: MessageOps };
