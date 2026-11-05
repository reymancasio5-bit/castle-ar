import type {Change} from './types';
export interface AssistantReport {title:string;markdown:string;format:'pdf'|'xlsx'|'txt'}
export interface AssistantImport {kind:'bank'|'excel';attachmentId:string;monthId:string}
export interface AssistantAttachment {id:string;name:string;kind:'document'|'image';text?:string;dataUrl?:string}
export interface AssistantMessage {role:'user'|'assistant';content:string;report?:AssistantReport;importAction?:AssistantImport;chooseReportFormat?:boolean}
export interface AssistantRequest {message:string;monthId:string;history:AssistantMessage[];attachment?:AssistantAttachment;reportFormat?:'pdf'|'xlsx'|'txt'}
export interface AssistantReply {text:string;report?:AssistantReport;importAction?:AssistantImport;chooseReportFormat?:boolean;proposal?:{revision:string;changes:Change[]}|null}
