import { formatMoney, totals, type EventPlan } from '@gather/core';

const palette: Record<string, string> = {
 Experience: '#2855ed', Hospitality: '#a79ac8', Design: '#f4b38f',
 Logistics: '#9db4e0', Reserve: '#b8c6a7',
};
const fallback = ['#879f81', '#b28da3', '#8e98c2', '#c3a077'];
function categoryColor(category: string) {
 const hash = Array.from(category).reduce((sum, char) => sum + char.charCodeAt(0), 0);
 return palette[category] ?? fallback[hash % fallback.length];
}

export function Allocation({ event, selected, onSelect }: {
 event: EventPlan; selected: string | null; onSelect: (category: string | null) => void;
}) {
 const { ceiling, estimate } = totals(event);
 const denominator = Math.max(ceiling, estimate, 1);
 const available = Math.max(0, ceiling - estimate);
 const categories = Array.from(new Set(event.budget.map(item => item.category || 'Other'))).map(name => ({
  name, amount: event.budget.filter(item => (item.category || 'Other') === name).reduce((sum, item) => sum + item.estimate, 0),
  color: categoryColor(name),
 }));
 const toggle = (name: string) => onSelect(selected === name ? null : name);
 return (
  <div className="allocation">
   <p className="bar-caption">Estimated allocations · select a category to highlight its items</p>
   <div className="allocation-bar" role="group" aria-label="Estimated budget by category">
    {categories.filter(c => c.amount > 0).map(category => <button
     key={category.name} aria-label={category.name + ': ' + formatMoney(category.amount)}
     aria-pressed={selected === category.name} onClick={() => toggle(category.name)}
     style={{ width: category.amount / denominator * 100 + '%', background: category.color }}
     title={category.name + ': ' + formatMoney(category.amount)}
    />)}
    {available > 0 && <span className="unallocated-segment" style={{ width: available / denominator * 100 + '%' }} title={'Unallocated: ' + formatMoney(available)}/>}
   </div>
   <div className="allocation-legend">
    {categories.map(category => <button key={category.name} aria-pressed={selected === category.name} onClick={() => toggle(category.name)}>
     <i className="legend-swatch" style={{ background: category.color }}/><span>{category.name}</span><strong>{formatMoney(category.amount)}</strong>
    </button>)}
    <span><i className="legend-swatch available"/>Unallocated estimate <strong>{formatMoney(available)}</strong></span>
   </div>
   {!estimate && <p className="fine-print">No estimated spending yet. Add an item to start allocating.</p>}
   {estimate > ceiling && <p className="fine-print danger-text">Estimates exceed the ceiling by {formatMoney(estimate - ceiling)}.</p>}
  </div>
 );
}
