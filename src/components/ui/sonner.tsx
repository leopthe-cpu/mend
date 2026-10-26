import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Toasts follow the design rules: white card on the grey canvas, text no
// smaller than 14 px (Sonner's defaults are 12–13 px, hence the `!`), pill
// buttons with a 44 px target, primary blue for the action.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // Clickable even while a dialog is open (Radix turns pointer events off
      // outside a modal dialog).
      className="toaster group pointer-events-auto"
      toastOptions={{
        classNames: {
          // Text on its own line, buttons underneath (long messages stay readable).
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:rounded-lg group-[.toaster]:shadow-[0_2px_16px_rgba(0,0,0,0.08)] text-base! flex-wrap! gap-x-2! gap-y-3!",
          content: "basis-full",
          title: "text-base! font-semibold",
          description: "group-[.toast]:text-muted-foreground text-sm!",
          actionButton:
            "bg-primary! text-primary-foreground! rounded-full! min-h-11! px-5! text-sm! font-semibold ml-0!",
          cancelButton:
            "bg-card! text-primary! border! border-primary! rounded-full! min-h-11! px-5! text-sm! font-semibold",
          closeButton: "size-11! bg-card! border-border! -top-3! -left-3!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
