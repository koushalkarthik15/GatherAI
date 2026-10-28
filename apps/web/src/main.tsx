import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { App } from './StudioApp';
import './styles.css';
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');
createRoot(root).render(<StrictMode><BrowserRouter><MotionConfig reducedMotion="user"><App/></MotionConfig></BrowserRouter></StrictMode>);
