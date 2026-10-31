import { formatAud } from "@/lib/format";
import { ringRead } from "@/lib/money-flow/budget-plan";
import { ringMoneyLabel } from "@/lib/money-flow/budget-rings";

const VIEW = 120;
const OUTER = 54;
const LEFT_STROKE = 10;
const OVER_STROKE = 16;

/**
 * One ring for the Budget page (figure above) and the dashboard (figure inside).
 * The arc starts at 12 o'clock. Left is a primary arc on a 70% track.
 * Over is a full navy ring with a thicker stroke and the same outer edge.
 */
export function BudgetRing({
  planned,
  spent,
  figure = "above",
  digits = "category",
  ariaLabel,
  boxClassName = "size-[124px]",
}: {
  planned: number;
  spent: number;
  figure?: "above" | "inside" | "none";
  digits?: "hero" | "category";
  ariaLabel?: string;
  boxClassName?: string;
}) {
  const read = ringRead(planned, spent);
  const spoken =
    ariaLabel ?? (read.over ? `${formatAud(read.figure)} over` : `${formatAud(read.figure)} left`);
  const amount = ringMoneyLabel(read.figure);
  const stroke = read.over ? OVER_STROKE : LEFT_STROKE;
  const radius = OUTER - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = Math.max(0, Math.min(1, read.fill)) * circumference;
  const tight = digits === "category" && amount.length > 5;

  const graphic = (
      <div className={`relative ${figure === "above" ? "size-[124px]" : boxClassName}`}>
        <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="size-full" role="img" aria-label={spoken}>
          {read.over ? (
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              className="stroke-primary-strong"
              strokeWidth={stroke}
            />
          ) : (
            <>
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                className="stroke-primary"
                strokeOpacity={0.7}
                strokeWidth={stroke}
              />
              {dash > 0 ? (
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  className="stroke-primary"
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${circumference}`}
                  transform="rotate(-90 60 60)"
                />
              ) : null}
            </>
          )}
        </svg>
        {figure === "inside" ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2 text-center" aria-hidden>
            <p
              className={`font-semibold tabular-nums leading-none ${
                read.over ? "text-primary-strong" : "text-primary"
              } ${
                digits === "hero"
                  ? "text-[22px] @min-[640px]:text-[28px]"
                  : tight
                    ? "text-[12px]"
                    : "text-[16px]"
              }`}
            >
              {read.over ? `▲ ${amount}` : amount}
            </p>
            <p
              className={`mt-0.5 text-[12px] leading-none ${
                read.over ? "font-bold text-primary-strong" : "text-muted"
              }`}
            >
              {read.over ? "over" : "left"}
            </p>
          </div>
        ) : null}
      </div>
  );
  if (figure !== "above") return graphic;
  return (
    <div className="flex w-[124px] shrink-0 flex-col items-center gap-2">
      <p className="text-center text-[14px] font-semibold tabular-nums">
        {read.over ? `${formatAud(read.figure)} over` : `${formatAud(read.figure)} left`}
      </p>
      {graphic}
    </div>
  );
}
