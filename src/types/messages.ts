

export type ChannType = ('oneway' | 'stream');
export interface ICreateChannMessage { id: string, type: ChannType, name?: string };
export interface ICheckConnectionMessage { connected: 'client' | 'server', waitingForOtherConnection: boolean };
export interface IChannelMessage { createdAt: Number; data: string; id: string, to: 'client' | 'server' };
export interface IChannelCloseRequest  { to: 'client' | 'server' };

export type MessageOPs = ('createchan' | 'connection' | 'connmessage' | 'channclosereq' );
export type Message = (ICreateChannMessage | ICheckConnectionMessage | IChannelMessage | IChannelCloseRequest) & { op: MessageOPs };