'use client';
// "Save as PDF": opens the browser's print dialog; docs.module.css hides the navigation in print.
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      Save as PDF
    </button>
  );
}
