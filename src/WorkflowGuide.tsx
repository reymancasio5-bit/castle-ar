import './WorkflowGuide.css';

const steps = [
  {
    title: 'Choose the month and your properties',
    when: 'Before each work session',
    who: 'Everyone updating or reviewing records',
    how: <>Select the reporting month and click <strong>Refresh records</strong>. Use the manager filter to find your team’s properties, then search for the property you need.</>,
  },
  {
    title: 'Check the expected amounts',
    when: 'At the start of the month, or when an amount changes',
    who: 'Account manager',
    how: <>Open each property and check its <strong>Expected amount</strong> against the monthly records. Correct it and <strong>Save changes</strong>. Use <strong>Add property</strong> for missing properties. For bulk updates, use <strong>Import Excel</strong>, choose the destination field, and review the proposed changes before importing.</>,
  },
  {
    title: 'Record incoming payments',
    when: 'When a platform payout or owner payment is confirmed',
    who: 'Account manager',
    how: <>Open the property’s Airbnb, Vrbo, or Owner payment row. Enter the <strong>Payment amount</strong> and <strong>Payout date</strong>, and add the <strong>Bundle amount</strong> when available. Select <strong>Save changes</strong>. Collected and outstanding totals update automatically.</>,
  },
  {
    title: 'Follow up with the owner',
    when: 'Whenever a property has an outstanding balance',
    who: 'Account manager',
    how: <>The account manager must follow up with the property owner whenever an outstanding balance remains. Select <strong>Outstanding</strong> and filter by manager to find these properties. Contact the owner, explain the unpaid balance, and confirm when payment will be made. Continue following up until the balance is settled, and update the payment rows as collections are confirmed.</>,
  },
  {
    title: 'Reconcile deposits and verify payments',
    when: 'When bank deposits and supporting records are available',
    who: 'Daisy',
    how: <>Open <strong>Reconciliation</strong> and use <strong>Needs verification</strong> to find properties to review. Open a property, compare its payout record with the bank deposit, and enter the <strong>Bank amount</strong> and <strong>Bank date</strong>. <strong>Matched</strong> means the bundle and bank amounts agree; <strong>Pending</strong> means an amount is missing. Investigate any <strong>Mismatch</strong>. After completing the manual review, select <strong>Verified by Daisy</strong> and <strong>Save changes</strong>.</>,
  },
  {
    title: 'Review the month together',
    when: 'Before the monthly team review or handoff',
    who: 'Account manager and Daisy',
    how: <>Refresh records and review <strong>Outstanding</strong> balances and payments awaiting verification. Agree who will follow up on each unresolved item. Use <strong>Export workbook</strong> to download the selected month for the team’s review.</>,
  },
];

export default function WorkflowGuide() {
  return <div className="help-content workflow-guide">
    <p className="workflow-intro">Use this guide to keep monthly records current, follow up on collections, and hand payments over for review.</p>
    <ol className="workflow-steps">
      {steps.map(step => <li key={step.title}>
        <h3>{step.title}</h3>
        <dl className="workflow-details">
          <div><dt>When</dt><dd>{step.when}</dd></div>
          <div><dt>Who</dt><dd>{step.who}</dd></div>
          <div><dt>How</dt><dd>{step.how}</dd></div>
        </dl>
      </li>)}
    </ol>
    <aside className="workflow-note" aria-label="Before moving on">
      <h3>Before moving on</h3>
      <p>Wait for the “Changes saved to Google Sheets.” confirmation. In the property editor, enter <strong>zero</strong> for a confirmed zero payment; clearing an amount removes it.</p>
      <p>If a verified payment needs correction, clear <strong>Verified by Daisy</strong> and have Daisy review it again. Editing payment details does not clear that check automatically.</p>
    </aside>
  </div>;
}
