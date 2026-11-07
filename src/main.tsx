import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

// No waiting for the font: name tags and speech bubbles are page text (they
// switch to the font when it arrives), so slow connections see the room at once.
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
