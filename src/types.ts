export type PaymentType = 'Airbnb' | 'Vrbo' | 'Owner';
export type FollowUpStatus = 'not_contacted' | 'contact_attempted' | 'awaiting_response' | 'owner_responded' | 'payment_promised' | 'follow_up_needed' | 'resolved';
export interface FollowUpAttachment { name: string; dataUrl: string }
export interface FollowUp { status: FollowUpStatus; note: string; attachments: FollowUpAttachment[]; updatedAt: string }
export interface Payment { id: string; type: PaymentType; amountCents: number | null; payoutDate: string; bundleCents: number | null; bankDate: string; bankCents: number | null; verifiedByDaisy: boolean; }
export interface Property { id: string; name: string; manager: string; managerId?: string; totalCents: number; payments: Payment[]; sourceArCents?: number; followUp?: FollowUp; }
export interface Month { id: string; label: string; month: string; properties: Property[]; }
export interface AccountManager { profileImage?: string; id: string; name: string; email: string; notes: string; active: boolean }
export interface ManagerTask { id: string; managerId: string; title: string; description: string; dueDate: string; status: 'open' | 'in_progress' | 'completed'; propertyKey: string; updatedAt?: string }
export interface ManagerUpdate { id: string; managerId: string; text: string; taskId: string; propertyKey: string; createdAt?: string }
export type ManagerChange = {kind:'saveManager'; manager:AccountManager} | {kind:'saveTask'; task:ManagerTask} | {kind:'addManagerUpdate'; update:ManagerUpdate};
export interface Snapshot { managerProfiles?: number; managerSchema?: number; managers?: AccountManager[]; tasks?: ManagerTask[]; managerUpdates?: ManagerUpdate[]; revision: string; months: Month[]; updatedAt: string; spreadsheetUrl: string; }
export interface InitialPayment { index: number; amountCents: number; payoutDate?: string; bundleCents?: number }
export type ImportedPayment = Omit<InitialPayment, 'index'> & { type?: PaymentType };
export type Change = ManagerChange | { kind: 'updateFollowUp'; propertyId: string; manager: string; status: FollowUpStatus; note: string; attachments: FollowUpAttachment[] } | { kind: 'setTotal'; propertyId: string; amountCents: number } | { kind: 'updatePayment'; paymentId: string; fields: Partial<Omit<Payment, 'id' | 'type'>> } | { kind: 'appendPayments'; propertyId: string; payments: ImportedPayment[] } | { kind: 'addProperty'; monthId: string; name: string; manager: string; totalCents: number; initialPayments?: InitialPayment[]; additionalPayments?: ImportedPayment[] };
export interface ImportProps { managers?: AccountManager[]; onManageManagers?: () => void; month: Month; propertyCatalog?: Pick<Property, 'name' | 'manager'>[]; onClose: () => void; onApply: (changes: Change[]) => Promise<void>; }
