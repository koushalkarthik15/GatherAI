import './csp';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { App } from './StudioApp';
import './styles.css';
// Keep font loading non-blocking without an inline event handler (CSP).
const fonts = document.getElementById('gather-fonts') as HTMLLinkElement | null;
if (fonts) {
	if (fonts.sheet) fonts.media = 'all';
	else fonts.addEventListener('load', () => { fonts.media = 'all'; }, { once: true });
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');
createRoot(root).render(<StrictMode><BrowserRouter><MotionConfig reducedMotion="user"><App/></MotionConfig></BrowserRouter></StrictMode>);
