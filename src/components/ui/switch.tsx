export function Switch({
  name,
  defaultChecked,
  checked,
  onChange,
  disabled,
}: {
  name?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        checked={checked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        disabled={disabled}
        className="peer sr-only"
      />
      <span className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-accent peer-disabled:opacity-50" />
      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-card shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform peer-checked:translate-x-4" />
    </label>
  );
}
