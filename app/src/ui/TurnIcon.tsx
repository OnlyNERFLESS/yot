import type { Modifier, Step } from '../lib/api';

const ANGLE: Record<Modifier, number> = {
  straight: 0,
  slight_right: 45,
  right: 90,
  sharp_right: 135,
  uturn: 180,
  sharp_left: -135,
  left: -90,
  slight_left: -45,
};

/** Manoeuvre arrow. Direction is geometric, so it is not mirrored in RTL. */
export function TurnIcon({ step }: { step: Step }) {
  if (step.kind === 'arrive') {
    return (
      <svg className="turn" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 6c-7 0-12 5-12 12 0 9 12 24 12 24s12-15 12-24c0-7-5-12-12-12zm0 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" fill="currentColor" />
      </svg>
    );
  }
  if (step.modifier === 'uturn') {
    return (
      <svg className="turn" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M16 42V20a8 8 0 0 1 16 0v10" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M24 28l8 9 8-9" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="turn" viewBox="0 0 48 48" aria-hidden="true" style={{ transform: `rotate(${ANGLE[step.modifier]}deg)` }}>
      <path d="M24 44V10" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M12 21L24 8l12 13" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
