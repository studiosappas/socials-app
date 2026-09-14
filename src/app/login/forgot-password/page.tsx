import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full max-w-sm flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Account recovery</p>
        <h1 className="text-2xl font-light">Reset your password.</h1>
        <p className="mt-2 text-sm text-muted">
          Enter the email address associated with your account and we&apos;ll send you a reset link.
        </p>
      </div>
      <ForgotPasswordForm />
    </main>
  );
}
