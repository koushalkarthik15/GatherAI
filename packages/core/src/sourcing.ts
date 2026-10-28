import type { EventPlan } from './index.ts';
export * from './sourcingSchema.ts';
export const kindLabels={venue:'Venue',food:'Food & refreshments',equipment:'Sound & equipment',decorations:'Decorations',permissions:'Permissions',other:'Other essentials'} as const;
export const sourcingGuides={
 venue:{start:['Ask your college or community centre about existing space before hiring.','Shortlist two or three options and visit before paying a deposit.'],
  questions:['Is the space available on the event date, including setup and cleanup?','What is the total charge including taxes, deposit, overtime and cancellation?','What is the permitted capacity, step-free access and accessible toilet provision?','Are seating, sound, power backup and permissions included?']},
 food:{start:['Confirm dietary/accessibility needs and the number of servings.','Ask campus catering or donation partners before comparing outside caterers.'],
  questions:['What is the per-person rate, minimum order and total including delivery/taxes?','Can you accommodate allergies and dietary requirements safely?','When will food arrive, and who supplies serving staff, water and cleanup?','What are the payment, cancellation and final-headcount deadlines?']},
 equipment:{start:['Inventory equipment already owned by your venue or club.','Ask the technical team for quantities, power needs and setup time before renting.'],
  questions:['What exact equipment and backup are included?','Are transport, setup, operator and teardown included in the quote?','What power connections and sound restrictions apply?','What is the deposit, damage policy and cancellation deadline?']},
 decorations:{start:['Reuse existing club materials and measure the space first.','Separate essential signage from optional decoration; consider reusable supplies.'],
  questions:['What quantities, dimensions and materials are included?','Does the venue allow mounting, adhesives, lighting and the proposed materials?','Who handles installation, removal and waste?','Is the total inclusive of transport, labour, taxes and deposits?']},
 permissions:{start:['Identify the venue owner and the college/community approval contact.','Ask the responsible authority which permissions apply to your specific event.'],
  questions:['Which written approvals apply to this event, location, timing and sound?','Who can issue approval and what documents/lead times are needed?','Are emergency, fire, accessibility or food-safety arrangements required?','What restrictions or expiry dates must the organizer follow?']},
 other:{start:['Check what your team can borrow, obtain as a donation or provide in-house.','Define quantity, quality and deadline before requesting comparable quotes.'],
  questions:['Can you provide the required quantity by our event date?','What is the total cost including all charges and deposit?','Who handles delivery, setup and collection?','What are the confirmation, cancellation and refund terms?']},
} as const;
export function resourceEnquiry(plan:EventPlan,resource:EventPlan['resources'][number]){
 const guide=sourcingGuides[resource.details?.kind??'other'];
 return 'Hello, we are arranging '+plan.name+' on '+plan.date+' for approximately '+plan.guests+' people.\n'+
  'We are enquiring about '+resource.name+(resource.details?.quantity?' (quantity: '+resource.details.quantity+')':'')+'.\n'+
  guide.questions.map(question=>'- '+question).join('\n')+'\nPlease share a written quote. We have not made a booking.';
}
/** Explicit reviewed estimate update, never a payment or actual expense. */
export function applyResourceQuote(plan:EventPlan,resourceId:string,newId:()=>string):EventPlan{
 const resource=plan.resources.find(item=>item.id===resourceId);
 if(!resource||resource.details?.quote===undefined)throw new Error('Record a total quote first.');
 const quote=resource.details.quote;
 if(!Number.isSafeInteger(quote)||quote<0||quote>1_000_000_000)throw new Error('Invalid quoted amount.');
 const linked=resource.details.budgetId?plan.budget.find(item=>item.id===resource.details!.budgetId):undefined;
 if(resource.details.budgetId&&!linked)throw new Error('The linked budget item no longer exists.');
 if(linked?.committed)throw new Error('Edit the committed budget item directly after reviewing its obligations.');
 const budgetId=linked?.id??newId();
 const budget=linked?plan.budget.map(item=>item.id===budgetId?{...item,estimate:Math.max(quote,item.actual)}:item):
  [...plan.budget,{id:budgetId,name:resource.name,category:kindLabels[resource.details.kind??'other'],estimate:quote,actual:0,committed:false}];
 return {...plan,budget,resources:plan.resources.map(item=>item.id===resourceId?
  {...item,details:{...item.details,budgetId}}:item)};
}

/** Choosing a saved option records organizer intent without confirming or booking it. */
export function chooseResource(plan:EventPlan,resourceId:string):EventPlan {
 const resource=plan.resources.find(item=>item.id===resourceId);
 if(!resource||!resource.details?.kind||!['venue','food','equipment'].includes(resource.details.kind))
  throw new Error('Choose a saved venue, food or equipment option.');
 return {...plan,resources:plan.resources.map(item=>item.id===resourceId
  ?{...item,details:{...item.details,enquiry:'Chosen' as const}}:item)};
}