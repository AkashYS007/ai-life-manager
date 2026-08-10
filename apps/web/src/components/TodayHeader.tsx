export function TodayHeader({ greeting, name }: { greeting: string; name: string }) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="px-5 pt-6 pb-3">
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">{today}</p>
      <h1 className="mt-0.5 text-2xl font-medium text-text-primary dark:text-text-primary-dark">
        {greeting}, {name}
      </h1>
    </div>
  );
}
