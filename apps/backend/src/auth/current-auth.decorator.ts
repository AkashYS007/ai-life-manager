import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthContext } from './auth-context';

// Resolvers read the authenticated identity from context, never from a
// client-supplied argument — the single most load-bearing authorization rule
// in the system (API Design Document §8).
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const gqlContext = GqlExecutionContext.create(context);
  const request = gqlContext.getContext().req;
  return request.authContext as AuthContext;
});
