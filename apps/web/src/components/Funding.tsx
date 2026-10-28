import { ArrowUpRight } from 'lucide-react';
import { formatMoney, totals, type EventPlan } from '@gather/core';

export function Funding({ event, onBudget }: { event: EventPlan; onBudget?: () => void }) {
 const { estimate, actual, exposure, remaining, ceiling } = totals(event);
 const denominator = Math.max(ceiling, exposure, 1);
 const outstanding = Math.max(0, exposure - actual);
 const available = Math.max(0, remaining);
 return (
  <section className="panel funding-panel">
   <div className="section-heading">
    <h2>A little room to make it happen.</h2>
    {onBudget && <button className="icon-button" onClick={onBudget} aria-label="Open budget"><ArrowUpRight size={20}/></button>}
   </div>
   <div className="funding-figures">
    <div><span className="caption">CONFIRMED FUNDS</span><strong>{formatMoney(event.confirmed)}</strong></div>
    <div><span className="caption">ESTIMATED SPEND</span><strong>{formatMoney(estimate)}</strong></div>
    <div><span className="caption">{remaining < 0 ? 'OVER CEILING' : 'ROOM REMAINING'}</span><strong className={remaining < 0 ? 'danger-text' : 'accent-text'}>{formatMoney(Math.abs(remaining))}</strong></div>
   </div>
   <p className="bar-caption">How your available budget is being used</p>
   <div className="funding-track" role="img" aria-label={'Actual spend '+formatMoney(actual)+', still allocated '+formatMoney(outstanding)+', available '+formatMoney(available)+', ceiling '+formatMoney(ceiling)}>
    <span className="funding-actual" style={{ width: actual / denominator * 100 + '%' }}/>
    <span className="funding-confirmed" style={{ width: outstanding / denominator * 100 + '%' }}/>
    <span className="funding-available" style={{ width: available / denominator * 100 + '%' }}/>
   </div>
   <div className="funding-legend value-legend">
    <span><i className="legend-swatch actual"/>Spent <strong>{formatMoney(actual)}</strong></span>
    <span><i className="legend-swatch allocated"/>Still allocated <strong>{formatMoney(outstanding)}</strong></span>
    <span><i className="legend-swatch available"/>Available <strong>{formatMoney(available)}</strong></span>
   </div>
   {remaining < 0 && <p className="fine-print danger-text">Over the spending ceiling by {formatMoney(-remaining)}.</p>}
   <p className="fine-print">Ceiling: {formatMoney(ceiling)} · Pending: {formatMoney(event.pending)} (excluded). Recorded spending above an estimate is included.</p>
  </section>
 );
}
