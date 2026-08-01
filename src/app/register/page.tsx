import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full max-w-sm flex-col gap-1">
        <p className="text-xs tracking-wide text-muted uppercase">Create account</p>
        <h1 className="text-2xl font-light">Get started.</h1>
      </div>
      <RegisterForm />
    </main>
  );
}
