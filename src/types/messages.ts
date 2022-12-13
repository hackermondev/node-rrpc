import { MessageOps } from './ops';

export type ChannType = 'oneway' | 'stream';
export interface ICreateChannMessage {
    id: string;
    type: ChannType;
    name?: string;
}
export interface ICheckConnectionMessage {
    connected: 'client' | 'server';
    waitingForOtherConnection: boolean;
}
export interface IChannelMessage {
    createdAt: number;
    data: string;
    id: string;
    to: 'client' | 'server';
}
export interface IChannelCloseRequest {
    to: 'client' | 'server';
}

export type Message = (
    | ICreateChannMessage
    | ICheckConnectionMessage
    | IChannelMessage
    | IChannelCloseRequest
) & { op: MessageOps };
