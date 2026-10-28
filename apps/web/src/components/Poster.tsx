import { CalendarDays, MapPin, Users } from 'lucide-react';
import { formatDate, type EventPlan } from '@gather/core';
export function Poster({event}: {event: EventPlan}) {
 return <section className={'event-poster '+event.color} aria-label="Event details">
  <div className="poster-copy"><p className="eyebrow">{event.kind} <span> / </span> MADE FOR CONNECTION</p>
   <h1>{event.name}</h1><p className="poster-description">{event.description}</p>
   <div className="event-meta"><span><CalendarDays size={15}/>{formatDate(event.date)}</span><span><MapPin size={15}/>{event.location}</span><span><Users size={15}/>{event.guests} guests</span></div>
  </div>
  <div className="poster-art" aria-hidden="true"><div className="art-orbit"/><div className="art-sun"/><div className="art-arch"/><div className="art-stripe one"/><div className="art-stripe two"/><div className="art-stripe three"/><span className="art-caption">COME TOGETHER <span>✳</span> 2026</span></div>
 </section>;
}
