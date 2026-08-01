import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full max-w-sm flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Sign in</p>
        <h1 className="text-2xl font-light">Welcome back.</h1>
      </div>
      <LoginForm />
    </main>
  );
}
