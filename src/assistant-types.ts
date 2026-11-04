import type {Change} from './types';
export interface AssistantMessage {role:'user'|'assistant';content:string}
export interface AssistantRequest {message:string;monthId:string;history:AssistantMessage[]}
export interface AssistantReply {text:string;proposal?:{revision:string;changes:Change[]}|null}
