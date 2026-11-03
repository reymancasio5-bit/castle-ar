import './WorkflowGuide.css';

const steps = [
  {
    title: "Choose the Month and Your Properties",
    when: 'Before each work session',
    who: 'Everyone updating or reviewing records',
    how: <>Select the reporting month and click <strong>Refresh Records</strong>. Use the manager filter to find your team’s properties, then search for the property you need.</>,
  },
  {
    title: "Check the Expected Amounts",
    when: 'At the start of the month, or when an amount changes',
    who: "Account Manager",
    how: <>Open each property and check its <strong>Expected Amount</strong> against the monthly records. Correct it and <strong>Save Changes</strong>. Use <strong>Add Property</strong> for missing properties. For bulk updates, use <strong>Import Excel</strong>, choose the destination field, and review the proposed changes before importing.</>,
  },
  {
    title: "Record Incoming Payments",
    when: 'When a platform payout or owner payment is confirmed',
    who: "Account Manager",
    how: <>Open the property’s Airbnb, Vrbo, or Owner payment row. Enter the <strong>Payment Amount</strong> and <strong>Payout Date</strong>, and add the <strong>Bundle Amount</strong> when available. Select <strong>Save Changes</strong>. Collected and outstanding totals update automatically.</>,
  },
  {
    title: "Follow up with the Owner",
    when: 'Whenever a property has an outstanding balance',
    who: "Account Manager",
    how: <>Open Follow-ups to assign an account manager, update the contact status, and record notes or screenshots for each property. Save the update to share it with the team. Select <strong>Outstanding</strong> and filter by manager to find these properties. Contact the owner, explain the unpaid balance, and confirm when payment will be made. Continue following up until the balance is settled, and update the payment rows as collections are confirmed.</>,
  },
  {
    title: "Reconcile Deposits and Verify Payments",
    when: 'When bank deposits and supporting records are available',
    who: 'Daisy',
    how: <>Open <strong>Reconciliation</strong> and use <strong>Needs Verification</strong> to find properties to review. Open a property, compare its payout record with the bank deposit, and enter the <strong>Bank Amount</strong> and <strong>Bank Date</strong>. <strong>Matched</strong> means the bundle and bank amounts agree; <strong>Pending</strong> means an amount is missing. Investigate any <strong>Mismatch</strong>. After completing the manual review, select <strong>Verified by Daisy</strong> and <strong>Save Changes</strong>.</>,
  },
  {
    title: "Review the Month Together",
    when: 'Before the monthly team review or handoff',
    who: 'Account manager and Daisy',
    how: <>Refresh records and review <strong>Outstanding</strong> balances and payments awaiting verification. Agree who will follow up on each unresolved item. Use <strong>Export Workbook</strong> to download the selected month for the team’s review.</>,
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
    <aside className="workflow-note" aria-label="Before Moving on">
      <h3>Before Moving on</h3>
      <p>Wait for the “Changes saved to Google Sheets.” confirmation. In the property editor, enter <strong>zero</strong> for a confirmed zero payment; clearing an amount removes it.</p>
      <p>If a verified payment needs correction, clear <strong>Verified by Daisy</strong> and have Daisy review it again. Editing payment details does not clear that check automatically.</p>
    </aside>
  </div>;
}
