import type { EventPlan } from '@gather/core';

function sample(id: string, name: string, kind: string, description: string, color: EventPlan['color'], date: string, guests: number): EventPlan {
 return { id, name, kind, description, color, date, guests, location: id === 'community' ? 'Community garden, Hyderabad' : 'The Courtyard · North Campus',
 confirmed: 2000000, pending: 500000, limit: 2200000, revision: 0,
 groups: [{id: id+'-venue',name:'Space & essentials'}, {id:id+'-experience',name:'The experience'}, {id:id+'-people',name:'People & publicity'}],
 tasks: [
  {id:id+'-t1',groupId:id+'-venue',title:'Book the courtyard & confirm access',owner:'Koushal',due:'2026-10-26',status:'Done',priority:'High',notes:'Booking confirmed. Keep the access instructions handy.'},
  {id:id+'-t2',groupId:id+'-venue',title:'Check sound, lights & power points',owner:'Tech team',due:'2026-10-28',status:'In progress',priority:'High',notes:'Ask about a backup microphone.'},
  {id:id+'-t3',groupId:id+'-venue',title:'Confirm an accessible entrance',owner:'You',due:'2026-10-29',status:'To do',priority:'High',notes:''},
  {id:id+'-t4',groupId:id+'-experience',title:'Finalize the refreshments menu',owner:'Ananya',due:'2026-10-29',status:'To do',priority:'Medium',notes:'Include a vegetarian option and drinking water.'},
  {id:id+'-t5',groupId:id+'-experience',title:'Put together a welcome playlist',owner:'You',due:'2026-10-30',status:'To do',priority:'Low',notes:''},
  {id:id+'-t6',groupId:id+'-people',title:'Share the event poster with the club',owner:'Design team',due:'2026-10-27',status:'Done',priority:'Medium',notes:'Poster approved and shared.'},
  {id:id+'-t7',groupId:id+'-people',title:'Confirm the welcome desk volunteers',owner:'You',due:'2026-10-30',status:'Blocked',priority:'Medium',notes:'Waiting for availability.'},
 ],
 budget:[
  {id:id+'-b1',name:'Speaker & activities',category:'Experience',estimate:400000,actual:200000,committed:true},
  {id:id+'-b2',name:'Food & refreshments',category:'Hospitality',estimate:600000,actual:0,committed:true},
  {id:id+'-b3',name:'Decor & atmosphere',category:'Design',estimate:300000,actual:0,committed:false},
  {id:id+'-b4',name:'Prints & keepsakes',category:'Design',estimate:300000,actual:0,committed:false},
  {id:id+'-b5',name:'Sound & equipment',category:'Logistics',estimate:200000,actual:0,committed:false},
  {id:id+'-b6',name:'Contingency',category:'Reserve',estimate:200000,actual:0,committed:false},
 ],
 resources:[
  {id:id+'-r1',name:'Courtyard & seating',source:'Campus facilities · donated venue',status:'Confirmed'},
  {id:id+'-r2',name:'Sound system & microphones',source:'AV team · availability pending',status:'Requested'},
  {id:id+'-r3',name:'Refreshment service',source:'Organizer-selected caterer',status:'Requested'},
  {id:id+'-r4',name:'Welcome desk supplies',source:'Club cupboard · check inventory',status:'Needed'},
 ],
 agenda:[
  {id:id+'-a1',time:'16:00',title:'Doors open & a warm welcome',owner:'Welcome team'},
  {id:id+'-a2',time:'16:30',title:'A little inspiration',owner:'Speaker'},
  {id:id+'-a3',time:'17:15',title:'Make something together',owner:'Activity team'},
  {id:id+'-a4',time:'18:00',title:'Good food, better conversations',owner:'Hospitality'},
 ]};
}
export const sampleEvents: EventPlan[] = [
 sample('afterhours','Campus Afterhours','Club celebration','Good conversations. New connections. A little campus magic.','cobalt','2026-11-01',80),
 sample('workshop','Ideas in Bloom','Workshop & technical talk','An afternoon for curious minds and things not yet made.','lavender','2026-11-07',45),
 sample('community','The Neighbourhood Table','Community gathering','Bring a story, pull up a chair. Everyone belongs here.','peach','2026-11-14',60),
];
