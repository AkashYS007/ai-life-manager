// State design discipline (UI/UX Design Document §6.4): an invitation, not
// an apology. Shown only when there are truly no tasks and no events for
// today — an honest empty state, not faked sample data.
export function PlanEmptyState() {
  return (
    <div className="mx-4 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
      <p className="text-sm font-medium text-ai-accent dark:text-ai-accent-dark">
        Your AI Chief of Staff is ready
      </p>
      <p className="mt-1.5 text-sm text-text-secondary dark:text-text-secondary-dark">
        Nothing on the books yet. Add a task or an event below, or sync a calendar once external
        sync lands, and your day starts filling in here.
      </p>
    </div>
  );
}
