import { useState, type ComponentProps } from 'react';

type Props = Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange'> & {
 value: number | string;
 onValueChange: (value: string) => void;
};

export function NumberInput({value,onValueChange,onFocus,onBlur,...props}:Props) {
 const [draft,setDraft]=useState('');
 const [focused,setFocused]=useState(false);
 return <input {...props} type="number" value={focused?draft:value}
  onFocus={event=>{setDraft(String(value));setFocused(true);onFocus?.(event);}}
  onChange={event=>{
   const next=event.target.value.replace(/^(-?)0+(?=\d)/,'$1');
   setDraft(next);onValueChange(next);
  }}
  onBlur={event=>{setFocused(false);onBlur?.(event);}}/>;
}
