// The minimal identity extracted from either a verified Clerk session token
// or the local dev-auth bypass — resolvers never see the difference.
export interface AuthContext {
  authProviderId: string;
  email: string;
}
