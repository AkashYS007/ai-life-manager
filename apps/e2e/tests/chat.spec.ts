import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Chat', () => {
  test('sending a message starts a new conversation and shows a reply', async ({ page }) => {
    const message = unique('E2E chat message');

    await page.goto('/chat');
    await page.getByLabel('Message').fill(message);
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    // The user's own message renders immediately once the mutation
    // resolves (this app has no optimistic UI here — see ChatPage's
    // request/reply comment — so seeing this at all confirms the round
    // trip to the backend really happened).
    await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 30_000 });

    // A real AI reply follows in its own bubble — "New chat" only appears
    // once a conversation actually exists, so its presence alone confirms
    // the conversation was really created server-side, not just echoed
    // locally.
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible({ timeout: 30_000 });
  });

  // Tool-calling actions in Chat increment. Deliberately phrased as an
  // explicit, unambiguous instruction (not a vague mention) — the real AI
  // decides on its own whether to call a tool, the same inherent
  // nondeterminism ai-plan-review.spec.ts and recommendations.spec.ts
  // already accept for their own real AI calls, just narrowed here as far
  // as reasonably possible by not leaving room for the model to interpret
  // this as "just chat about it instead."
  test('asking the AI to add a task actually creates it — a real tool call, not just a reply', async ({ page }) => {
    const title = unique('E2E chat tool task');

    await page.goto('/chat');
    await page.getByLabel('Message').fill(`Please add a new task titled exactly "${title}". Just add it, don't ask me anything first.`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    // The TOOL event renders as its own centered "✓ ..." pill (see
    // ChatPage's MessageBubble) — distinct from the AI's own spoken reply
    // bubbles on either side of it.
    await expect(page.getByText(`✓ Added task: "${title}"`, { exact: false })).toBeVisible({ timeout: 30_000 });

    // And the real task genuinely exists — not just an announced action.
    await page.goto('/tasks');
    await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
