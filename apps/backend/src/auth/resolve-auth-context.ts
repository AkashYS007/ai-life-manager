import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { AuthContext } from './auth-context';

// The exact two-strategy check AuthGuard has always done for a plain HTTP
// GraphQL request, pulled out into its own function so a second transport
// (the graphql-ws WebSocket connection the Real-time chat streaming
// increment adds — see app.module.ts's `onConnect`) can run the identical
// check against its own `connectionParams` instead of duplicating the
// Clerk-verification code a second time. `headers` is deliberately typed
// as a generic string-keyed record rather than Express's real Headers type
// — a WebSocket connection has no real HTTP headers of its own, only a
// client-supplied `connectionParams` object, so the caller on that side
// passes that object here directly, using the exact same key names
// (`x-dev-user-email` / `authorization`) an HTTP request would have used.
export async function resolveAuthContext(
  headers: Record<string, unknown>,
  authMode: string | undefined,
  config: ConfigService,
): Promise<AuthContext> {
  if (authMode === 'dev') {
    const email = headers['x-dev-user-email'];
    if (!email || typeof email !== 'string') {
      throw new UnauthorizedException('AUTH_MODE=dev requires an x-dev-user-email header. See .env.example.');
    }
    return { authProviderId: `dev:${email}`, email };
  }

  const authHeader = headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing bearer token');
  }
  const token = authHeader.slice('Bearer '.length);

  const secretKey = config.get<string>('CLERK_SECRET_KEY')!;
  const clerkClient = createClerkClient({ secretKey });
  const verified = await verifyToken(token, { secretKey });
  const clerkUser = await clerkClient.users.getUser(verified.sub);
  const primaryEmail = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress;

  if (!primaryEmail) {
    throw new UnauthorizedException('Clerk user has no primary email address');
  }

  return { authProviderId: clerkUser.id, email: primaryEmail };
}
