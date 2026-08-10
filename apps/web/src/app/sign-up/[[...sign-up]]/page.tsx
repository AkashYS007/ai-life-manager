import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center">
      <SignUp />
    </main>
  );
}
