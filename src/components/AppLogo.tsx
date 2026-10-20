export function AppLogo({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const logoClasses = ["appLogo", size, className].filter(Boolean).join(" ");

  return (
    <span className={logoClasses} aria-hidden="true">
      <img
        src="/app-icon.png"
        alt=""
        draggable={false}
        onError={(event) => {
          event.currentTarget.style.display = "none";
          event.currentTarget.nextElementSibling?.removeAttribute("hidden");
        }}
      />
      <span hidden>KP</span>
    </span>
  );
}
